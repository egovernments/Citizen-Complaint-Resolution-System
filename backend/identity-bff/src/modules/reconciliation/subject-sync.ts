import { config } from "../../infrastructure/config.js";
import { readIdentityUserProfile } from "../organizations/organization-service.js";
import { desiredRolesBySubject, desiredRolesForSubjectTenant } from "./reconciliation-service.js";
import {
  ensureManagedAccount,
  type EnsureResult,
  findManagedAccount,
  managedIdentity,
  managedTenantsOf,
} from "../managed-accounts/managed-account-service.js";

/**
 * Re-derives a Keycloak subject's per-tenant DIGIT roles from live Keycloak
 * Organization state and applies them to its managed accounts, deactivating
 * accounts at tenants it has left. Passing `mobileNumber` (possibly empty)
 * allows creating missing accounts from the Keycloak profile; an empty value
 * falls back to the mobile number on the subject's existing managed account.
 */
export async function syncSubject(
  userId: string,
  mobileNumber?: string,
  countryCode?: string,
): Promise<Map<string, EnsureResult>> {
  const desired = (await desiredRolesBySubject()).bySubject.get(userId) || new Map<string, string[]>();
  const managedTenants = await managedTenantsOf(config.keycloakIssuer, userId);
  let contact = mobileNumber?.trim() || "";
  let dialCode = countryCode?.trim() || "";
  // The same person already has a managed account elsewhere: reuse its contact.
  for (const tenantId of managedTenants) {
    if (contact || mobileNumber === undefined) break;
    const sibling = await findManagedAccount(managedIdentity(config.keycloakIssuer, userId, tenantId))
      .catch(() => null);
    contact = sibling?.mobileNumber || "";
    dialCode ||= sibling?.countryCode || "";
  }
  const profile = mobileNumber === undefined
    ? undefined
    : {
        ...await readIdentityUserProfile(userId),
        mobileNumber: contact,
        ...(dialCode && { countryCode: dialCode }),
      };
  const tenants = new Set([...desired.keys(), ...managedTenants]);
  const results = new Map<string, EnsureResult>();
  for (const tenantId of tenants) {
    results.set(tenantId, await ensureManagedAccount(
      managedIdentity(config.keycloakIssuer, userId, tenantId),
      desired.get(tenantId) ?? null,
      profile,
    ));
  }
  return results;
}

/**
 * Reconciles one explicitly selected tenant from live Keycloak state, reading
 * only that tenant's Organization and only this subject's membership in it.
 */
export async function syncSubjectTenant(
  userId: string,
  tenantId: string,
  mobileNumber?: string,
  countryCode?: string,
): Promise<EnsureResult> {
  const desired = await desiredRolesForSubjectTenant(userId, tenantId);
  if (desired === null) {
    return ensureManagedAccount(managedIdentity(config.keycloakIssuer, userId, tenantId), null);
  }
  const profile = mobileNumber === undefined
    ? undefined
    : {
        ...await readIdentityUserProfile(userId),
        mobileNumber: mobileNumber.trim(),
        ...(countryCode?.trim() && { countryCode: countryCode.trim() }),
      };
  return ensureManagedAccount(
    managedIdentity(config.keycloakIssuer, userId, tenantId), desired, profile,
  );
}
