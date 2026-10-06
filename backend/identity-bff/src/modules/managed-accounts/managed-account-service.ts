import { cachedToken, recordToken, holdToken, readToken, forgetToken, revokeInventoriedToken, personTokensKey, parseAccountId, type AccountRef } from "../revocation/inventory.js";
import { privateRef } from "../citizen-otp/otp-store.js";
import { accountEntries } from "../sync/state.js";
import { requireCurrentSession } from "../sessions/session-store.js";
import { currentPersonLease, withPersonLease } from "../accounts/person-lease.js";
import { staffCredentialMode, staffLogin } from "../accounts/credential-service.js";
import { readUser } from "../../integrations/keycloak/admin-api.js";
import { createHash, randomInt } from "node:crypto";
import { getRedis } from "../../infrastructure/redis.js";
import { config } from "../../infrastructure/config.js";
import { withDigitAdmin } from "./digit-admin-session.js";
import { citizenTokenMinter } from "./citizen-token-minter.js";
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
/**
 * Citizen accounts (#2167) follow the same ownership rule in their own
 * namespace: `kcbffc-` usernames and a `keycloak-bff:citizen:v1:` marker,
 * derived from a key that can never equal an employee key. A legacy citizen
 * whose username is a mobile number is never adopted. Unlike employees, a
 * citizen account lives at egov-user's citizen tenant (the state root, see
 * `digitCitizenTenantId`), shared by every city route under it.
 */
export const CITIZEN_USER_TYPE = "CITIZEN";
export type ManagedUserType = typeof MANAGED_USER_TYPE | typeof CITIZEN_USER_TYPE;

export interface ManagedIdentity {
  issuer: string;
  subject: string;
  tenantId: string;
  key: string;
  username: string;
  marker: string;
  userType: ManagedUserType;
  /**
   * Set for an EXISTING DIGIT account linked to the subject (#2167) rather
   * than one this BFF created: the account's own uuid. Its username, roles
   * and profile are the account's own and are never rewritten.
   */
  linkedUuid?: string;
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
  constructor(message: string, readonly status = 409, readonly code?: string) {
    super(message);
  }
}

/**
 * The identity behind an existing DIGIT account linked to `subject`. Its
 * token cache, lease and holders are keyed by the link, never by a
 * `kcbff-` identity, so a linked and a managed account cannot share a token.
 */
export function linkedIdentity(
  issuer: string,
  subject: string,
  link: { userType: ManagedUserType; tenantId: string; digitUuid: string },
): ManagedIdentity {
  const key = createHash("sha256")
    .update(`link\n${issuer}\n${subject}\n${link.userType}\n${link.tenantId}\n${link.digitUuid}`)
    .digest("hex");
  return {
    issuer, subject, tenantId: link.tenantId, key,
    username: "", marker: "", userType: link.userType, linkedUuid: link.digitUuid,
  };
}

/** Whether a DIGIT account was created by this BFF (never linkable). */
export function isBffManagedAccount(account: DigitAccount): boolean {
  return account.userName.startsWith("kcbff") ||
    (account.identificationMark || "").startsWith("keycloak-bff:");
}

/** An existing account, only while it is still active with its type and tenant. */
export async function findActiveAccount(
  adminToken: string, link: { uuid: string; tenantId: string; userType: ManagedUserType },
): Promise<DigitAccount | null> {
  const accounts = await searchAccounts(adminToken, {
    uuid: [link.uuid], tenantId: link.tenantId, userType: link.userType, active: true,
  });
  return accounts.find((account) => account.uuid === link.uuid && account.active &&
    account.type === link.userType && account.tenantId === link.tenantId) || null;
}

const findLinkedAccount = (adminToken: string, identity: ManagedIdentity) =>
  findActiveAccount(adminToken, { uuid: identity.linkedUuid!, tenantId: identity.tenantId, userType: identity.userType });

/**
 * Writes `changes` to an account the BFF does NOT own (a linked legacy
 * account). egov-user's update writes most fields exactly as sent and clears
 * absent ones, so the record goes back whole, as searched, with only
 * `changes` applied. A record with masked personal data (`******1234`) is
 * never written back: that would store the mask on a real person.
 */
