import { createHash, randomInt, randomUUID } from "node:crypto";
import { getRedis } from "../../infrastructure/redis.js";
import { config } from "../../infrastructure/config.js";
import { withDigitAdmin } from "./digit-admin-session.js";
import { managedTenantsFromIdentity, recordManagedTenant } from "../organizations/organization-service.js";
import {
  createAccount,
  type DigitAccount,
  type DigitAccountInput,
  type DigitLogin,
  type DigitRole,
  DigitUnavailableError,
  passwordLogin,
  revokeToken,
  searchAccounts,
  updateAccount,
} from "./digit-user-client.js";

/**
 * DIGIT accounts owned by this Keycloak-BFF flow.
 *
 * One account exists per (verified Keycloak issuer+subject, DIGIT tenant) and
 * lives AT that tenant: DIGIT's gateway authorizes a token only for its
 * account's home tenant, so one account cannot serve several tenants.
 * An account is managed only when BOTH its username and its
 * identificationMark are derived from that (issuer, subject, tenant).
 * Anything else, including every locally managed legacy employee, is never
 * updated, rotated or deactivated here.
 *
 * Passwords are one-time plaintext values: generated, sent once to egov-user
 * (create/update) and once to /oauth/token, then dropped. egov-user still
 * stores the resulting BCrypt hash, and JavaScript strings cannot be zeroed,
 * so "discarded" means never persisted, logged, cached or returned.
 */
export const MANAGED_USER_TYPE = "EMPLOYEE";

export interface ManagedIdentity {
  issuer: string;
  subject: string;
  tenantId: string;
  key: string;
  username: string;
  marker: string;
}

export interface ManagedProfile {
  name: string;
  emailId?: string;
  mobileNumber?: string;
  countryCode?: string;
}

/** tenantId -> allowlisted DIGIT role codes the subject should hold there. */
export type DesiredRoles = Map<string, string[]>;

export class ManagedAccountError extends Error {
  constructor(message: string, readonly status = 409) {
    super(message);
  }
}

export function managedIdentity(issuer: string, subject: string, tenantId: string): ManagedIdentity {
  const subjectKey = createHash("sha256").update(`${issuer}\n${subject}`).digest("hex");
  const key = createHash("sha256").update(`${issuer}\n${subject}\n${tenantId}`).digest("hex");
  return {
    issuer,
    subject,
    tenantId,
    key,
    username: `kcbff-${key.slice(0, 40)}`,
    marker: `keycloak-bff:v1:${subjectKey}:${tenantId}`,
  };
}

const LOWER = "abcdefghijkmnopqrstuvwxyz";
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const DIGITS = "23456789";
const SPECIAL = "@#$%";

/** Random password satisfying egov-user's default policy (digit, lower, upper, @#$%, 8-15). */
export function oneTimePassword(length = config.digitPasswordLength): string {
  if (length < 8 || length > 15) throw new Error("DIGIT password length must be 8-15");
  const all = LOWER + UPPER + DIGITS + SPECIAL;
  const chars = [LOWER, UPPER, DIGITS, SPECIAL].map((set) => set[randomInt(set.length)]);
  while (chars.length < length) chars.push(all[randomInt(all.length)]);
  for (let index = chars.length - 1; index > 0; index -= 1) {
    const swap = randomInt(index + 1);
    [chars[index], chars[swap]] = [chars[swap], chars[index]];
  }
  return chars.join("");
}

const tokenKey = (identity: ManagedIdentity) =>
  `${config.cachePrefix}:digit-user-token:${identity.key}`;
const leaseKey = (identity: ManagedIdentity) =>
  `${config.cachePrefix}:digit-user-lease:${identity.key}`;
/** Hash of `${subject}|${tenantId}` -> issuer for every account this BFF provisioned. */
export const managedAccountsKey = () => `${config.cachePrefix}:digit-managed-accounts`;
const indexField = (identity: ManagedIdentity) => `${identity.subject}|${identity.tenantId}`;

