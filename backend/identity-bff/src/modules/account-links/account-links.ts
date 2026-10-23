import { config } from "../../infrastructure/config.js";
import { withRedisLease } from "../../infrastructure/redis.js";
import { LeaseBusyError, withPersonLease } from "../accounts/person-lease.js";
import { audit } from "../citizen-otp/audit.js";
import { withDigitAdmin } from "../managed-accounts/digit-admin-session.js";
import { searchAccounts, type DigitAccount } from "../managed-accounts/digit-user-client.js";
import {
  CITIZEN_USER_TYPE,
  citizenIdentity,
  dropLinkedLogin,
  findActiveAccount,
  findManagedAccount,
  isBffManagedAccount,
  linkedIdentity,
  type ManagedIdentity,
  type ManagedUserType,
} from "../managed-accounts/managed-account-service.js";
import {
  accountLinkValues,
  updateAccountLinkBlockValues,
  updateAccountLinkValues,
  usersWithAccountLink,
} from "../organizations/organization-service.js";

/**
 * Links between a Keycloak user and an EXISTING DIGIT account (#2167). A link
 * keeps the account's uuid, roles and history; the BFF only signs it in.
 * Links are made by an admin (employees) or by a trusted verified phone
 * (citizens), never by a matching username, and every link is audited and
 * can be undone by an admin.
 */

export const EMPLOYEE_USER_TYPE = "EMPLOYEE" as const;

export interface AccountLink {
  userType: ManagedUserType;
  tenantId: string;
  digitUuid: string;
}

export type LinkMethod = "ADMIN" | "VERIFIED_PHONE";

export class AccountLinkError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message);
  }
}

export function encodeLink(link: AccountLink): string {
  return `${link.userType}|${link.tenantId}|${link.digitUuid}`;
}

export function parseLink(value: string): AccountLink | null {
  const [userType, tenantId, digitUuid, ...rest] = value.split("|");
  if (rest.length || !tenantId || !digitUuid ||
      (userType !== EMPLOYEE_USER_TYPE && userType !== CITIZEN_USER_TYPE)) return null;
  return { userType, tenantId, digitUuid };
}

export async function linksOf(subject: string): Promise<{ links: AccountLink[]; blocks: AccountLink[] }> {
  const { links, blocks } = await accountLinkValues(subject);
  const parse = (values: string[]) => values.flatMap((value) => {
    const link = parseLink(value);
    return link ? [link] : [];
  });
  return { links: parse(links), blocks: parse(blocks) };
}

/** The linked identity for the subject at a tenant, if an admin or a phone made one. */
export async function linkedIdentityFor(
  subject: string,
  userType: ManagedUserType,
  tenantId: string,
): Promise<ManagedIdentity | null> {
  const link = (await linksOf(subject)).links.find((candidate) =>
    candidate.userType === userType && candidate.tenantId === tenantId);
  return link ? linkedIdentity(config.keycloakIssuer, subject, link) : null;
}

/** One writer per DIGIT account, so two subjects cannot both claim it. */
function withAccountLease<T>(digitUuid: string, operation: () => Promise<T>): Promise<T> {
  return withRedisLease(`${config.cachePrefix}:account-link-lease:${digitUuid}`, {
    ttlMs: config.digitUserLeaseSeconds * 1000, waitMs: config.digitUserLeaseWaitMs, retryMs: 150,
    busy: () => new AccountLinkError("The account is being linked; retry", 503, "ACCOUNT_LINK_BUSY"),
  }, operation);
}

/**
 * The person lease is taken first (lock order person → uuid, §2.5) and held
 * across the read and every attribute write, so a concurrent `_select` or
 * mirror write for the same person cannot erase a link or a block. A caller
 * already holding it reuses it.
 */
async function withLinkPersonLease<T>(subject: string, operation: () => Promise<T>): Promise<T> {
  try {
    return await withPersonLease(subject, () => operation());
  } catch (error) {
    if (error instanceof LeaseBusyError) throw new AccountLinkError("The person is busy; retry", 503, "ACCOUNT_LINK_BUSY");
    throw error;
  }
}

/** Finds an existing DIGIT employee by username for an admin import. */
export async function findEmployeeUuid(tenantId: string, userName: string): Promise<string | null> {
  const accounts = await withDigitAdmin((adminToken) => searchAccounts(adminToken, {
    userName, tenantId, userType: EMPLOYEE_USER_TYPE, active: true,
  }));
  return accounts.find((account) => account.userName === userName)?.uuid || null;
}

