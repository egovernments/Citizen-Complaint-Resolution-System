import { randomUUID } from "node:crypto";
import { currentPersonLease, LeaseBusyError, withPersonLease } from "../accounts/person-lease.js";
import { config } from "../../infrastructure/config.js";
import { getAdminToken } from "../../integrations/keycloak/admin-session.js";
import type { UserRepresentation } from "../sync/keycloak-writer.js";
import { createdId, findUser, paged, readUser } from "../../integrations/keycloak/admin-api.js";

interface OrganizationRepresentation {
  id?: string;
  name?: string;
  alias?: string;
  enabled?: boolean;
  attributes?: Record<string, string[]>;
}

interface GroupRepresentation {
  id: string;
  name: string;
  attributes?: Record<string, string[]>;
  subGroups?: GroupRepresentation[];
}

interface RoleRepresentation {
  id: string;
  name: string;
}

interface CredentialRepresentation {
  id?: string;
  type?: string;
}

interface FederatedIdentityRepresentation {
  identityProvider?: string;
  userId?: string;
}

const MANAGED_TENANTS_ATTRIBUTE = "digit.managedTenants";
const BFF_SIGNUP_USER_ATTRIBUTE = "digit.identityBffSignup";

export async function managedTenantsFromIdentity(userId: string): Promise<string[]> {
  return [...new Set((await readUser(userId)).attributes?.[MANAGED_TENANTS_ATTRIBUTE] || [])].sort();
}

/**
 * Keycloak's user PUT replaces the whole attribute map, so every
 * read-modify-write of a user runs under that person's lease (§2.5), the same
 * one `updateKeycloakUser` requires for `digit.bindings`, `digit.accounts`
 * and the phone. A caller already holding it reuses it. Busy keeps this
 * module's IdentityAdminError 503, which callers already map.
 */
async function withUserAttributeWrite<T>(userId: string, operation: () => Promise<T>): Promise<T> {
  if (currentPersonLease()?.subject === userId) return operation();
  try {
    return await withPersonLease(userId, () => operation());
  } catch (error) {
    if (error instanceof LeaseBusyError) throw new IdentityAdminError("The Keycloak user is busy; retry", 503);
    throw error;
  }
}

/** Durable inventory used to deactivate accounts after Organization removal. */
export async function recordManagedTenant(userId: string, tenantId: string): Promise<void> {
  await withUserAttributeWrite(userId, () => updateUserAttributeValues(userId, MANAGED_TENANTS_ATTRIBUTE, (values) => {
    const tenants = [...new Set([...values, tenantId])].sort();
    return tenants.length === values.length ? null : tenants;
  }));
}

const CITIZEN_REGISTRATIONS_ATTRIBUTE = "digit.citizenRegistrations";

/** Raw `digit.citizenRegistrations` values of one Keycloak user. */
export async function citizenRegistrationValues(userId: string): Promise<string[]> {
  return [...((await readUser(userId)).attributes?.[CITIZEN_REGISTRATIONS_ATTRIBUTE] || [])];
}

/**
 * Read-modify-write of `digit.citizenRegistrations`, the durable citizen
 * registration record, alongside `digit.managedTenants` on the same user.
 * `update` returns the new values, or null to leave the user untouched.
 */
export function updateCitizenRegistrationValues(
  userId: string,
  update: (values: string[]) => string[] | null,
): Promise<string[]> {
  return withUserAttributeWrite(userId, () => updateUserAttributeValues(userId, CITIZEN_REGISTRATIONS_ATTRIBUTE, update));
}

const ACCOUNT_LINKS_ATTRIBUTE = "digit.accountLinks";
const ACCOUNT_LINK_BLOCKS_ATTRIBUTE = "digit.accountLinkBlocks";

/**
 * Existing DIGIT accounts linked to a Keycloak user (#2167), one value per
 * link: `<EMPLOYEE|CITIZEN>|<tenantId>|<digitUuid>`. Admin-edit only, like
 * `digit.citizenRegistrations`. Blocks record links an admin undid and that
 * must not re-form automatically.
 */
export async function accountLinkValues(userId: string): Promise<{ links: string[]; blocks: string[] }> {
  const user = await readUser(userId);
  return {
    links: [...(user.attributes?.[ACCOUNT_LINKS_ATTRIBUTE] || [])],
    blocks: [...(user.attributes?.[ACCOUNT_LINK_BLOCKS_ATTRIBUTE] || [])],
  };
}

export function updateAccountLinkValues(
  userId: string,
  update: (values: string[]) => string[] | null,
): Promise<string[]> {
  return withUserAttributeWrite(userId, () => updateUserAttributeValues(userId, ACCOUNT_LINKS_ATTRIBUTE, update));
}

export function updateAccountLinkBlockValues(
  userId: string,
  update: (values: string[]) => string[] | null,
): Promise<string[]> {
  return withUserAttributeWrite(userId, () => updateUserAttributeValues(userId, ACCOUNT_LINK_BLOCKS_ATTRIBUTE, update));
}

/** Keycloak users holding exactly this link value (for one-owner checks). */
export async function usersWithAccountLink(value: string): Promise<string[]> {
  const query = new URLSearchParams({ q: `${ACCOUNT_LINKS_ATTRIBUTE}:${value}`, briefRepresentation: "false", max: "5" });
  const response = await request(`/users?${query}`);
  return (await response.json() as UserRepresentation[])
    .filter((user) => user.id && user.attributes?.[ACCOUNT_LINKS_ATTRIBUTE]?.includes(value))
    .map((user) => user.id!);
}

/** An enabled Keycloak user, by id or by exact email. */
export async function findEnabledIdentityUser(input: { id?: string; email?: string }): Promise<string | null> {
  let user: UserRepresentation | null = null;
  if (input.id) {
    user = await findUser(input.id);
  } else if (input.email) {
    user = await findIdentityUserByEmail(input.email.trim().toLowerCase());
  }
  return user?.id && user.enabled !== false ? user.id : null;
}

interface UserProfileAttribute {
  name: string;
  permissions?: { view?: string[]; edit?: string[] };
}

let phoneTrustCache: { value: boolean; expiresAt: number } | null = null;

/**
 * Whether a Keycloak-held phone can be trusted as proof: users must not be
 * able to edit `phoneNumber` or `phoneNumberVerified` themselves. Declared
 * profile attributes must not grant `user` edit; undeclared ones are only
 * safe when the realm's unmanagedAttributePolicy keeps users from editing.
 */
