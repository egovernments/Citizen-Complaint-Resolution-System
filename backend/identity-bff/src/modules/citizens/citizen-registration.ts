import { config } from "../../infrastructure/config.js";
import type { MobileValidation } from "../citizen-otp/mobile-validation.js";
import {
  citizenIdentity,
  digitCitizenTenantId,
  ensureManagedAccount,
  ManagedAccountError,
  type ManagedIdentity,
  type ManagedProfile,
} from "../managed-accounts/managed-account-service.js";
import type { DigitAccount } from "../managed-accounts/digit-user-client.js";
import { AccountLinkError, resolveCitizenLink } from "../account-links/account-links.js";
import {
  citizenRegistrationValues,
  updateCitizenRegistrationValues,
} from "../organizations/organization-service.js";
import type { BoundTenant } from "../authentication/surfaces.js";
import { readUser } from "../../integrations/keycloak/admin-api.js";
import { accountEntries } from "../sync/state.js";
import { readDigitAccount } from "../workspace-members/authority.js";

/**
 * A citizen's service relationship with one tenant root (#2071, #2167).
 *
 * Deliberately NOT Keycloak Organization membership: a citizen is a service
 * user of a tenant, not part of its workforce, and never appears in its
 * Organization. Employees keep OrganizationMembership; the two relationships
 * never imply each other, even for one Keycloak user.
 *
 * Persistence: a multi-valued Keycloak user attribute
 * `digit.citizenRegistrations` on the principal's own user, next to
 * `digit.managedTenants` (the durable employee-account inventory). This is
 * the codebase's existing pattern for durable per-principal DIGIT linkage:
 * it survives Redis loss (Redis only holds attempts, sessions and token
 * caches here), it is removed with the Keycloak user, and it needs no new
 * datastore. Requires the realm's `unmanagedAttributePolicy` to be
 * ADMIN_EDIT (set by the #2167 installer) or Keycloak drops the attribute.
 *
 * One value per tenant-local projection:
 *   `v1|<rootTenantId>|<tenantId>|<status>|<digitUserUuid>`
 * For a root route `tenantId === rootTenantId`, which is exactly the
 * contract record. A subtenant route keeps the same root and adds its own
 * tenant-local projection, so access can be granted or disabled per route
 * tenant.
 *
 * The DIGIT account behind it is NOT tenant-local: egov-user keeps every
 * CITIZEN at its state root (`digitCitizenTenantId`, the first dotted
 * segment) and issues the token there. So `digitUserUuid` is the one
 * root-level CITIZEN account of this principal, shared by every registration
 * under that root, and business requests still target the route tenant.
 */
export type CitizenRegistrationStatus = "ACTIVE" | "DISABLED";

export interface CitizenRegistration {
  principalId: { issuer: string; subject: string };
  rootTenantId: string;
  tenantId: string;
  status: CitizenRegistrationStatus;
  digitUserUuid: string;
}

export class CitizenContextError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
  }
}

const VERSION = "v1";

function encode(registration: CitizenRegistration): string {
  return [
    VERSION,
    registration.rootTenantId,
    registration.tenantId,
    registration.status,
    registration.digitUserUuid,
  ].join("|");
}

export function parseCitizenRegistration(
  value: string,
  subject: string,
  issuer = config.keycloakIssuer,
): CitizenRegistration | null {
  const [version, rootTenantId, tenantId, status, digitUserUuid, ...rest] = value.split("|");
  if (version !== VERSION || rest.length || !rootTenantId || !tenantId || !digitUserUuid ||
      (status !== "ACTIVE" && status !== "DISABLED")) {
    return null;
  }
  return { principalId: { issuer, subject }, rootTenantId, tenantId, status, digitUserUuid };
}

export async function citizenRegistrations(subject: string): Promise<CitizenRegistration[]> {
  return (await citizenRegistrationValues(subject)).flatMap((value) => {
    const registration = parseCitizenRegistration(value, subject);
    return registration ? [registration] : [];
  });
}

/**
 * What a staff person's first citizen account at this tenant starts with from their employee
 * record (#2595). It only seeds a new account; the citizen edits it from then on.
 */
async function staffProfile(subject: string, tenantId: string): Promise<Pick<ManagedProfile, "emailId" | "gender">> {
  const entry = accountEntries(await readUser(subject))
    .find((candidate) => candidate.kind === "staff" && candidate.tenantId === tenantId && candidate.active && !candidate.missing);
  const account = entry && await readDigitAccount(tenantId, entry.uuid);
  if (!account) return {};
  // A masked value (`ga****@…`) is a search artefact, not the person's email.
  const emailId = account.emailId?.trim() && !/\*{2,}/.test(account.emailId) ? account.emailId.trim() : undefined;
  return { ...(emailId && { emailId }), ...(account.gender && { gender: account.gender }) };
}

const E164 = /^\+[1-9]\d{6,14}$/;

/**
 * Splits a verified E.164 number into DIGIT's `countryCode` + national
 * `mobileNumber` using the tenant's MobileNumberValidation rule. A number
 * from another country, or one the tenant's regex rejects, is refused:
 * egov-user would otherwise store a citizen it cannot validate.
 */
