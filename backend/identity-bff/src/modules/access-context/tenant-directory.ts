import { config } from "../../infrastructure/config.js";
import {
  clearTenantMappingCache,
  isOrganizationGroupMember,
  isOrganizationMember,
  listTenantMappings,
  type TenantMapping,
} from "../organizations/organization-service.js";
import { DigitUnavailableError, type DigitAccount } from "../managed-accounts/digit-user-client.js";

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

const TENANT_TTL_MS = 300_000;
/** A tenant missing from a cached root list refetches that list at most this often. */
const MISS_REFETCH_MS = 5_000;
type RootTenants = { value: Set<string>; names: Map<string, string>; fetchedAt: number };
const tenants = new Map<string, RootTenants>();
const inFlight = new Map<string, Promise<RootTenants>>();

/** Tenant codes present in DIGIT MDMS `tenant.tenants` for the tenant's root. */
export async function isActiveDigitTenant(tenantId: string, options: { fresh?: boolean } = {}): Promise<boolean> {
  return (await rootTenants(tenantId, options.fresh)).value.has(tenantId);
}

/** The MDMS display name of an active DIGIT tenant, or null. */
export async function digitTenantName(tenantId: string): Promise<string | null> {
  return (await rootTenants(tenantId)).names.get(tenantId) ?? null;
}

/**
 * Each root's list is cached for TENANT_TTL_MS while it contains the tenant.
 * A tenant missing from it may have been provisioned since the root was cached,
 * so it refetches, at most once per MISS_REFETCH_MS per root (#2303). `fresh`
 * also refetches a cached hit; a miss stays rate-limited.
 */
async function rootTenants(tenantId: string, fresh = false): Promise<RootTenants> {
  const root = tenantId.split(".")[0];
  const hit = tenants.get(root);
  const age = hit ? Date.now() - hit.fetchedAt : Infinity;
  if (hit && (hit.value.has(tenantId) ? !fresh && age < TENANT_TTL_MS : age < MISS_REFETCH_MS)) return hit;
  let pending = inFlight.get(root);
  if (!pending) {
    pending = fetchRootTenants(root).finally(() => { if (inFlight.get(root) === pending) inFlight.delete(root); });
    inFlight.set(root, pending);
  }
  return pending;
}

async function fetchRootTenants(root: string): Promise<RootTenants> {
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
  const entry = { value, names, fetchedAt: Date.now() };
  tenants.set(root, entry);
  return entry;
}

/**
 * Live memberships for flows, such as onboarding, that mutate Organizations mid-session.
 * `live` also rereads DIGIT tenant activity for the subject's own memberships.
 */
export async function liveMembershipsForSubject(subject: string, live = false): Promise<OrganizationMembership[]> {
  const memberships = await Promise.all((await listTenantMappings()).map(async (mapping) => {
    const member = mapping.mappingType === "organization-group"
      ? await isOrganizationGroupMember(mapping.organizationId, mapping.groupId, subject)
      : await isOrganizationMember(mapping.organizationId, subject);
    // Membership first, so a live read touches MDMS only for the subject's tenants.
    if (!member || !await isActiveDigitTenant(mapping.tenantId, { fresh: live })) return null;
    return { ...mapping, roles: [] as string[] };
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
  tenants.clear();
  inFlight.clear();
}