export async function keycloakPhoneIsAdminControlled(): Promise<boolean> {
  if (phoneTrustCache && phoneTrustCache.expiresAt > Date.now()) return phoneTrustCache.value;
  const response = await request("/users/profile");
  const profile = await response.json() as {
    attributes?: UserProfileAttribute[];
    unmanagedAttributePolicy?: string;
  };
  const value = [PHONE_ATTRIBUTE, PHONE_VERIFIED_ATTRIBUTE].every((name) => {
    const declared = profile.attributes?.find((attribute) => attribute.name === name);
    if (declared) return !(declared.permissions?.edit || []).includes("user");
    return profile.unmanagedAttributePolicy !== "ENABLED";
  });
  phoneTrustCache = { value, expiresAt: Date.now() + 60_000 };
  return value;
}

export function resetPhoneTrustCache(): void {
  phoneTrustCache = null;
}

async function updateUserAttributeValues(
  userId: string,
  attributeName: string,
  update: (values: string[]) => string[] | null,
): Promise<string[]> {
  const user = await readUser(userId);
  const current = [...(user.attributes?.[attributeName] || [])];
  const next = update(current);
  if (!next) return current;
  await currentPersonLease()?.assertHeld();
  // Send only the user-profile fields, never the stale `enabled` and friends:
  // an admin disabling the user between the GET and this PUT must stick.
  // Keycloak 26 leaves absent top-level fields alone, but a PUT that carries
  // `attributes` treats email/firstName/lastName as profile attributes and
  // clears them when absent, and replaces the whole attribute map.
  await request(`/users/${encodeURIComponent(userId)}`, {
    method: "PUT",
    body: JSON.stringify({
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      attributes: { ...user.attributes, [attributeName]: next },
    }),
  });
  return next;
}

export interface IdentityUserProfile {
  name: string;
  emailId?: string;
}

export interface OrganizationReconciliationState {
  organizationId: string;
  enabled: boolean;
  memberRoles: Map<string, string[]>;
}

export class IdentityAdminError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
  }
}

export interface IdentityProviderSummary {
  alias: string;
  displayName: string;
}

export async function enabledIdentityProviders(): Promise<Map<string, IdentityProviderSummary>> {
  const response = await request(
    "/identity-provider/instances?briefRepresentation=true&max=100",
  );
  const providers = await response.json() as Array<{
    alias?: string;
    displayName?: string;
    enabled?: boolean;
  }>;
  return new Map(providers.flatMap((provider) => {
    if (provider.enabled === false || !provider.alias) return [];
    return [[provider.alias, {
      alias: provider.alias,
      displayName: provider.displayName?.trim() || provider.alias,
    }]];
  }));
}

export interface IdentityClientSummary {
  id: string;
  clientId: string;
  enabled: boolean;
  standardFlowEnabled: boolean;
  attributes: Record<string, string>;
}

/** Live client capability and DIGIT journey policy from Keycloak. */
export async function identityClient(clientId: string): Promise<IdentityClientSummary | null> {
  const query = new URLSearchParams({ clientId, search: "true" });
  const response = await request(`/clients?${query}`);
  const clients = await response.json() as Array<{
    id?: string;
    clientId?: string;
  }>;
  const match = clients.find((candidate) => candidate.clientId === clientId);
  if (!match?.id) return null;
  // The collection response may be brief on some Keycloak versions. Read the
  // exact client so policy attributes never disappear because of list shaping.
  const detailResponse = await request(`/clients/${encodeURIComponent(match.id)}`);
  const client = await detailResponse.json() as {
    id?: string;
    clientId?: string;
    enabled?: boolean;
    standardFlowEnabled?: boolean;
    attributes?: Record<string, string>;
  };
  if (!client?.id || !client.clientId) return null;
  return {
    id: client.id,
    clientId: client.clientId,
    enabled: client.enabled !== false,
    standardFlowEnabled: client.standardFlowEnabled !== false,
    attributes: client.attributes || {},
  };
}

function realmPath(path: string): string {
  return `/admin/realms/${encodeURIComponent(config.keycloakOrganizationRealm)}${path}`;
}

export async function request(
  path: string,
  init: RequestInit = {},
  accepted = [200, 204],
): Promise<Response> {
  let token: string;
  try {
    token = await getAdminToken();
  } catch (error) {
    throw new IdentityAdminError(
      `Keycloak Admin authentication failed: ${(error as Error).message}`,
    );
  }
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  let response: Response;
  try {
    response = await fetch(`${config.keycloakAdminUrl}${realmPath(path)}`, {
      ...init,
      headers,
    });
  } catch (error) {
    throw new IdentityAdminError(
      `Keycloak Admin request failed: ${(error as Error).message}`,
    );
  }
  if (!accepted.includes(response.status)) {
    const detail = await response.text().catch(() => "");
    const tooLong = response.status === 400 && /error-invalid-length/.test(detail)
      ? /"field":"(digit\.[^"]+)"/.exec(detail)?.[1] : undefined;
    if (tooLong) {
      // One of the BFF's own records outgrew the realm's limit for it (2048
      // characters while it is undeclared). Not the caller's fault: identity
      // is unavailable until the realm allows it, and that is logged (§5.1).
      console.error(`Keycloak refused ${init.method ?? "GET"} ${path.split("?")[0]}: ${tooLong} is longer than ` +
        `the realm allows (${detail}). keycloak/realm.json must declare it with a larger limit; ` +
        "configure-keycloak.sh applies that.");
      throw new IdentityAdminError(`Keycloak refused ${tooLong} as too long`, 503);
    }
    throw new IdentityAdminError(
      `Keycloak Admin API returned ${response.status}${detail ? `: ${detail}` : ""}`,
      response.status === 400 || response.status === 404 || response.status === 409
        ? response.status
        : 502,
    );
  }
  return response;
}

function mappedTenant(organization: OrganizationRepresentation): string | null {
  const values = organization.attributes?.["digit.rootTenantId"];
  return Array.isArray(values) && values.length === 1 ? values[0] : null;
}

function attribute(organization: OrganizationRepresentation, name: string): string | null {
  const values = organization.attributes?.[name];
  return Array.isArray(values) && values.length === 1 ? values[0] : null;
}

