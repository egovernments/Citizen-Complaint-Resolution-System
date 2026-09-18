import { config } from "../../infrastructure/config.js";
import type { KeycloakClaims } from "../authentication/types.js";
import { isOrganizationMember } from "../organizations/organization-service.js";
import {
  findManagedAccount,
  ManagedAccountError,
  managedIdentity,
} from "../managed-accounts/managed-account-service.js";
import { readOrganizationMappingForTenant } from "../organizations/organization-service.js";
import {
  isActiveDigitTenant,
  liveMembershipsForSubject,
  membershipsFromClaims,
  tenantOption,
  type TenantOption,
} from "./tenant-directory.js";

/**
 * Return only Organizations that also have a usable managed DIGIT account.
 * Discovery is read-only; creation and role projection happen during
 * provisioning or explicit context selection.
 */
export async function resolveTenantOptions(
  claims: KeycloakClaims,
  live = false,
): Promise<TenantOption[]> {
  const memberships = live
    ? await liveMembershipsForSubject(claims.sub)
    : await membershipsFromClaims(claims);
  const options: TenantOption[] = [];
  for (const membership of memberships) {
    const identity = managedIdentity(config.keycloakIssuer, claims.sub, membership.tenantId);
    const account = await findManagedAccount(identity).catch((error) => {
      if (error instanceof ManagedAccountError) return null;
      throw error;
    });
    const option = tenantOption(membership, account);
    if (option) options.push(option);
  }
  return options;
}

/**
 * The same option `resolveTenantOptions` would produce for one tenant, read
 * through that tenant's Organization alone.
 *
 * Context selection names the tenant it wants, so resolving the caller's whole
 * directory first — a membership probe against every Organization in the realm
 * — was work thrown away. (Dhruv review, #2088.)
 */
export async function resolveTenantOption(
  subject: string,
  tenantId: string,
): Promise<TenantOption | null> {
  const mapping = await readOrganizationMappingForTenant(tenantId);
  if (!mapping || !await isActiveDigitTenant(mapping.tenantId)) return null;
  if (!await isOrganizationMember(mapping.organizationId, subject)) return null;
  const identity = managedIdentity(config.keycloakIssuer, subject, mapping.tenantId);
  const account = await findManagedAccount(identity).catch((error) => {
    if (error instanceof ManagedAccountError) return null;
    throw error;
  });
  return tenantOption({ ...mapping, roles: [] }, account);
}
