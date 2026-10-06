import { config } from "../../infrastructure/config.js";
import { isActiveDigitTenant } from "../access-context/tenant-directory.js";
import { findManagedAccount, managedIdentity } from "../managed-accounts/managed-account-service.js";
import { isOrganizationGroupMember, isOrganizationMember, liveTenantMapping, readTenantMappingForTenant, type TenantMapping } from "../organizations/organization-service.js";
import { readOrganizationByTenant } from "../onboarding/organization-reader.js";
import type { DigitAccount } from "../managed-accounts/digit-user-client.js";
import type { AccessDenial } from "./predicate.js";

/** Item 14 deletes this managed-account/group fallback after D13. Never call it for a binding key, even a removed one. */
export async function managedFallbackAccess(subject: string, tenantId: string): Promise<
  { allowed: true; mapping: TenantMapping; account: DigitAccount } | { allowed: false; denial: AccessDenial }
> {
  const cached = await readTenantMappingForTenant(tenantId);
  const mapping = cached && await liveTenantMapping(cached);
  if (!mapping) return { allowed: false, denial: "ORGANIZATION_INACTIVE" };
  const org = await readOrganizationByTenant(mapping.mappingType === "organization-group" ? mapping.rootTenantId : mapping.tenantId);
  if (!org?.enabled || (org.lifecycle !== null && org.lifecycle !== "ACTIVE")) return { allowed: false, denial: "ORGANIZATION_INACTIVE" };
  if (!await isActiveDigitTenant(tenantId)) return { allowed: false, denial: "TENANT_INACTIVE" };
  const member = mapping.mappingType === "organization-group"
    ? await isOrganizationGroupMember(mapping.organizationId, mapping.groupId, subject)
    : await isOrganizationMember(mapping.organizationId, subject);
  if (!member) return { allowed: false, denial: "NOT_A_MEMBER" };
  const account = await findManagedAccount(managedIdentity(config.keycloakIssuer, subject, tenantId));
  return account ? { allowed: true, mapping, account } : { allowed: false, denial: "NO_ACTIVE_BINDING" };
}