async function organizationsForTenant(
  tenantId: string,
): Promise<OrganizationRepresentation[]> {
  const query = new URLSearchParams({
    q: `digit.rootTenantId:${tenantId}`,
    briefRepresentation: "false",
    max: "20",
  });
  const response = await request(`/organizations?${query}`);
  const organizations = await response.json() as OrganizationRepresentation[];
  return organizations.filter((organization) => mappedTenant(organization) === tenantId);
}

export interface OrganizationMapping {
  organizationId: string;
  alias: string;
  urlSlug: string;
  name: string;
  tenantId: string;
  rootTenantId: string;
  parentTenantId: null;
  fallbackTenantIds: string[];
  mappingType: "organization";
}

function asMapping(organization: OrganizationRepresentation): OrganizationMapping | null {
  const tenantId = mappedTenant(organization);
  const lifecycle = attribute(organization, "digit.lifecycle");
  if (!organization.id || !organization.alias || organization.enabled === false || !tenantId ||
      (lifecycle !== null && lifecycle !== "ACTIVE")) {
    return null;
  }
  return {
    organizationId: organization.id,
    alias: organization.alias,
    // New Organizations persist the independently reserved public URL slug.
    // Alias is the migration fallback for Organizations created before that
    // attribute existed; neither value is treated as a DIGIT tenant id.
    urlSlug: attribute(organization, "digit.urlSlug") || organization.alias,
    name: organization.name || organization.alias,
    tenantId,
    rootTenantId: tenantId,
    parentTenantId: null,
    fallbackTenantIds: organization.attributes?.["digit.fallbackTenantIds"] || [],
    mappingType: "organization",
  };
}

/** The enabled Organization's DIGIT tenant mapping, or null when absent/disabled/unmapped. */
export async function readOrganizationMapping(
  organizationId: string,
): Promise<OrganizationMapping | null> {
  try {
    const response = await request(`/organizations/${encodeURIComponent(organizationId)}`);
    return asMapping(await response.json() as OrganizationRepresentation);
  } catch (error) {
    if (error instanceof IdentityAdminError && error.status === 404) return null;
    throw error;
  }
}

export async function listOrganizationMappings(): Promise<OrganizationMapping[]> {
  const organizations = await paged<OrganizationRepresentation>(
    "/organizations?briefRepresentation=false",
  );
  return organizations.flatMap((organization) => {
    const mapping = asMapping(organization);
    return mapping ? [mapping] : [];
  });
}

export interface OrganizationGroupMapping {
  organizationId: string;
  alias: string;
  groupId: string;
  urlSlug: string;
  name: string;
  tenantId: string;
  rootTenantId: string;
  parentTenantId: string;
  fallbackTenantIds: string[];
  mappingType: "organization-group";
}

export type TenantMapping = OrganizationMapping | OrganizationGroupMapping;

/**
 * The tenant directory: every usable mapping, plus the tenant ids and slugs
 * that more than one mapping claimed (those mappings are left out).
 */
export interface TenantDirectory {
  mappings: TenantMapping[];
  collidedTenantIds: Set<string>;
  collidedUrlSlugs: Set<string>;
}

const TENANT_MAPPING_TTL_MS = 60_000;
let tenantMappingCache: { value: TenantDirectory; expiresAt: number } | null = null;
let tenantMappingLoad: Promise<TenantDirectory> | null = null;
let tenantMappingGeneration = 0;

export function clearTenantMappingCache(): void {
  tenantMappingGeneration += 1;
  tenantMappingCache = null;
  tenantMappingLoad = null;
}

function groupAttribute(group: GroupRepresentation, name: string): string | null {
  const values = group.attributes?.[name];
  return Array.isArray(values) && values.length === 1 && values[0]?.trim()
    ? values[0].trim()
    : null;
}

function asGroupMapping(
  group: GroupRepresentation,
  organization: OrganizationMapping,
): OrganizationGroupMapping | null {
  const organizationId = groupAttribute(group, "digit.organizationId");
  const tenantId = groupAttribute(group, "digit.tenantId");
  const rootTenantId = groupAttribute(group, "digit.rootTenantId");
  const parentTenantId = groupAttribute(group, "digit.parentTenantId");
  const urlSlug = groupAttribute(group, "digit.urlSlug");
  if (!organizationId || organizationId !== organization.organizationId ||
      !tenantId || !rootTenantId || rootTenantId !== organization.tenantId ||
      !parentTenantId || parentTenantId === tenantId || !urlSlug) {
    return null;
  }
  return {
    organizationId,
    alias: organization.alias,
    groupId: group.id,
    urlSlug,
    name: groupAttribute(group, "digit.displayName") || group.name,
    tenantId,
    rootTenantId,
    parentTenantId,
    fallbackTenantIds: group.attributes?.["digit.fallbackTenantIds"] || [],
    mappingType: "organization-group",
  };
}

async function readOrganizationGroup(
  organizationId: string,
  groupId: string,
): Promise<GroupRepresentation | null> {
  try {
    const response = await request(
      `/organizations/${encodeURIComponent(organizationId)}` +
      `/groups/${encodeURIComponent(groupId)}?briefRepresentation=false`,
    );
    return await response.json() as GroupRepresentation;
  } catch (error) {
    if (error instanceof IdentityAdminError && error.status === 404) return null;
    throw error;
  }
}

async function organizationGroupsForAttribute(
  organizationId: string,
  name: "digit.urlSlug" | "digit.tenantId",
  value: string,
): Promise<GroupRepresentation[]> {
  const query = new URLSearchParams({
    q: `${name}:${value}`,
    exact: "true",
    briefRepresentation: "false",
    max: "20",
  });
  const response = await request(
    `/organizations/${encodeURIComponent(organizationId)}/groups?${query}`,
  );
  return await response.json() as GroupRepresentation[];
}

interface OrganizationGroupCandidate {
  organization: OrganizationMapping;
  group: GroupRepresentation;
}

async function organizationGroupCandidatesForAttribute(
  organizations: OrganizationRepresentation[],
  name: "digit.urlSlug" | "digit.tenantId",
  value: string,
): Promise<OrganizationGroupCandidate[]> {
  const candidates = await Promise.all(organizations.flatMap((representation) => {
    const organization = asMapping(representation);
    return organization ? [organizationGroupsForAttribute(
      organization.organizationId, name, value,
    ).then((groups) => groups
      // Never trust the server-side `q` filter alone: re-check the value.
      .filter((group) => groupAttribute(group, name)?.toLowerCase() === value.toLowerCase())
      .map((group) => ({ organization, group })))] : [];
  }));
  return candidates.flat();
}