export async function createAccountLink(input: AccountLink & {
  subject: string;
  method: LinkMethod;
  actor: string;
}): Promise<{ status: "LINKED" | "ALREADY_LINKED"; account: DigitAccount }> {
  const link: AccountLink = { userType: input.userType, tenantId: input.tenantId, digitUuid: input.digitUuid };
  const value = encodeLink(link);
  const base = {
    subject: input.subject, tenantId: link.tenantId, userType: link.userType,
    digitUserUuid: link.digitUuid, method: input.method, actor: input.actor,
  };
  const refuse = async (message: string, status: number, code: string): Promise<never> => {
    await audit({ ...base, event: "ACCOUNT_LINK_REFUSED", outcome: "REFUSED", reason: code });
    throw new AccountLinkError(message, status, code);
  };
  return withLinkPersonLease(input.subject, () => withAccountLease(link.digitUuid, async () => {
    const account = await withDigitAdmin((adminToken) =>
      findActiveAccount(adminToken, { uuid: link.digitUuid, tenantId: link.tenantId, userType: link.userType }));
    if (!account) return refuse("No active DIGIT account matches", 404, "DIGIT_ACCOUNT_NOT_FOUND");
    if (isBffManagedAccount(account)) {
      return refuse("Accounts created by the identity service cannot be linked", 409, "DIGIT_ACCOUNT_MANAGED");
    }
    const owners = await usersWithAccountLink(value);
    if (owners.some((owner) => owner !== input.subject)) {
      return refuse("The DIGIT account is linked to someone else", 409, "DIGIT_ACCOUNT_LINKED_ELSEWHERE");
    }
    const { links, blocks } = await linksOf(input.subject);
    if (owners.includes(input.subject)) return { status: "ALREADY_LINKED" as const, account };
    if (links.some((existing) => existing.userType === link.userType && existing.tenantId === link.tenantId)) {
      return refuse("This person already has a linked account at the tenant", 409, "SUBJECT_ALREADY_LINKED");
    }
    if (input.method === "VERIFIED_PHONE" && blocks.some((blocked) => encodeLink(blocked) === value)) {
      return refuse("An administrator removed this link", 409, "CITIZEN_ACCOUNT_LINK_BLOCKED");
    }
    await updateAccountLinkValues(input.subject, (values) =>
      values.includes(value) ? null : [...values, value].sort());
    // An admin link is the explicit override of an earlier block.
    if (input.method === "ADMIN") {
      await updateAccountLinkBlockValues(input.subject, (values) =>
        values.includes(value) ? values.filter((candidate) => candidate !== value) : null);
    }
    await audit({ ...base, event: "ACCOUNT_LINK_CREATE", outcome: "SUCCESS" });
    return { status: "LINKED" as const, account };
  }));
}

/**
 * Admin undo. The DIGIT account itself is untouched; its cached tokens are
 * revoked. `block` keeps a phone link from re-forming at the next sign-in.
 */
export async function removeAccountLink(input: AccountLink & {
  subject: string;
  block: boolean;
  actor: string;
}): Promise<{ removed: boolean }> {
  const link: AccountLink = { userType: input.userType, tenantId: input.tenantId, digitUuid: input.digitUuid };
  const value = encodeLink(link);
  return withLinkPersonLease(input.subject, async () => {
    // Block first: a phone sign-in racing this unlink then finds either the
    // link (still valid) or the block, never a gap in which to re-link.
    if (input.block) {
      await updateAccountLinkBlockValues(input.subject, (values) =>
        values.includes(value) ? null : [...values, value].sort());
    }
    let removed = false;
    await updateAccountLinkValues(input.subject, (values) => {
      removed = values.includes(value);
      return removed ? values.filter((candidate) => candidate !== value) : null;
    });
    await dropLinkedLogin(linkedIdentity(config.keycloakIssuer, input.subject, link));
    await audit({
      event: "ACCOUNT_LINK_REVOKE", outcome: "SUCCESS", subject: input.subject, tenantId: link.tenantId,
      userType: link.userType, digitUserUuid: link.digitUuid, actor: input.actor,
      ...(!removed && { reason: "NOT_LINKED" }), ...(input.block && { detail: "blocked" }),
    });
    return { removed };
  });
}

/**
 * The existing DIGIT citizen account a verified phone should sign in to, or
 * null to keep the managed-account path. Order: an existing link; then the
 * subject's own managed account, if it already has one; then, only for a
 * trusted phone, exactly one unlinked, non-managed CITIZEN with that mobile
 * number at egov-user's citizen tenant. Two or more fail closed.
 */
export async function resolveCitizenLink(input: {
  subject: string;
  routeTenantId: string;
  mobileNumber: string;
  phoneTrusted: boolean;
}): Promise<ManagedIdentity | null> {
  const managed = citizenIdentity(config.keycloakIssuer, input.subject, input.routeTenantId);
  const citizenTenantId = managed.tenantId;
  const existing = await linkedIdentityFor(input.subject, CITIZEN_USER_TYPE, citizenTenantId);
  if (existing) return existing;
  if (await findManagedAccount(managed)) return null;
  if (!input.phoneTrusted) return null;

  const candidates = (await withDigitAdmin((adminToken) => searchAccounts(adminToken, {
    mobileNumber: input.mobileNumber, tenantId: citizenTenantId, userType: CITIZEN_USER_TYPE, active: true,
  }))).filter((account) => account.type === CITIZEN_USER_TYPE && account.active &&
    account.tenantId === citizenTenantId && !isBffManagedAccount(account));
  if (candidates.length === 0) return null;
  if (candidates.length > 1) {
    await audit({
      event: "ACCOUNT_LINK_REFUSED", outcome: "REFUSED", reason: "CITIZEN_ACCOUNT_AMBIGUOUS",
      subject: input.subject, tenantId: citizenTenantId, userType: CITIZEN_USER_TYPE,
      method: "VERIFIED_PHONE", actor: "citizen",
    });
    throw new AccountLinkError(
      "More than one citizen account uses this number; an administrator must link it",
      409, "CITIZEN_ACCOUNT_AMBIGUOUS",
    );
  }
  try {
    await createAccountLink({
      subject: input.subject, userType: CITIZEN_USER_TYPE, tenantId: citizenTenantId,
      digitUuid: candidates[0].uuid, method: "VERIFIED_PHONE", actor: "citizen",
    });
  } catch (error) {
    if (error instanceof AccountLinkError && error.code === "DIGIT_ACCOUNT_LINKED_ELSEWHERE") {
      throw new AccountLinkError(error.message, 409, "CITIZEN_ACCOUNT_AMBIGUOUS");
    }
    throw error;
  }
  return linkedIdentity(config.keycloakIssuer, input.subject, {
    userType: CITIZEN_USER_TYPE, tenantId: citizenTenantId, digitUuid: candidates[0].uuid,
  });
}