async function writeLinkedAccount(
  adminToken: string,
  account: DigitAccount,
  changes: Partial<DigitAccountInput>,
): Promise<void> {
  if (Object.values(account).some((value) => typeof value === "string" && /\*{2,}/.test(value))) {
    console.error("egov-user returned masked personal data for a linked account; nothing was written. " +
      "The BFF's DIGIT admin must be allowed to read unmasked user records.");
    throw new ManagedAccountError("The linked DIGIT account cannot be updated safely", 503, "DIGIT_PII_MASKED");
  }
  // Search returns yyyy-MM-dd, while the update DTO expects dd/MM/yyyy.
  // Omitting DOB keeps its stored value and fixes rotation for legacy staff.
  const { dob: _dob, ...safe } = account as DigitAccount & { dob?: unknown };
  await updateAccount(adminToken, { ...(safe as DigitAccountInput), ...changes });
}

/** Unlink: revoke the linked account's cached token for every session. */
export async function dropLinkedLogin(identity: ManagedIdentity): Promise<void> {
  await dropCachedLogin(identity);
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
    userType: MANAGED_USER_TYPE,
  };
}

/**
 * The tenant egov-user keeps a CITIZEN at: the first dotted segment of the
 * tenant it is given, exactly like `UserUtils.getStateLevelTenantForCitizen`
 * (`ke.bomet.ulb1` -> `ke`). egov-user applies this to CITIZEN search, login
 * lookup, uniqueness and the stored row, and issues the token for it.
 *
 * This is NOT necessarily the BFF's `rootTenantId`: that is the Keycloak
 * Organization's mapped tenant, which may itself be dotted (an Organization
 * mapped to `ke.bomet` has rootTenantId `ke.bomet`, but its citizens live at
 * `ke`). Derive from egov-user's rule, never from the Organization mapping.
 */
export function digitCitizenTenantId(tenantId: string): string {
  return tenantId.split(".")[0];
}

/**
 * The BFF-managed DIGIT CITIZEN account of (issuer, subject) for a route
 * tenant. There is ONE account per (subject, egov-user citizen tenant): every
 * city route under `ke` resolves to the same `ke` account, so the username,
 * marker and token cache are all derived from `digitCitizenTenantId`, not
 * from the route tenant. The route tenant stays on the CitizenRegistration.
 */