export async function readTenantMappingForUrlSlug(urlSlug: string): Promise<TenantMapping | null> {
  const normalized = urlSlug.trim().toLowerCase();
  const directory = await cachedTenantMappings();
  return directory.mappings.find((mapping) => mapping.urlSlug.toLowerCase() === normalized) ||
    await uncachedOrganizationMapping(directory, "digit.urlSlug", normalized);
}

export async function readTenantMappingForTenant(tenantId: string): Promise<TenantMapping | null> {
  const directory = await cachedTenantMappings();
  return directory.mappings.find((mapping) => mapping.tenantId === tenantId) ||
    await uncachedOrganizationMapping(directory, "digit.rootTenantId", tenantId);
}

/**
 * A directory miss may be an Organization created on another replica since
 * this replica's directory was cached, so it is looked up live by attribute
 * (one Admin call). Signup creates Organizations, never tenant groups, so only
 * Organizations are looked up. A slug or tenant id that collided in the
 * directory stays unavailable, and a live hit that clashes with a cached
 * mapping is refused.
 */
async function uncachedOrganizationMapping(
  directory: TenantDirectory,
  name: "digit.urlSlug" | "digit.rootTenantId",
  value: string,
): Promise<OrganizationMapping | null> {
  if (name === "digit.urlSlug" ? directory.collidedUrlSlugs.has(value.toLowerCase())
    : directory.collidedTenantIds.has(value.toLowerCase())) {
    return null;
  }
  const query = new URLSearchParams({ q: `${name}:${value}`, briefRepresentation: "false", max: "2" });
  const response = await request(`/organizations?${query}`);
  const found = (await response.json() as OrganizationRepresentation[])
    .flatMap((organization) => {
      const mapping = asMapping(organization);
      return mapping ? [mapping] : [];
    })
    .filter((mapping) => name === "digit.urlSlug"
      ? mapping.urlSlug.toLowerCase() === value.toLowerCase()
      : mapping.tenantId === value);
  if (found.length !== 1) return null;
  const [mapping] = found;
  const clashes = directory.mappings.some((cached) =>
    cached.tenantId.toLowerCase() === mapping.tenantId.toLowerCase() ||
    cached.urlSlug.toLowerCase() === mapping.urlSlug.toLowerCase());
  if (clashes) return null;
  // Pick the new Organization up in the directory at the next read.
  clearTenantMappingCache();
  return mapping;
}

function flattenGroups(groups: GroupRepresentation[]): GroupRepresentation[] {
  return groups.flatMap((group) => [group, ...flattenGroups(group.subGroups || [])]);
}

export async function listTenantMappings(): Promise<TenantMapping[]> {
  return (await listTenantDirectory()).mappings;
}

export async function listTenantDirectory(): Promise<TenantDirectory> {
  const organizations = await listOrganizationMappings();
  const groupMappings = (await Promise.all(organizations.map(async (organization) => {
    const query = new URLSearchParams({
      briefRepresentation: "false",
      populateHierarchy: "true",
    });
    const groups = await paged<GroupRepresentation>(
      `/organizations/${encodeURIComponent(organization.organizationId)}/groups?${query}`,
    );
    return flattenGroups(groups).flatMap((group) => {
      const mapping = asGroupMapping(group, organization);
      return mapping ? [mapping] : [];
    });
  }))).flat();
  return withoutCollisions([...organizations, ...groupMappings]);
}

/**
 * A tenant id or URL slug claimed by more than one mapping is ambiguous, so
 * every mapping involved is dropped (its routes answer "not available") and
 * logged. The rest of the directory keeps working: one bad record must never
 * take sign-in down for every tenant. The dropped tenant ids and slugs are
 * reported so reconciliation can leave those tenants alone rather than read
 * them as "no members".
 */
function withoutCollisions(mappings: TenantMapping[]): TenantDirectory {
  const count = (key: (mapping: TenantMapping) => string) => {
    const counts = new Map<string, number>();
    for (const mapping of mappings) counts.set(key(mapping), (counts.get(key(mapping)) || 0) + 1);
    return counts;
  };
  const tenantCounts = count((mapping) => mapping.tenantId.toLowerCase());
  const slugCounts = count((mapping) => mapping.urlSlug.toLowerCase());
  const kept: TenantMapping[] = [];
  const collidedTenantIds = new Set<string>();
  const collidedUrlSlugs = new Set<string>();
  for (const mapping of mappings) {
    if (tenantCounts.get(mapping.tenantId.toLowerCase())! > 1 || slugCounts.get(mapping.urlSlug.toLowerCase())! > 1) {
      collidedTenantIds.add(mapping.tenantId.toLowerCase());
      collidedUrlSlugs.add(mapping.urlSlug.toLowerCase());
      console.warn("Tenant directory: dropping a colliding mapping", JSON.stringify({
        organizationId: mapping.organizationId,
        ...(mapping.mappingType === "organization-group" && { groupId: mapping.groupId }),
        tenantId: mapping.tenantId,
        urlSlug: mapping.urlSlug,
      }));
      continue;
    }
    kept.push(mapping);
  }
  return { mappings: kept, collidedTenantIds, collidedUrlSlugs };
}

/**
 * Re-reads a directory mapping from Keycloak before it authorizes anything:
 * the directory is cached per process for up to a minute, but disabling or
 * unmapping an Organization (or group) must take effect at the next sign-in.
 */
export async function liveTenantMapping(mapping: TenantMapping): Promise<TenantMapping | null> {
  // The Organization and its group are independent reads; fetch them together.
  const [organization, group] = await Promise.all([
    readOrganizationMapping(mapping.organizationId),
    mapping.mappingType === "organization-group"
      ? readOrganizationGroup(mapping.organizationId, mapping.groupId)
      : Promise.resolve(null),
  ]);
  if (!organization) return null;
  if (mapping.mappingType === "organization") {
    return organization.tenantId === mapping.tenantId && organization.urlSlug === mapping.urlSlug
      ? organization : null;
  }
  const live = group ? asGroupMapping(group, organization) : null;
  return live && live.tenantId === mapping.tenantId && live.urlSlug === mapping.urlSlug ? live : null;
}

