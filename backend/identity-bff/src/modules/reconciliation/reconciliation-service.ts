import { config } from "../../infrastructure/config.js";
import {
  listTenantDirectory,
  type TenantMapping,
  readTenantMappingForTenant,
  readOrganizationGroupReconciliation,
  readOrganizationReconciliation,
} from "../organizations/organization-service.js";
import { isActiveDigitTenant } from "../access-context/tenant-directory.js";
import type { DesiredRoles } from "../managed-accounts/managed-account-service.js";

function allowlisted(roles: string[]): string[] {
  return roles.filter((role) => config.digitManagedRoleAllowlist.includes(role));
}

/** Desired DIGIT roles per Keycloak subject from enabled, DIGIT-mapped Organizations. */
export async function desiredRolesBySubject(): Promise<{
  organizations: number;
  bySubject: Map<string, DesiredRoles>;
  /** Tenant ids (lower case) whose mapping collided: their desired roles are unknown. */
  collidedTenantIds: Set<string>;
}> {
  const bySubject = new Map<string, DesiredRoles>();
  let organizations = 0;
  const directory = await listTenantDirectory();
  for (const mapping of directory.mappings as TenantMapping[]) {
    if (!await isActiveDigitTenant(mapping.tenantId)) continue;
    const state = mapping.mappingType === "organization-group"
      ? await readOrganizationGroupReconciliation(mapping, config.digitRoleClientId)
      : await readOrganizationReconciliation(mapping.organizationId, config.digitRoleClientId);
    if (!state?.enabled) continue;
    organizations += 1;
    for (const [subject, roles] of state.memberRoles) {
      const desired = bySubject.get(subject) || new Map<string, string[]>();
      desired.set(mapping.tenantId, allowlisted(roles));
      bySubject.set(subject, desired);
    }
  }
  return { organizations, bySubject, collidedTenantIds: directory.collidedTenantIds };
}

/**
 * The allowlisted DIGIT roles one subject should hold at one tenant, or null
 * when it is not an active member there.
 *
 * This is the login and invite path, and it reads only the Organization mapped
 * to `tenantId` and only that subject's membership within it.
 * `desiredRolesBySubject` above answers the same question by walking the whole
 * realm, which made one `/contexts/_select` cost admin calls proportional to
 * the total number of users. (Dhruv review, #2088.)
 */
export async function desiredRolesForSubjectTenant(
  subject: string,
  tenantId: string,
): Promise<string[] | null> {
  if (!await isActiveDigitTenant(tenantId)) return null;
  const mapping = await readTenantMappingForTenant(tenantId);
  if (!mapping) return null;
  const state = mapping.mappingType === "organization-group"
    ? await readOrganizationGroupReconciliation(mapping, config.digitRoleClientId, subject)
    : await readOrganizationReconciliation(
      mapping.organizationId, config.digitRoleClientId, subject,
    );
  if (!state?.enabled) return null;
  const roles = state.memberRoles.get(subject);
  return roles === undefined ? null : allowlisted(roles);
}
