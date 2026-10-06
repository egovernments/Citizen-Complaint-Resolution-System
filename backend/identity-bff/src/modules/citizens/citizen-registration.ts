import { config } from "../../infrastructure/config.js";
import type { MobileValidation } from "../citizen-otp/mobile-validation.js";
import {
  citizenIdentity,
  ensureManagedAccount,
  ManagedAccountError,
  type ManagedIdentity,
} from "../managed-accounts/managed-account-service.js";
import { AccountLinkError, resolveCitizenLink } from "../account-links/account-links.js";
import {
  citizenRegistrationValues,
  updateCitizenRegistrationValues,
} from "../organizations/organization-service.js";
import type { BoundTenant } from "../authentication/surfaces.js";

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
 * proved by a BFF OTP, or users cannot edit it in Keycloak.
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
  const existing = (await citizenRegistrations(subject)).find((candidate) =>
    candidate.rootTenantId === tenant.rootTenantId && candidate.tenantId === tenant.tenantId);
  if (existing?.status === "DISABLED") {
    throw new CitizenContextError("Citizen access is disabled for this tenant", 403);
  }
  let identity: ManagedIdentity;
  let digitUserUuid: string;
  try {
    const linked = await resolveCitizenLink({
      subject, routeTenantId: tenant.tenantId, mobileNumber: input.mobileNumber, phoneTrusted: input.phoneTrusted,
    });
    if (linked) {
      identity = linked;
      digitUserUuid = linked.linkedUuid!;
    } else {
      identity = citizenIdentity(config.keycloakIssuer, subject, tenant.tenantId);
      const outcome = await ensureManagedAccount(identity, [], {
        name: input.name,
        mobileNumber: input.mobileNumber,
        countryCode: input.countryCode,
      }, { createOnly: true });
      if (!outcome.account?.active) {
        throw new CitizenContextError("Citizen access is not available for this tenant", 403);
      }
      digitUserUuid = outcome.account.uuid;
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