async function cachedTenantMappings(): Promise<TenantDirectory> {
  if (tenantMappingCache && tenantMappingCache.expiresAt > Date.now()) {
    return tenantMappingCache.value;
  }
  if (tenantMappingLoad) return tenantMappingLoad;

  const generation = tenantMappingGeneration;
  const load = listTenantDirectory().then((value) => {
    // A control-plane write may invalidate the directory while this scan is
    // still in flight. Never let that older result repopulate the cache.
    if (generation === tenantMappingGeneration) {
      tenantMappingCache = { value, expiresAt: Date.now() + TENANT_MAPPING_TTL_MS };
    }
    return value;
  });
  tenantMappingLoad = load;
  try {
    return await load;
  } finally {
    if (tenantMappingLoad === load) tenantMappingLoad = null;
  }
}

/**
 * `adoptExisting` decides what happens when an Organization is already mapped
 * to the tenant. The control plane's idempotent `_ensure` passes true. Signup
 * provisioning passes true only when it already created this Organization on
 * an earlier attempt; otherwise an existing Organization is a collision, and
 * adopting it would grant the signer tenant-admin roles over somebody else's
 * Organization. (Dhruv review, #2088.)
 */
export async function ensureOrganization(input: {
  tenantId: string;
  alias: string;
  name: string;
  accountCode?: string;
  urlSlug?: string;
  adoptExisting: boolean;
}): Promise<{ id: string; tenantId: string; alias: string; name: string }> {
  const organizations = await paged<OrganizationRepresentation>(
    "/organizations?briefRepresentation=false",
  );
  const [tenantGroups, slugGroups] = await Promise.all([
    organizationGroupCandidatesForAttribute(organizations, "digit.tenantId", input.tenantId),
    organizationGroupCandidatesForAttribute(
      organizations, "digit.urlSlug", input.urlSlug || input.alias,
    ),
  ]);
  if (tenantGroups.length || slugGroups.length) {
    throw new IdentityAdminError(
      "The root tenant id or URL slug is already reserved by an Organization group",
      409,
    );
  }
  let matches = await organizationsForTenant(input.tenantId);
  if (matches.length > 1) {
    throw new IdentityAdminError("Multiple Organizations map to this tenant", 409);
  }
  if (matches[0] && !input.adoptExisting) {
    throw new IdentityAdminError("An Organization already maps to this tenant", 409);
  }

  let organization = matches[0];
  const adopted = Boolean(organization);
  if (!organization) {
    const response = await request("/organizations", {
      method: "POST",
      body: JSON.stringify({
        name: input.name,
        alias: input.alias,
        enabled: true,
        attributes: {
          "digit.rootTenantId": [input.tenantId],
          ...(input.accountCode && { "digit.accountCode": [input.accountCode] }),
          ...(input.urlSlug && { "digit.urlSlug": [input.urlSlug] }),
        },
      }),
    }, [201]);
    const id = createdId(response);
    if (id) {
      organization = { id, name: input.name, alias: input.alias };
    } else {
      matches = await organizationsForTenant(input.tenantId);
      organization = matches[0];
    }
  }

  if (!organization?.id) {
    throw new IdentityAdminError("Keycloak did not identify the Organization it created");
  }
  if (organization.alias && organization.alias !== input.alias) {
    throw new IdentityAdminError(
      "The tenant is already mapped to another Organization alias",
      409,
    );
  }
  // A disabled Organization was taken out of service deliberately. Silently
  // re-enabling it here would let an ensure call resurrect a revoked tenant's
  // identity; an operator re-enables it in Keycloak. (Dhruv review, #2088.)
  if (adopted && organization.enabled === false) {
    throw new IdentityAdminError("The Organization mapped to this tenant is disabled", 409);
  }

  if (organization.name !== input.name ||
      (input.accountCode && attribute(organization, "digit.accountCode") !== input.accountCode) ||
      (input.urlSlug && attribute(organization, "digit.urlSlug") !== input.urlSlug)) {
    await request(`/organizations/${encodeURIComponent(organization.id)}`, {
      method: "PUT",
      body: JSON.stringify({
        ...organization,
        name: input.name,
        alias: input.alias,
        // Never a re-enable: the guard above rejects a disabled Organization,
        // and a just-created one carries no `enabled` field yet.
        enabled: organization.enabled !== false,
        attributes: {
          ...organization.attributes,
          "digit.rootTenantId": [input.tenantId],
          ...(input.accountCode && { "digit.accountCode": [input.accountCode] }),
          ...(input.urlSlug && { "digit.urlSlug": [input.urlSlug] }),
        },
      }),
    });
  }
  clearTenantMappingCache();
  return {
    id: organization.id,
    tenantId: input.tenantId,
    alias: input.alias,
    name: input.name,
  };
}

/**
 * Profile facts used when DIGIT must create an employee for a new tenant admin.
 * Only a verified email is passed on; the subject itself is the link key.
 */
export async function readIdentityUserProfile(userId: string): Promise<IdentityUserProfile> {
  const user = await readUser(userId);
  if (user.id !== userId || user.enabled === false) {
    throw new IdentityAdminError("Keycloak user is not active", 404);
  }
  const name = [user.firstName, user.lastName]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ") || user.username?.trim() || "";
  if (!name) throw new IdentityAdminError("Keycloak user has no name", 400);
  return {
    name,
    ...(user.emailVerified === true && user.email ? { emailId: user.email } : {}),
  };
}

/**
 * Applies the name collected by the client application only after the magic-link
 * redemption has proved ownership of the same email address. This is profile
 * completion on Keycloak's structural user record, not tenant authorization.
 */
export async function applyVerifiedSignupIdentityProfile(input: {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
}): Promise<boolean> {
  return withUserAttributeWrite(input.userId, () => writeVerifiedSignupIdentityProfile(input));
}

async function writeVerifiedSignupIdentityProfile(input: {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
}): Promise<boolean> {
  const user = await readUser(input.userId);
  if (user.id !== input.userId || user.enabled === false ||
      user.email?.trim().toLowerCase() !== input.email || user.emailVerified !== true) {
    throw new IdentityAdminError("The verified magic-link identity does not match the signup");
  }
  const managedDraft = user.attributes?.[BFF_SIGNUP_USER_ATTRIBUTE]?.includes("true") === true;
  // A signup may authenticate an established account, but profile editing is
  // a separate, authenticated flow. Only finish the provisional record that
  // this BFF created for the same signup journey.
  if (!managedDraft) return false;
  const attributes = { ...user.attributes };
  delete attributes[BFF_SIGNUP_USER_ATTRIBUTE];
  await request(`/users/${encodeURIComponent(input.userId)}`, {
    method: "PUT",
    body: JSON.stringify({
      email: user.email,
      firstName: input.firstName,
      lastName: input.lastName,
      attributes,
    }),
  });
  return true;
}

