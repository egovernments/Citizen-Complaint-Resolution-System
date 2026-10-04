import { config } from "../../infrastructure/config.js";
import {
  clearTenantMappingCache,
  isOrganizationGroupMember,
  isOrganizationMember,
  listTenantMappings,
  readOrganizationMapping,
  type OrganizationMapping,
  type TenantMapping,
} from "../organizations/organization-service.js";
import { DigitUnavailableError, type DigitAccount } from "../managed-accounts/digit-user-client.js";
import type { KeycloakClaims } from "../authentication/types.js";

export interface TenantOption {
  code?: "DIGIT_ACCOUNT_INACTIVE";
  organizationId: string;
  organizationAlias: string;
  tenantId: string;
  name: string;
  roles: string[];
}

export type OrganizationMembership = TenantMapping & {
  /** Allowlisted client roles Keycloak granted through Organization groups. */
  roles: string[];
};

const MAPPING_TTL_MS = 60_000;
const TENANT_TTL_MS = 300_000;
const mappings = new Map<string, { value: OrganizationMapping | null; expiresAt: number }>();
const tenants = new Map<string, { value: Set<string>; names: Map<string, string>; expiresAt: number }>();

async function cachedMapping(organizationId: string): Promise<OrganizationMapping | null> {
  const hit = mappings.get(organizationId);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  const value = await readOrganizationMapping(organizationId);
  mappings.set(organizationId, { value, expiresAt: Date.now() + MAPPING_TTL_MS });
  return value;
}

/** Tenant codes present in DIGIT MDMS `tenant.tenants` for the tenant's root. */
export async function isActiveDigitTenant(tenantId: string, options: { fresh?: boolean } = {}): Promise<boolean> {
  return (await rootTenants(tenantId.split(".")[0], options.fresh)).value.has(tenantId);
}

/** The MDMS display name of an active DIGIT tenant, or null. */
export async function digitTenantName(tenantId: string): Promise<string | null> {
  return (await rootTenants(tenantId.split(".")[0])).names.get(tenantId) ?? null;
}

async function rootTenants(root: string, fresh = false): Promise<{ value: Set<string>; names: Map<string, string> }> {
  const hit = tenants.get(root);
  if (!fresh && hit && hit.expiresAt > Date.now()) return hit;
  if (!config.digitMdmsSearchUrl) {
    throw new DigitUnavailableError("DIGIT MDMS search is not configured");
  }
  let response: Response;
  try {
    response = await fetch(config.digitMdmsSearchUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        RequestInfo: { apiId: "digit-identity-bff" },
        MdmsCriteria: {
          tenantId: root,
          moduleDetails: [{ moduleName: "tenant", masterDetails: [{ name: "tenants" }] }],
        },
      }),
      signal: AbortSignal.timeout(config.digitTimeoutMs),
    });
  } catch {
    throw new DigitUnavailableError("DIGIT tenant lookup failed");
  }
  if (!response.ok) throw new DigitUnavailableError(`DIGIT tenant lookup returned ${response.status}`);
  const body = await response.json() as {
    MdmsRes?: { tenant?: { tenants?: Array<{ code?: string; name?: string; isActive?: boolean; active?: boolean; isactive?: boolean }> } };
  };
  // MDMS row envelopes use isActive; older V1 data can expose active/isactive.
  // Existing tenant seeds omit an activity property, which means active.
  const list = (body.MdmsRes?.tenant?.tenants || []).filter(tenant =>
    tenant.isActive !== false && tenant.active !== false && tenant.isactive !== false);
  const value = new Set(list.flatMap((tenant) => tenant.code ? [tenant.code] : []));
  const names = new Map(list.flatMap((tenant) =>
    tenant.code && typeof tenant.name === "string" && tenant.name.trim() ? [[tenant.code, tenant.name.trim()] as const] : []));
  const entry = { value, names, expiresAt: Date.now() + TENANT_TTL_MS };
  tenants.set(root, entry);
  return entry;
}

function allowlisted(roles: unknown): string[] {
  if (!Array.isArray(roles)) return [];
  return [...new Set(roles.filter((role): role is string =>
    typeof role === "string" && config.digitManagedRoleAllowlist.includes(role)))].sort();
}

/**
 * Signed Organization memberships whose Organization is enabled, mapped to a
 * DIGIT tenant, and whose tenant exists in DIGIT.
 */
export async function membershipsFromClaims(claims: KeycloakClaims): Promise<OrganizationMembership[]> {
  const result: OrganizationMembership[] = [];
  const seenTenants = new Set<string>();
  for (const [alias, organization] of Object.entries(claims.organization || {})) {
    if (!organization?.id) continue;
    const mapping = await cachedMapping(organization.id);
    if (!mapping || mapping.alias !== alias || !await isActiveDigitTenant(mapping.tenantId)) continue;
    if (seenTenants.has(mapping.tenantId)) {
      throw new DigitUnavailableError("More than one Organization maps to a DIGIT tenant");
    }
    seenTenants.add(mapping.tenantId);
    const access = organization.resource_access?.[config.digitRoleClientId];
    result.push({ ...mapping, roles: allowlisted(access?.roles) });
  }
  return result.sort((left, right) => left.name.localeCompare(right.name));
}

/** Live memberships for flows, such as onboarding, that mutate Organizations mid-session. */
export async function liveMembershipsForSubject(subject: string): Promise<OrganizationMembership[]> {
  const memberships = await Promise.all((await listTenantMappings()).map(async (mapping) => {
    if (!await isActiveDigitTenant(mapping.tenantId)) return null;
    const member = mapping.mappingType === "organization-group"
      ? await isOrganizationGroupMember(mapping.organizationId, mapping.groupId, subject)
      : await isOrganizationMember(mapping.organizationId, subject);
    return member ? { ...mapping, roles: [] as string[] } : null;
  }));
  return memberships
    .filter((membership): membership is OrganizationMembership => membership !== null)
    .sort((left, right) => left.name.localeCompare(right.name));
}

/** Membership ∩ DIGIT: the tenant's managed account is active and holds roles there. */
export function tenantOption(
  membership: OrganizationMembership,
  account: DigitAccount | null,
): TenantOption | null {
  if (!account) return null;
  const roles = [...new Set(account.roles
    .filter((role) => role.tenantId === membership.tenantId)
    .map((role) => role.code))].sort();
  return roles.length || !account.active ? {
    organizationId: membership.organizationId,
    organizationAlias: membership.alias,
    tenantId: membership.tenantId,
    name: membership.name,
    roles,
    ...(!account.active && { code: "DIGIT_ACCOUNT_INACTIVE" as const }),
  } : null;
}

export function clearTenantCaches(): void {
  clearTenantMappingCache();
  mappings.clear();
  tenants.clear();
}