export function splitE164(
  phoneNumber: string,
  rule: MobileValidation,
): { countryCode: string; mobileNumber: string } | null {
  if (!E164.test(phoneNumber)) return null;
  const dialDigits = rule.countryCode.replace(/^\+/, "");
  if (!/^[1-9]\d{0,3}$/.test(dialDigits) || !phoneNumber.startsWith(`+${dialDigits}`)) return null;
  const mobileNumber = phoneNumber.slice(dialDigits.length + 1);
  let pattern: RegExp;
  try {
    pattern = new RegExp(rule.mobileNumberRegex);
  } catch {
    return null;
  }
  return pattern.test(mobileNumber) ? { countryCode: rule.countryCode, mobileNumber } : null;
}

/**
 * Ensures the principal's registration at `tenant` and its BFF-managed DIGIT
 * CITIZEN account at egov-user's citizen tenant (created there explicitly, so
 * egov-user validates, encrypts and stores it at the tenant it will later
 * search and log in at). Existing accounts are never re-roled
 * (`createOnly`), and a DISABLED registration or deactivated account is
 * refused.
 *
 * An EXISTING DIGIT citizen with the same number is linked instead of a new
 * account being created (#2167), but only when `phoneTrusted`: the number was
 * proved by a BFF OTP, or users cannot edit it in Keycloak. The same trust
 * names a new account by its national number (#2640).
 */
export async function ensureCitizenRegistration(input: {
  subject: string;
  tenant: BoundTenant;
  name: string;
  countryCode: string;
  mobileNumber: string;
  phoneTrusted: boolean;
}): Promise<{ identity: ManagedIdentity; registration: CitizenRegistration }> {
  const { subject, tenant } = input;
  const registrations = await citizenRegistrations(subject);
  const existing = registrations.find((candidate) =>
    candidate.rootTenantId === tenant.rootTenantId && candidate.tenantId === tenant.tenantId);
  if (existing?.status === "DISABLED") {
    throw new CitizenContextError("Citizen access is disabled for this tenant", 403);
  }
  // Every route under one citizen tenant shares its account.
  const citizenTenantId = digitCitizenTenantId(tenant.tenantId);
  const accountUuid = (existing ?? registrations.find((candidate) =>
    digitCitizenTenantId(candidate.tenantId) === citizenTenantId))?.digitUserUuid;
  const link = () => resolveCitizenLink({
    subject, routeTenantId: tenant.tenantId, mobileNumber: input.mobileNumber, phoneTrusted: input.phoneTrusted,
    accountUuid,
  });
  let identity: ManagedIdentity;
  let digitUserUuid: string;
  try {
    let linked = await link();
    let account: DigitAccount | null = null;
    if (!linked) {
      const profile: ManagedProfile = {
        name: input.name,
        mobileNumber: input.mobileNumber,
        countryCode: input.countryCode,
        ...(!existing && await staffProfile(subject, tenant.tenantId)),
      };
      const create = async (userName?: string) => (await ensureManagedAccount(
        citizenIdentity(config.keycloakIssuer, subject, tenant.tenantId, accountUuid), [], profile,
        { createOnly: true, userName },
      )).account;
      try {
        // A proved number names the new account, as DIGIT names its citizens,
        // so pgr-services' userName = mobile lookup finds the account this
        // person signs in with (#2640).
        account = await create(input.phoneTrusted ? input.mobileNumber : undefined);
      } catch (error) {
        if (!(error instanceof ManagedAccountError && error.code === "DIGIT_USERNAME_TAKEN")) throw error;
        // Another account took the number after the phone search, e.g. one
        // pgr-services created for an employee-filed complaint: the legacy-link
        // rules decide again. One they do not link (a username left on an old
        // number) keeps this person on the opaque `kcbffc-` name.
        linked = await link();
        if (!linked) account = await create();
      }
    }
    if (linked) {
      identity = linked;
      digitUserUuid = linked.linkedUuid!;
    } else {
      if (!account?.active) {
        throw new CitizenContextError("Citizen access is not available for this tenant", 403);
      }
      digitUserUuid = account.uuid;
      identity = citizenIdentity(config.keycloakIssuer, subject, tenant.tenantId, digitUserUuid);
    }
  } catch (error) {
    if (error instanceof AccountLinkError) {
      throw new CitizenContextError(error.message, error.status, error.code);
    }
    if (error instanceof ManagedAccountError) {
      throw new CitizenContextError(error.message, error.status === 409 ? 409 : 403);
    }
    throw error;
  }
  const account = { uuid: digitUserUuid };
  const registration: CitizenRegistration = {
    principalId: { issuer: config.keycloakIssuer, subject },
    rootTenantId: tenant.rootTenantId,
    tenantId: tenant.tenantId,
    status: "ACTIVE",
    digitUserUuid: account.uuid,
  };
  if (existing?.digitUserUuid !== account.uuid) {
    await updateCitizenRegistrationValues(subject, (values) => {
      // Re-read inside the write: never resurrect a registration an
      // administrator disabled between the two reads.
      const current = values.flatMap((value) => {
        const parsed = parseCitizenRegistration(value, subject);
        return parsed ? [{ value, parsed }] : [];
      });
      const same = current.find(({ parsed }) =>
        parsed.rootTenantId === tenant.rootTenantId && parsed.tenantId === tenant.tenantId);
      if (same?.parsed.status === "DISABLED") {
        throw new CitizenContextError("Citizen access is disabled for this tenant", 403);
      }
      if (same?.parsed.digitUserUuid === account.uuid) return null;
      return [
        ...values.filter((value) => value !== same?.value),
        encode(registration),
      ].sort();
    });
  }
  return { identity, registration };
}