/**
 * Creates the structural Keycloak record before email verification so its
 * profile is complete when the action token is redeemed. It grants no tenant
 * membership or role and deliberately leaves `emailVerified` false.
 */
export async function ensureMagicLinkSignupIdentity(input: {
  email: string;
  firstName: string;
  lastName: string;
}): Promise<{ id: string; created: boolean }> {
  const existing = await findIdentityUserByEmail(input.email);
  if (existing) {
    if (!existing.id || existing.enabled === false) {
      throw new IdentityAdminError("The Keycloak user is not available for signup", 409);
    }
    const managedDraft = existing.emailVerified !== true &&
      existing.attributes?.[BFF_SIGNUP_USER_ATTRIBUTE]?.includes("true") === true;
    // A verified existing email may be proved again through the mailbox and
    // continue into the explicit account-linking journey. An unverified
    // provider-only record is not equivalent proof: its provider must first
    // authenticate it. Only provisional records created by this BFF are the
    // exception because the magic link is their original verification step.
    if (existing.emailVerified !== true && !managedDraft) {
      throw new IdentityAdminError("The existing identity must be verified through its provider", 409);
    }
    if (managedDraft &&
        (existing.firstName !== input.firstName || existing.lastName !== input.lastName)) {
      const userId = existing.id;
      // Under the person lease, with a fresh read, sending only the
      // profile and attributes: never the stale `enabled`.
      await withUserAttributeWrite(userId, async () => {
        const current = await readUser(userId);
        await request(`/users/${encodeURIComponent(userId)}`, {
          method: "PUT",
          body: JSON.stringify({
            email: current.email,
            firstName: input.firstName,
            lastName: input.lastName,
            attributes: current.attributes,
          }),
        });
      });
    }
    return { id: existing.id, created: false };
  }

  const response = await request("/users", {
    method: "POST",
    body: JSON.stringify({
      username: input.email,
      email: input.email,
      firstName: input.firstName,
      lastName: input.lastName,
      enabled: true,
      emailVerified: false,
      attributes: { [BFF_SIGNUP_USER_ATTRIBUTE]: ["true"] },
    }),
  }, [201, 409]);
  const id = createdId(response);
  if (response.status === 201 && id) return { id, created: true };

  // A concurrent request may have won the create. Resolve the same unique
  // email record rather than treating the idempotent retry as a new identity.
  const raced = await findIdentityUserByEmail(input.email);
  if (!raced?.id || raced.enabled === false) {
    throw new IdentityAdminError("Keycloak did not identify the signup user", 409);
  }
  const racedManagedDraft = raced.emailVerified !== true &&
    raced.attributes?.[BFF_SIGNUP_USER_ATTRIBUTE]?.includes("true") === true;
  if (raced.emailVerified !== true && !racedManagedDraft) {
    throw new IdentityAdminError("The existing identity must be verified through its provider", 409);
  }
  return { id: raced.id, created: false };
}

async function findIdentityUserByEmail(email: string): Promise<UserRepresentation | null> {
  const query = new URLSearchParams({ email, exact: "true", max: "2" });
  const response = await request(`/users?${query}`);
  const matches = (await response.json() as UserRepresentation[])
    .filter((user) => user.email?.toLowerCase() === email);
  if (matches.length > 1) {
    throw new IdentityAdminError("Multiple Keycloak users use this email address", 409);
  }
  return matches[0] || null;
}

const PHONE_ATTRIBUTE = "phoneNumber";
const PHONE_VERIFIED_ATTRIBUTE = "phoneNumberVerified";
const BFF_PHONE_USER_ATTRIBUTE = "digit.identityBffPhoneOtp";

export interface PhoneIdentityUser {
  id: string;
  name: string;
  created: boolean;
}

function verifiedPhoneOwner(user: UserRepresentation, phoneNumber: string): boolean {
  return user.attributes?.[PHONE_ATTRIBUTE]?.includes(phoneNumber) === true &&
    user.attributes?.[PHONE_VERIFIED_ATTRIBUTE]?.includes("true") === true;
}

function phoneIdentityUser(user: UserRepresentation, created: boolean): PhoneIdentityUser {
  if (!user.id || user.enabled === false) {
    throw new IdentityAdminError("The Keycloak user for this phone number is disabled", 403);
  }
  const name = [user.firstName, user.lastName].map((part) => part?.trim()).filter(Boolean).join(" ");
  return { id: user.id, name, created };
}

/**
 * Every user whose VERIFIED phone is this number. The query already asks for
 * verified owners only, and all pages are read, so unverified holders of the
 * number can never hide the real owner behind a result limit.
 */
export async function findVerifiedPhoneUsers(phoneNumber: string): Promise<UserRepresentation[]> {
  const query = new URLSearchParams({
    q: `${PHONE_ATTRIBUTE}:${phoneNumber} ${PHONE_VERIFIED_ATTRIBUTE}:true`,
    briefRepresentation: "false",
  });
  return (await paged<UserRepresentation>(`/users?${query}`))
    .filter((user) => verifiedPhoneOwner(user, phoneNumber));
}

/**
 * False when the Keycloak user is disabled, no longer exists, or no longer
 * holds `phoneNumber` as its verified phone (removed, unverified or moved to
 * another person).
 */
export async function phoneIdentityStillValid(userId: string, phoneNumber: string): Promise<boolean> {
  const user = await findUser(userId);
  return user !== null && user.enabled !== false && verifiedPhoneOwner(user, phoneNumber);
}

/**
 * The Keycloak user who owns a phone number the caller has just proved with a
 * citizen OTP (#2189): the one user whose VERIFIED phone matches, or a new
 * user created with that number marked verified. An unverified match is never
 * taken over. Two verified owners, or a disabled owner, fail closed.
 * Caller holds a person lease followed by the normalized phone lock.
 */