export function citizenIdentity(issuer: string, subject: string, routeTenantId: string): ManagedIdentity {
  const tenantId = digitCitizenTenantId(routeTenantId);
  const subjectKey = createHash("sha256").update(`${issuer}\n${subject}`).digest("hex");
  const key = createHash("sha256")
    .update(`citizen\n${issuer}\n${subject}\n${tenantId}`)
    .digest("hex");
  return {
    issuer,
    subject,
    tenantId,
    key,
    username: `kcbffc-${key.slice(0, 40)}`,
    marker: `keycloak-bff:citizen:v1:${subjectKey}:${tenantId}`,
    userType: CITIZEN_USER_TYPE,
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

/**
 * Token-holder reference of one browser session. egov-user returns the same
 * live token to every password grant of one account, so sessions share it and
 * logout revokes only when the last holder is gone (revocation/index.ts). The
 * session id is the bearer of the browser session and is never a Redis key.
 */
export const sessionTokenRef = (sessionId: string) => privateRef("session", sessionId);

/**
 * The `countryCode mobileNumber` this BFF last wrote to a citizen account.
 * Used only when egov-user masks the stored number in search results. It
 * expires, so a number changed outside the BFF is written back within a day.
 */
const citizenMobileKey = (identity: ManagedIdentity) =>
  `${config.cachePrefix}:digit-citizen-mobile:${identity.key}`;
const CITIZEN_MOBILE_HINT_SECONDS = 86_400;
const citizenMobileHint = (countryCode: string | null | undefined, mobileNumber: string) =>
  `${countryCode?.trim() || ""} ${mobileNumber.trim()}`;
/** Hash of `${subject}|${tenantId}` -> issuer for every account this BFF provisioned. */
export const managedAccountsKey = () => `${config.cachePrefix}:digit-managed-accounts`;
const indexField = (identity: ManagedIdentity) => `${identity.subject}|${identity.tenantId}`;

async function findAccount(adminToken: string, identity: ManagedIdentity): Promise<DigitAccount | null> {
  for (const active of [true, false]) {
    const accounts = await searchAccounts(adminToken, {
      userName: identity.username, tenantId: identity.tenantId, userType: identity.userType, active,
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

/** Citizen roles are fixed by configuration, never taken from Keycloak. */
export function citizenDigitRoles(tenantId: string): DigitRole[] {
  return [...new Set(config.digitCitizenRoles)].sort()
    .map((code) => ({ code, name: code, tenantId }));
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

async function inventoriedAccounts(identity: ManagedIdentity): Promise<AccountRef[]> {
  const matches: AccountRef[] = [];
  for (const id of await getRedis().smembers(personTokensKey(identity.subject))) {
    const ref = parseAccountId(id);
    if (ref.tenantId !== identity.tenantId || (identity.linkedUuid && ref.uuid !== identity.linkedUuid)) continue;
    const token = await readToken(ref);
    if (token?.subject === identity.subject && token.kind === (identity.userType === CITIZEN_USER_TYPE ? "citizen" : "staff")) matches.push(ref);
  }
  return matches;
}

async function cachedLogin(identity: ManagedIdentity): Promise<DigitLogin | null> {
  return withPersonLease(identity.subject, async lease => {
    for (const account of await inventoriedAccounts(identity)) {
      const cached = await cachedToken(lease, account);
      if (cached) return cached;
    }
    return null;
  });
}
async function holdCachedLogin(identity: ManagedIdentity, sessionId: string): Promise<void> {
  await withPersonLease(identity.subject, async lease => {
    for (const account of await inventoriedAccounts(identity)) await holdToken(lease, account, sessionId);
  });
}
async function cacheLogin(identity: ManagedIdentity, sessionId: string, login: DigitLogin): Promise<void> {
  await withPersonLease(identity.subject, async lease => {
    const uuid = login.user.uuid;
    if (typeof uuid !== "string" || !uuid) {
      await revokeToken(login.accessToken);
      throw new DigitUnavailableError("DIGIT login returned no account uuid");
    }
    const account = { tenantId: identity.tenantId, uuid };
    await recordToken(lease, account, login, identity.userType === CITIZEN_USER_TYPE ? "citizen" : "staff");
    try { await holdToken(lease, account, sessionId); }
    catch (error) {
      await revokeInventoriedToken(account, { ...login, subject: identity.subject, mintedAt: Date.now(), kind: identity.userType === CITIZEN_USER_TYPE ? "citizen" : "staff" }, "SESSION_REVOKED");
      await forgetToken(lease, account, login.accessToken);
      throw error;
    }
  });
}
async function dropCachedLogin(identity: ManagedIdentity): Promise<void> {
  await withPersonLease(identity.subject, async lease => {
    for (const account of await inventoriedAccounts(identity)) {
      const token = await readToken(account);
      if (!token) continue;
      await lease.assertHeld();
      await revokeInventoriedToken(account, token, "ROLE_CHANGED");
      await forgetToken(lease, account, token.accessToken);
    }
  });
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
  return withPersonLease(identity.subject, () => withDigitAdmin(async (adminToken) => {
    const account = await findAccount(adminToken, identity);
    if (account && options.createOnly) return { account, created: false, changed: false };
    const citizen = identity.userType === CITIZEN_USER_TYPE;
    const roles = roleCodes === null
      ? []
      : citizen
        ? citizenDigitRoles(identity.tenantId)
        : desiredDigitRoles(identity.tenantId, roleCodes);

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
        type: identity.userType,
        active: true,
        identificationMark: identity.marker,
        roles,
        password,
      });
      // No login here. Cached DIGIT tokens belong to a BFF session and
      // provisioning has none to attribute one to, so logging in now would
      // mint a token no logout could ever revoke. The first
      // /contexts/_select rotates the password and logs in for its session.
      if (citizen && profile.mobileNumber) {
        await getRedis().set(
          citizenMobileKey(identity),
          citizenMobileHint(profile.countryCode, profile.mobileNumber),
          "EX", CITIZEN_MOBILE_HINT_SECONDS,
        );
      }
      // Citizen accounts stay out of the Organization-driven inventory, which
      // would otherwise deactivate them for having no membership; their
      // durable record is the CitizenRegistration.
      if (!citizen) {
        await getRedis().hset(managedAccountsKey(), indexField(identity), identity.issuer);
        await recordManagedTenant(identity.subject, identity.tenantId);
      }
      return { account: created, created: true, changed: true };
    }

    if (!citizen) {
      await getRedis().hset(managedAccountsKey(), indexField(identity), identity.issuer);
      await recordManagedTenant(identity.subject, identity.tenantId);
    }
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
 * Returns a normal user-scoped DIGIT token for an active managed account,
 * cached for `sessionId` alone. A valid cached token is reused. Otherwise,
 * under the per-user lease, the account's password is rotated to a new
 * one-time value and the BFF logs in once as that user. Citizen logins need
 * the session's verified national mobile number (the OTP identity).
 */
export async function managedUserLogin(
  identity: ManagedIdentity,
  sessionId: string,
  verifiedMobileNumber?: string,
  verifiedCountryCode?: string,
): Promise<DigitLogin> {
  const lease = currentPersonLease();
  if (!lease) {
    return withPersonLease(identity.subject, () => managedUserLogin(identity, sessionId, verifiedMobileNumber, verifiedCountryCode));
  }
  if (lease.subject !== identity.subject) throw new Error("Staff login requires its person's lease");
  await requireCurrentSession(lease, sessionId);
  if (identity.linkedUuid) {
    // Every sign-in re-checks a linked account, cached token or not: a
    // deactivation in HRMS or egov-user must end access at the next _select.
    const live = await withDigitAdmin((adminToken) => findLinkedAccount(adminToken, identity));
    if (!live) {
      await dropCachedLogin(identity);
      throw new ManagedAccountError("The linked DIGIT account is not active", 403, "DIGIT_ACCOUNT_INACTIVE");
    }
  }
  // The lease is held from here on, so no other request can cache a token.
  const cached = await cachedLogin(identity);
  if (cached) {
    await holdCachedLogin(identity, sessionId);
    return cached;
  }
  return withDigitAdmin(async (adminToken) => {
    const account = identity.linkedUuid
      ? await findLinkedAccount(adminToken, identity)
      : await findAccount(adminToken, identity);
    if (!account) {
      throw new ManagedAccountError("No active DIGIT account is managed for this identity", 403);
    }
    if (!account.active) {
      throw new ManagedAccountError("The DIGIT account is not active", 403, "DIGIT_ACCOUNT_INACTIVE");
    }
    let login: DigitLogin;
    if (identity.userType === CITIZEN_USER_TYPE) {
      // A citizen password grant is validated as an OTP; see CitizenTokenMinter.
      if (!verifiedMobileNumber) {
        throw new ManagedAccountError("A verified phone number is required", 403, "PHONE_NOT_VERIFIED");
      }
      // egov-user checks the OTP against the STORED mobile number, so a
      // citizen who verified a new number first has it written through.
      // Compare with what DIGIT stores; only when the search masks it, fall
      // back to the number this BFF last wrote.
      const stored = account.mobileNumber?.trim() || "";
      const hint = citizenMobileHint(verifiedCountryCode, verifiedMobileNumber);
      const differs = stored && !stored.includes("*")
        ? stored !== verifiedMobileNumber ||
          (!!verifiedCountryCode && (account.countryCode?.trim() || "") !== verifiedCountryCode)
        : await getRedis().get(citizenMobileKey(identity)) !== hint;
      if (differs) {
        const changes = {
          mobileNumber: verifiedMobileNumber,
          ...(verifiedCountryCode && { countryCode: verifiedCountryCode }),
        };
        if (identity.linkedUuid) {
          await writeLinkedAccount(adminToken, account, changes);
        } else {
          await updateAccount(adminToken, { ...editable(account), ...changes });
        }
        await getRedis().set(citizenMobileKey(identity), hint, "EX", CITIZEN_MOBILE_HINT_SECONDS);
      }
      login = await citizenTokenMinter().mint(account, verifiedMobileNumber);
    } else if (staffCredentialMode() === "derived") {
      const user = await readUser(identity.subject);
      let keyVersion: number | undefined;
      try {
        const entry = accountEntries(user).find((entry) => entry.kind === "staff" &&
          entry.tenantId === account.tenantId && entry.uuid === account.uuid);
        if (Number.isSafeInteger(entry?.credential?.keyVersion) && (entry?.credential?.keyVersion ?? 0) > 0) {
          keyVersion = entry!.credential!.keyVersion;
        }
      } catch { /* No readable mirror: staffLogin tries the current key before activation. */ }
      login = await staffLogin({ ...account, keyVersion }, lease);
    } else {
      const password = oneTimePassword();
      if (identity.linkedUuid) await writeLinkedAccount(adminToken, account, { password });
      else await updateAccount(adminToken, { ...editable(account), password });
      // A linked account keeps its own username; its legacy password is
      // replaced here, as for every account the BFF signs in (#2167).
      login = await passwordLogin({
        username: account.userName, password, tenantId: account.tenantId, userType: identity.userType,
      });
    }
    await cacheLogin(identity, sessionId, login);
    return login;
  });
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
