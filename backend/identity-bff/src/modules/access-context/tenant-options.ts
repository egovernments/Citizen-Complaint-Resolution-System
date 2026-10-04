import type { KeycloakClaims } from "../authentication/types.js";
import { managedFallbackAccess } from "../bindings/managed-fallback.js";
import { staffAccess } from "../bindings/predicate.js";
import { readBindings } from "../bindings/store.js";
import { readOrganizationByTenant } from "../onboarding/organization-reader.js";
import { readDigitAccount } from "../workspace-members/authority.js";
import { liveMembershipsForSubject, tenantOption, type TenantOption } from "./tenant-directory.js";

/** Fresh authorization; inactive DIGIT employees remain visible with a reason. */
export async function resolveTenantOptions(claims: KeycloakClaims, _live = false): Promise<TenantOption[]> {
  const tenants = new Set((await liveMembershipsForSubject(claims.sub)).map((m) => m.tenantId));
  for (const binding of await readBindings(claims.sub)) if (binding.state === "active") tenants.add(binding.tenantId);
  const result: TenantOption[] = [];
  for (const tenantId of tenants) {
    const option = await resolveTenantOption(claims.sub, tenantId);
    if (option) result.push(option);
  }
  return result.sort((a, b) => a.name.localeCompare(b.name));
}

export async function resolveTenantOption(subject: string, tenantId: string): Promise<TenantOption | null> {
  const access = await staffAccess(subject, tenantId);
  if (!access.allowed) return null;
  if (access.via === "managed") {
    const fallback = await managedFallbackAccess(subject, tenantId);
    return fallback.allowed ? tenantOption({ ...fallback.mapping, roles: [] }, fallback.account) : null;
  }
  const org = await readOrganizationByTenant(tenantId);
  if (!org?.enabled || (org.lifecycle !== null && org.lifecycle !== "ACTIVE")) return null;
  const account = await readDigitAccount(tenantId, access.binding!.uuid);
  if (!account) return null;
  return { organizationId: org.id, organizationAlias: org.alias, tenantId, name: org.name,
    roles: [...new Set(account.roles.filter((r) => r.tenantId === tenantId).map((r) => r.code))].sort(),
    ...(!account.active && { code: "DIGIT_ACCOUNT_INACTIVE" as const }) };
}