export async function ensurePhoneIdentityUser(phoneNumber: string): Promise<PhoneIdentityUser> {
  const owners = await findVerifiedPhoneUsers(phoneNumber);
  if (owners.length > 1) {
    throw new IdentityAdminError("Multiple Keycloak users have verified this phone number", 409);
  }
  if (owners[0]) return phoneIdentityUser(owners[0], false);

  const user = await createPhoneIdentityUser(`phone-${randomUUID()}`, phoneNumber);
  if (!user) throw new IdentityAdminError("Keycloak did not identify the phone user", 409);
  return user;
}

/**
 * Creates the phone user under `username`, or returns whoever won a race to
 * create it for the same number. Null when the username belongs to someone
 * who no longer owns the number.
 */
async function createPhoneIdentityUser(
  username: string,
  phoneNumber: string,
): Promise<PhoneIdentityUser | null> {
  const response = await request("/users", {
    method: "POST",
    body: JSON.stringify({
      username,
      enabled: true,
      attributes: {
        [PHONE_ATTRIBUTE]: [phoneNumber],
        [PHONE_VERIFIED_ATTRIBUTE]: ["true"],
        [BFF_PHONE_USER_ATTRIBUTE]: ["true"],
      },
    }),
  }, [201, 409]);
  const id = createdId(response);
  if (response.status === 201 && id) {
    // Keycloak drops unmanaged attributes silently unless the realm keeps
    // them. A user without its verified phone would never be found again and
    // would block every later sign-in for the number, so it is removed and
    // the misconfiguration is reported instead.
    const created = await readUser(id);
    if (!verifiedPhoneOwner(created, phoneNumber)) {
      await request(`/users/${encodeURIComponent(id)}`, { method: "DELETE" }, [204, 404]);
      console.error(
        "Keycloak did not store phoneNumber/phoneNumberVerified on a new user. " +
        "Set the realm's unmanagedAttributePolicy to ADMIN_EDIT (#2193).",
      );
      throw new IdentityAdminError("Keycloak did not store the phone attributes", 503);
    }
    return { id, name: "", created: true };
  }

  const query = new URLSearchParams({ username, exact: "true", briefRepresentation: "false" });
  const holder = (await (await request(`/users?${query}`)).json() as UserRepresentation[])
    .find((user) => user.username === username);
  if (!holder) throw new IdentityAdminError("Keycloak did not identify the phone user", 409);
  return verifiedPhoneOwner(holder, phoneNumber) ? phoneIdentityUser(holder, false) : null;
}

export interface PasswordSetupInspection {
  userId: string;
  hasPassword: boolean;
  federatedProviders: string[];
  emailVerified: boolean;
}

/**
 * Exact, non-public account inspection used only by password recovery. The
 * route deliberately never returns this shape: credential/provider presence
 * would otherwise be an account-enumeration oracle.
 */
export async function inspectPasswordSetupAccount(
  email: string,
): Promise<PasswordSetupInspection | null> {
  const user = await findIdentityUserByEmail(email.trim().toLowerCase());
  if (!user?.id || user.enabled === false) return null;
  return inspectPasswordSetupAccountById(user.id);
}

export async function inspectPasswordSetupAccountById(
  userId: string,
): Promise<PasswordSetupInspection | null> {
  const user = await readUser(userId);
  if (!user.id || user.enabled === false) return null;
  const [credentialsResponse, identitiesResponse] = await Promise.all([
    request(`/users/${encodeURIComponent(user.id)}/credentials`),
    request(`/users/${encodeURIComponent(user.id)}/federated-identity`),
  ]);
  const credentials = await credentialsResponse.json() as CredentialRepresentation[];
  const identities = await identitiesResponse.json() as FederatedIdentityRepresentation[];
  return {
    userId: user.id,
    hasPassword: credentials.some((credential) => credential.type === "password"),
    federatedProviders: identities.flatMap((identity) =>
      identity.identityProvider ? [identity.identityProvider] : []
    ),
    emailVerified: user.emailVerified === true,
  };
}

export async function hasPasswordCredential(userId: string): Promise<boolean> {
  const response = await request(`/users/${encodeURIComponent(userId)}/credentials`);
  const credentials = await response.json() as CredentialRepresentation[];
  return credentials.some((credential) => credential.type === "password");
}

export async function sendPasswordSetupEmail(input: {
  userId: string;
  emailVerified: boolean;
  redirectUri: string;
  /** The surface's Keycloak client: its theme renders the action pages (item 5). */
  clientId?: string;
}): Promise<void> {
  const query = new URLSearchParams({
    client_id: input.clientId || config.keycloakBffClientId,
    lifespan: String(config.identityPasswordSetupTtlSeconds),
    redirect_uri: input.redirectUri,
  });
  await request(
    `/users/${encodeURIComponent(input.userId)}/execute-actions-email?${query}`,
    {
      method: "PUT",
      body: JSON.stringify(input.emailVerified
        ? ["UPDATE_PASSWORD"]
        : ["VERIFY_EMAIL", "UPDATE_PASSWORD"]),
    },
  );
}

/** Live Keycloak check that the user is still a member of the Organization. */
export async function isOrganizationMember(organizationId: string, userId: string): Promise<boolean> {
  try {
    await request(
      `/organizations/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(userId)}`,
    );
    return true;
  } catch (error) {
    if (error instanceof IdentityAdminError && error.status === 404) return false;
    throw error;
  }
}

export async function isOrganizationGroupMember(
  organizationId: string,
  groupId: string,
  userId: string,
): Promise<boolean> {
  // Keycloak answers 404 here for a non-member, so this one call also covers
  // the Organization membership check.
  let response: Response;
  try {
    response = await request(
      `/organizations/${encodeURIComponent(organizationId)}` +
      `/members/${encodeURIComponent(userId)}/groups?briefRepresentation=true`,
    );
  } catch (error) {
    if (error instanceof IdentityAdminError && error.status === 404) return false;
    throw error;
  }
  const groups = await response.json() as GroupRepresentation[];
  return groups.some((group) => group.id === groupId);
}

export async function ensureOrganizationMembership(input: {
  organizationId: string;
  userId: string;
}): Promise<void> {
  await request(
    `/organizations/${encodeURIComponent(input.organizationId)}/members`,
    { method: "POST", body: JSON.stringify(input.userId) },
    [201, 409],
  );
}