async function withUserLease<T>(identity: ManagedIdentity, operation: () => Promise<T>): Promise<T> {
  const value = randomUUID();
  const deadline = Date.now() + config.digitUserLeaseWaitMs;
  while ((await getRedis().set(
    leaseKey(identity), value, "EX", config.digitUserLeaseSeconds, "NX",
  )) !== "OK") {
    if (Date.now() >= deadline) {
      throw new DigitUnavailableError("DIGIT account is busy; retry");
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  try {
    return await operation();
  } finally {
    await getRedis().eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      1, leaseKey(identity), value,
    );
  }
}

async function findAccount(adminToken: string, identity: ManagedIdentity): Promise<DigitAccount | null> {
  for (const active of [true, false]) {
    const accounts = await searchAccounts(adminToken, {
      userName: identity.username, tenantId: identity.tenantId, userType: MANAGED_USER_TYPE, active,
    });
    const account = accounts.find((candidate) => candidate.userName === identity.username);
    if (!account) continue;
    if (account.identificationMark !== identity.marker) {
      throw new ManagedAccountError("A DIGIT account with this username is not managed by the identity BFF");
    }
    return account;
  }
  return null;
}

/** Base roles plus allowlisted codes, all scoped to the account's own tenant. */
export function desiredDigitRoles(tenantId: string, codes: string[]): DigitRole[] {
  const allowed = [...new Set([...config.digitManagedBaseRoles,
    ...codes.filter((code) => config.digitManagedRoleAllowlist.includes(code))])].sort();
  return allowed.map((code) => ({ code, name: code, tenantId }));
}

function roleSet(roles: DigitRole[]): string {
  return [...new Set(roles.map((role) => `${role.tenantId}:${role.code}`))].sort().join(",");
}

/** Fields written back on update. Managed accounts carry no other profile data. */
function editable(account: DigitAccount): DigitAccountInput {
  return {
    id: account.id,
    uuid: account.uuid,
    userName: account.userName,
    name: account.name,
    mobileNumber: account.mobileNumber,
    countryCode: account.countryCode,
    emailId: account.emailId,
    tenantId: account.tenantId,
    type: account.type,
    active: account.active,
    identificationMark: account.identificationMark,
    roles: account.roles,
  };
}

async function cachedLogin(identity: ManagedIdentity): Promise<DigitLogin | null> {
  const raw = await getRedis().get(tokenKey(identity));
  if (!raw) return null;
  try {
    const login = JSON.parse(raw) as DigitLogin;
    return login.expiresAt - config.digitTokenRefreshSkewSeconds * 1000 > Date.now() ? login : null;
  } catch {
    return null;
  }
}

async function cacheLogin(identity: ManagedIdentity, login: DigitLogin): Promise<void> {
  const ttl = Math.floor((login.expiresAt - Date.now()) / 1000) - config.digitTokenRefreshSkewSeconds;
  if (ttl > 0) await getRedis().set(tokenKey(identity), JSON.stringify(login), "EX", ttl);
}

async function dropCachedLogin(identity: ManagedIdentity): Promise<void> {
  const raw = await getRedis().get(tokenKey(identity));
  await getRedis().del(tokenKey(identity));
  if (!raw) return;
  try {
    await revokeToken((JSON.parse(raw) as DigitLogin).accessToken);
  } catch (error) {
    console.warn("DIGIT token revocation failed:", (error as Error).message);
  }
}

export interface EnsureResult {
  account: DigitAccount | null;
  created: boolean;
  changed: boolean;
}

/**
 * Makes the (subject, tenant) managed account match `roles`: `null` means the
 * subject is no longer a member there, so an existing account is deactivated.
 * A missing account is created only when `profile` is supplied. With
 * `createOnly`, an existing account is returned untouched: callers holding
 * possibly stale session claims must not grant or revoke roles. Role or
 * activation changes revoke the cached user token.
 */
export async function ensureManagedAccount(
  identity: ManagedIdentity,
  roleCodes: string[] | null,
  profile?: ManagedProfile,
  options: { createOnly?: boolean } = {},
): Promise<EnsureResult> {
  return withUserLease(identity, () => withDigitAdmin(async (adminToken) => {
    const account = await findAccount(adminToken, identity);
    if (account && options.createOnly) return { account, created: false, changed: false };
    const roles = roleCodes === null ? [] : desiredDigitRoles(identity.tenantId, roleCodes);

    if (!account) {
      if (roleCodes === null || !profile) return { account: null, created: false, changed: false };
      if (!profile.name.trim() || !profile.mobileNumber?.trim()) {
        throw new ManagedAccountError("A name and mobile number are required to create the DIGIT account");
      }
      const password = oneTimePassword();
      const created = await createAccount(adminToken, {
        userName: identity.username,
        name: profile.name.trim().slice(0, 50),
        mobileNumber: profile.mobileNumber.trim(),
        countryCode: profile.countryCode?.trim() || null,
        emailId: profile.emailId || null,
        tenantId: identity.tenantId,
        type: MANAGED_USER_TYPE,
        active: true,
        identificationMark: identity.marker,
        roles,
        password,
      });
      const login = await passwordLogin({
        username: identity.username, password, tenantId: identity.tenantId, userType: MANAGED_USER_TYPE,
      });
      await cacheLogin(identity, login);
      await getRedis().hset(managedAccountsKey(), indexField(identity), identity.issuer);
      await recordManagedTenant(identity.subject, identity.tenantId);
      return { account: created, created: true, changed: true };
    }

    await getRedis().hset(managedAccountsKey(), indexField(identity), identity.issuer);
    await recordManagedTenant(identity.subject, identity.tenantId);
    if (roleCodes === null) {
      if (!account.active) return { account, created: false, changed: false };
      const updated = await updateAccount(adminToken, { ...editable(account), active: false });
      await dropCachedLogin(identity);
      return { account: updated, created: false, changed: true };
    }
    if (account.active && roleSet(account.roles) === roleSet(roles)) {
      return { account, created: false, changed: false };
    }
    const updated = await updateAccount(adminToken, { ...editable(account), active: true, roles });
    await dropCachedLogin(identity);
    return { account: updated, created: false, changed: true };
  }));
}

/**
 * Returns a normal user-scoped DIGIT token for an active managed account.
 * A valid cached token is reused. Otherwise, under the per-user lease, the
 * account's password is rotated to a new one-time value and the BFF logs in
 * once as that user.
 */
export async function managedUserLogin(identity: ManagedIdentity): Promise<DigitLogin> {
  const cached = await cachedLogin(identity);
  if (cached) return cached;
  return withUserLease(identity, async () => {
    const again = await cachedLogin(identity);
    if (again) return again;
    return withDigitAdmin(async (adminToken) => {
      const account = await findAccount(adminToken, identity);
      if (!account || !account.active) {
        throw new ManagedAccountError("No active DIGIT account is managed for this identity", 403);
      }
      const password = oneTimePassword();
      await updateAccount(adminToken, { ...editable(account), password });
      const login = await passwordLogin({
        username: identity.username, password, tenantId: account.tenantId, userType: MANAGED_USER_TYPE,
      });
      await cacheLogin(identity, login);
      return login;
    });
  });
}

/** Revokes and forgets the cached DIGIT tokens of every managed account of a subject (logout). */
export async function revokeManagedUserLogins(issuer: string, subject: string): Promise<void> {
  for (const tenantId of await managedTenantsOf(issuer, subject)) {
    const identity = managedIdentity(issuer, subject, tenantId);
    await withUserLease(identity, () => dropCachedLogin(identity));
  }
}

/** Tenants where this BFF has provisioned an account for the subject. */
export async function managedTenantsOf(issuer: string, subject: string): Promise<string[]> {
  const entries = await getRedis().hgetall(managedAccountsKey());
  const cached = Object.entries(entries)
    .filter(([field, owner]) => owner === issuer && field.startsWith(`${subject}|`))
    .map(([field]) => field.slice(subject.length + 1));
  const durable = issuer === config.keycloakIssuer
    ? await managedTenantsFromIdentity(subject).catch(() => [] as string[])
    : [];
  return [...new Set([...cached, ...durable])].sort();
}

export async function findManagedAccount(identity: ManagedIdentity): Promise<DigitAccount | null> {
  return withDigitAdmin((adminToken) => findAccount(adminToken, identity));
}