async function clientUuid(clientId: string): Promise<string> {
  const query = new URLSearchParams({ clientId });
  const response = await request(`/clients?${query}`);
  const clients = await response.json() as Array<{ id?: string; clientId?: string }>;
  const client = clients.find((candidate) => candidate.clientId === clientId);
  if (!client?.id) throw new IdentityAdminError("Keycloak client was not found", 404);
  return client.id;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The subject an assignment group belongs to, or null for a shared group.
 * The deleted `role-assignments/_ensure` route (D1) named every group it
 * created `<groupName>--<userId>`, and existing boxes still hold them, so a
 * group whose name ends in a UUID other than the subject we are reading cannot
 * contribute roles to that subject and its role mappings and member list never
 * need to be fetched. Groups an operator made
 * by hand carry no such suffix and keep the full membership check.
 */
function assignmentOwner(groupName: string): string | null {
  const suffix = groupName.slice(groupName.lastIndexOf("--") + 2);
  return groupName.includes("--") && UUID.test(suffix) ? suffix : null;
}

/**
 * Organization membership and allowlisted client roles.
 *
 * `subject` restricts the read to one user: without it every login paged the
 * members of every group in the Organization, so the admin-call count grew
 * with the realm's user count rather than with the caller. (Dhruv review,
 * #2088.) The realm-wide form is still used by the reconciliation sweep,
 * which genuinely needs every member.
 */
export async function readOrganizationReconciliation(
  organizationId: string,
  roleClientId: string,
  subject?: string,
): Promise<OrganizationReconciliationState | null> {
  if (!config.keycloakAllowedOrganizationRoleClients.includes(roleClientId)) {
    throw new IdentityAdminError("Keycloak client is not allowed for Organization roles", 400);
  }
  let organization: OrganizationRepresentation;
  try {
    const response = await request(`/organizations/${encodeURIComponent(organizationId)}`);
    organization = await response.json() as OrganizationRepresentation;
  } catch (error) {
    if (error instanceof IdentityAdminError && error.status === 404) return null;
    throw error;
  }

  const memberRoles = new Map<string, Set<string>>();
  if (subject === undefined) {
    for (const member of await paged<UserRepresentation>(
      `/organizations/${encodeURIComponent(organizationId)}/members`,
    )) {
      if (member.id) memberRoles.set(member.id, new Set());
    }
  } else if (await isOrganizationMember(organizationId, subject)) {
    memberRoles.set(subject, new Set());
  }
  if (organization.enabled === false) {
    return { organizationId, enabled: false, memberRoles: new Map() };
  }
  if (subject !== undefined && memberRoles.size === 0) {
    return { organizationId, enabled: true, memberRoles: new Map() };
  }

  const uuid = await clientUuid(roleClientId);
  const groups = await paged<GroupRepresentation>(
    `/organizations/${encodeURIComponent(organizationId)}/groups?briefRepresentation=false`,
  );
  for (const group of groups) {
    // A tenant-bearing group is an independent subtenant grant. Its roles must
    // never bleed into the root tenant merely because both records share an
    // Organization.
    if (groupAttribute(group, "digit.tenantId")) continue;
    const owner = assignmentOwner(group.name);
    if (subject !== undefined && owner !== null && owner !== subject) continue;
    const mappingPath =
      `/organizations/${encodeURIComponent(organizationId)}` +
      `/groups/${encodeURIComponent(group.id)}/role-mappings/clients/${encodeURIComponent(uuid)}`;
    const rolesResponse = await request(mappingPath);
    const roles = await rolesResponse.json() as RoleRepresentation[];
    if (roles.length === 0) continue;
    const groupMembers = await paged<UserRepresentation>(
      `/organizations/${encodeURIComponent(organizationId)}` +
      `/groups/${encodeURIComponent(group.id)}/members`,
    );
    for (const member of groupMembers) {
      if (!member.id || !memberRoles.has(member.id)) continue;
      const desired = memberRoles.get(member.id)!;
      for (const role of roles) desired.add(role.name);
    }
  }
  return {
    organizationId,
    enabled: true,
    memberRoles: new Map([...memberRoles].map(([member, roles]) => [
      member,
      [...roles].sort(),
    ])),
  };
}

/**
 * Reconciliation state for one explicit subtenant. Organization membership
 * establishes the root relationship, but only membership and roles on the
 * tenant-bearing group grant this tenant. No group name/path or dotted tenant
 * code is interpreted as hierarchy.
 */
export async function readOrganizationGroupReconciliation(
  mapping: OrganizationGroupMapping,
  roleClientId: string,
  subject?: string,
): Promise<OrganizationReconciliationState | null> {
  if (!config.keycloakAllowedOrganizationRoleClients.includes(roleClientId)) {
    throw new IdentityAdminError("Keycloak client is not allowed for Organization roles", 400);
  }
  const organization = await readOrganizationMapping(mapping.organizationId);
  if (!organization || organization.tenantId !== mapping.rootTenantId) return null;
  const group = await readOrganizationGroup(mapping.organizationId, mapping.groupId);
  if (!group || !asGroupMapping(group, organization)) return null;

  const memberRoles = new Map<string, Set<string>>();
  if (subject === undefined) {
    for (const member of await paged<UserRepresentation>(
      `/organizations/${encodeURIComponent(mapping.organizationId)}` +
      `/groups/${encodeURIComponent(mapping.groupId)}/members`,
    )) {
      if (member.id) memberRoles.set(member.id, new Set());
    }
  } else if (await isOrganizationGroupMember(
    mapping.organizationId, mapping.groupId, subject,
  )) {
    memberRoles.set(subject, new Set());
  }
  if (memberRoles.size === 0) {
    return { organizationId: mapping.organizationId, enabled: true, memberRoles: new Map() };
  }

  const uuid = await clientUuid(roleClientId);
  const mappingPath =
    `/organizations/${encodeURIComponent(mapping.organizationId)}` +
    `/groups/${encodeURIComponent(mapping.groupId)}/role-mappings/clients/${encodeURIComponent(uuid)}`;
  const rolesResponse = await request(mappingPath);
  const roles = await rolesResponse.json() as RoleRepresentation[];
  for (const desired of memberRoles.values()) {
    for (const role of roles) desired.add(role.name);
  }
  return {
    organizationId: mapping.organizationId,
    enabled: true,
    memberRoles: new Map([...memberRoles].map(([member, rolesForMember]) => [
      member,
      [...rolesForMember].sort(),
    ])),
  };
}
