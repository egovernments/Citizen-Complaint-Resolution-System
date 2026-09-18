import { config } from "../../infrastructure/config.js";
import { getAdminToken } from "../../integrations/keycloak/admin-session.js";

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
}

interface RoleRepresentation {
  id: string;
  name: string;
}

interface UserRepresentation {
  id?: string;
  username?: string;
  email?: string;
  emailVerified?: boolean;
  firstName?: string;
  lastName?: string;
  enabled?: boolean;
  attributes?: Record<string, string[]>;
  requiredActions?: string[];
}

const MANAGED_TENANTS_ATTRIBUTE = "digit.managedTenants";
const BFF_INVITED_USER_ATTRIBUTE = "digit.identityBffInvited";

export async function managedTenantsFromIdentity(userId: string): Promise<string[]> {
  const response = await request(`/users/${encodeURIComponent(userId)}`);
  const user = await response.json() as UserRepresentation;
  return [...new Set(user.attributes?.[MANAGED_TENANTS_ATTRIBUTE] || [])].sort();
}

/** Durable account inventory; Redis is only an acceleration index. */
export async function listManagedIdentityAccounts(): Promise<Array<{
  subject: string;
  tenantId: string;
}>> {
  const users = await paged<UserRepresentation>("/users");
  return users.flatMap((user) => user.id
    ? [...new Set(user.attributes?.[MANAGED_TENANTS_ATTRIBUTE] || [])]
        .map((tenantId) => ({ subject: user.id!, tenantId }))
    : []);
}

/** Durable inventory used to deactivate accounts after Organization removal. */
export async function recordManagedTenant(userId: string, tenantId: string): Promise<void> {
  const response = await request(`/users/${encodeURIComponent(userId)}`);
  const user = await response.json() as UserRepresentation;
  const tenants = [...new Set([...(user.attributes?.[MANAGED_TENANTS_ATTRIBUTE] || []), tenantId])].sort();
  if (tenants.length === (user.attributes?.[MANAGED_TENANTS_ATTRIBUTE] || []).length) return;
  await request(`/users/${encodeURIComponent(userId)}`, {
    method: "PUT",
    body: JSON.stringify({
      ...user,
      attributes: { ...user.attributes, [MANAGED_TENANTS_ATTRIBUTE]: tenants },
    }),
  });
}

export interface IdentityUserProfile {
  name: string;
  emailId?: string;
}

export interface InvitedIdentityUser {
  id: string;
  email: string;
  name: string;
  created: boolean;
  activationRequired: boolean;
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

export async function enabledIdentityProviderAliases(): Promise<Set<string>> {
  const response = await request(
    "/identity-provider/instances?briefRepresentation=true&max=100",
  );
  const providers = await response.json() as Array<{
    alias?: string;
    enabled?: boolean;
  }>;
  return new Set(providers.flatMap((provider) =>
    provider.enabled !== false && provider.alias ? [provider.alias] : [],
  ));
}

/** Enabled OIDC clients used to hide methods whose Keycloak flow is not installed yet. */
export async function enabledIdentityClientIds(clientIds: string[]): Promise<Set<string>> {
  const enabled = new Set<string>();
  await Promise.all([...new Set(clientIds)].map(async (clientId) => {
    const query = new URLSearchParams({ clientId, search: "true" });
    const response = await request(`/clients?${query}`);
    const clients = await response.json() as Array<{ clientId?: string; enabled?: boolean }>;
    if (clients.some((client) => client.clientId === clientId && client.enabled !== false)) {
      enabled.add(clientId);
    }
  }));
  return enabled;
}

function realmPath(path: string): string {
  return `/admin/realms/${encodeURIComponent(config.keycloakOrganizationRealm)}${path}`;
}

async function request(
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
    throw new IdentityAdminError(
      `Keycloak Admin API returned ${response.status}${detail ? `: ${detail}` : ""}`,
      response.status === 400 || response.status === 404 || response.status === 409
        ? response.status
        : 502,
    );
  }
  return response;
}

async function paged<T>(path: string): Promise<T[]> {
  const values: T[] = [];
  for (let first = 0; ; first += 100) {
    const separator = path.includes("?") ? "&" : "?";
    const response = await request(`${path}${separator}first=${first}&max=100`);
    const page = await response.json() as T[];
    values.push(...page);
    if (page.length < 100) return values;
  }
}

function mappedTenant(organization: OrganizationRepresentation): string | null {
  const values = organization.attributes?.["digit.rootTenantId"];
  return Array.isArray(values) && values.length === 1 ? values[0] : null;
}

function attribute(organization: OrganizationRepresentation, name: string): string | null {
  const values = organization.attributes?.[name];
  return Array.isArray(values) && values.length === 1 ? values[0] : null;
}

const normalizedName = (value: string) => value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en");

/** Live collision check for identifiers persisted on Keycloak Organizations. */
export async function organizationIdentifierAvailable(type: string, value: string): Promise<boolean> {
  const organizations = await paged<OrganizationRepresentation>(
    "/organizations?briefRepresentation=false",
  );
  const normalized = type === "ACCOUNT_CODE" ? value.trim().toUpperCase()
    : type === "ORGANIZATION_NAME" ? normalizedName(value)
      : value.trim().toLowerCase();
  return !organizations.some((organization) => {
    if (type === "ORGANIZATION_NAME") return normalizedName(organization.name || "") === normalized;
    if (type === "ORGANIZATION_ALIAS") return organization.alias?.toLowerCase() === normalized;
    if (type === "URL_SLUG") {
      return organization.alias?.toLowerCase() === normalized ||
        attribute(organization, "digit.urlSlug")?.toLowerCase() === normalized;
    }
    if (type === "ACCOUNT_CODE") return attribute(organization, "digit.accountCode")?.toUpperCase() === normalized;
    if (type === "TENANT_ID") return mappedTenant(organization)?.toLowerCase() === normalized;
    throw new IdentityAdminError("Unsupported identifier type", 400);
  });
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
  name: string;
  tenantId: string;
}

function asMapping(organization: OrganizationRepresentation): OrganizationMapping | null {
  const tenantId = mappedTenant(organization);
  if (!organization.id || !organization.alias || organization.enabled === false || !tenantId) {
    return null;
  }
  return {
    organizationId: organization.id,
    alias: organization.alias,
    name: organization.name || organization.alias,
    tenantId,
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

export async function ensureOrganization(input: {
  tenantId: string;
  alias: string;
  name: string;
  accountCode?: string;
  urlSlug?: string;
}): Promise<{ id: string; tenantId: string; alias: string; name: string }> {
  let matches = await organizationsForTenant(input.tenantId);
  if (matches.length > 1) {
    throw new IdentityAdminError("Multiple Organizations map to this tenant", 409);
  }

  let organization = matches[0];
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
    const location = response.headers.get("location");
    const id = location?.split("/").filter(Boolean).pop();
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

  if (organization.name !== input.name || organization.enabled === false ||
      (input.accountCode && attribute(organization, "digit.accountCode") !== input.accountCode) ||
      (input.urlSlug && attribute(organization, "digit.urlSlug") !== input.urlSlug)) {
    await request(`/organizations/${encodeURIComponent(organization.id)}`, {
      method: "PUT",
      body: JSON.stringify({
        ...organization,
        name: input.name,
        alias: input.alias,
        enabled: true,
        attributes: {
          ...organization.attributes,
          "digit.rootTenantId": [input.tenantId],
          ...(input.accountCode && { "digit.accountCode": [input.accountCode] }),
          ...(input.urlSlug && { "digit.urlSlug": [input.urlSlug] }),
        },
      }),
    });
  }
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
  const response = await request(`/users/${encodeURIComponent(userId)}`);
  const user = await response.json() as UserRepresentation;
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

function invitedUser(user: UserRepresentation, email: string, created: boolean): InvitedIdentityUser {
  if (!user.id || user.enabled === false || user.email?.toLowerCase() !== email) {
    throw new IdentityAdminError("The Keycloak user is not available for invitation", 409);
  }
  const managedInvitation = user.attributes?.[BFF_INVITED_USER_ATTRIBUTE]?.includes("true") === true;
  if (user.emailVerified !== true && !managedInvitation) {
    throw new IdentityAdminError(
      "An unverified Keycloak account already uses this email address",
      409,
    );
  }
  const name = [user.firstName, user.lastName]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ") || user.username?.trim() || email;
  return {
    id: user.id,
    email,
    name,
    created,
    activationRequired: user.emailVerified !== true,
  };
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

/** Creates the passwordless Keycloak identity used by an employee invitation. */
export async function ensureInvitedIdentityUser(input: {
  email: string;
  firstName: string;
  lastName: string;
}): Promise<InvitedIdentityUser> {
  const email = input.email.trim().toLowerCase();
  const existing = await findIdentityUserByEmail(email);
  if (existing) return invitedUser(existing, email, false);

  const response = await request("/users", {
    method: "POST",
    body: JSON.stringify({
      username: email,
      email,
      firstName: input.firstName,
      lastName: input.lastName,
      enabled: true,
      emailVerified: false,
      requiredActions: ["VERIFY_EMAIL", "UPDATE_PASSWORD"],
      attributes: { [BFF_INVITED_USER_ATTRIBUTE]: ["true"] },
    }),
  }, [201, 409]);
  const id = response.headers.get("location")?.split("/").filter(Boolean).pop();
  const created = response.status === 201;
  const user = id
    ? await request(`/users/${encodeURIComponent(id)}`).then((value) => value.json() as Promise<UserRepresentation>)
    : await findIdentityUserByEmail(email);
  if (!user) throw new IdentityAdminError("Keycloak did not identify the user it created");
  return invitedUser(user, email, created);
}

/** Sends the one-use Keycloak link that verifies email and establishes a password. */
export async function sendInvitedIdentityUserActivation(userId: string): Promise<void> {
  await request(`/users/${encodeURIComponent(userId)}/execute-actions-email`, {
    method: "PUT",
    body: JSON.stringify(["VERIFY_EMAIL", "UPDATE_PASSWORD"]),
  });
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

async function ensureOrganizationGroup(
  organizationId: string,
  name: string,
): Promise<GroupRepresentation> {
  const base = `/organizations/${encodeURIComponent(organizationId)}/groups`;
  const query = new URLSearchParams({ search: name, exact: "true", max: "20" });
  let response = await request(`${base}?${query}`);
  let groups = await response.json() as GroupRepresentation[];
  let group = groups.find((candidate) => candidate.name === name);
  if (group) return group;

  response = await request(base, {
    method: "POST",
    body: JSON.stringify({ name }),
  }, [201, 204, 409]);
  const id = response.headers.get("location")?.split("/").filter(Boolean).pop();
  if (id) return { id, name };
  response = await request(`${base}?${query}`);
  groups = await response.json() as GroupRepresentation[];
  group = groups.find((candidate) => candidate.name === name);
  if (!group) throw new IdentityAdminError("Keycloak did not create the Organization group");
  return group;
}

async function clientUuid(clientId: string): Promise<string> {
  const query = new URLSearchParams({ clientId });
  const response = await request(`/clients?${query}`);
  const clients = await response.json() as Array<{ id?: string; clientId?: string }>;
  const client = clients.find((candidate) => candidate.clientId === clientId);
  if (!client?.id) throw new IdentityAdminError("Keycloak client was not found", 404);
  return client.id;
}

async function clientRole(
  clientId: string,
  roleName: string,
): Promise<RoleRepresentation> {
  const response = await request(
    `/clients/${encodeURIComponent(clientId)}/roles/${encodeURIComponent(roleName)}`,
  );
  const role = await response.json() as RoleRepresentation;
  if (!role.id || role.name !== roleName) {
    throw new IdentityAdminError(`Keycloak client role was not found: ${roleName}`, 404);
  }
  return role;
}

export async function ensureOrganizationRoleAssignment(input: {
  organizationId: string;
  userId: string;
  groupName: string;
  clientId: string;
  roles: string[];
}): Promise<{ groupId: string; roles: string[] }> {
  if (!config.keycloakAllowedOrganizationRoleClients.includes(input.clientId)) {
    throw new IdentityAdminError("Keycloak client is not allowed for Organization roles", 400);
  }
  // This endpoint is per-user. Give the assignment its own Organization group
  // so changing one user's requested roles never rewrites a shared group's
  // role mappings for every other member.
  const assignmentGroup = `${input.groupName.slice(0, 180)}--${input.userId}`;
  const group = await ensureOrganizationGroup(input.organizationId, assignmentGroup);
  await request(
    `/organizations/${encodeURIComponent(input.organizationId)}` +
      `/groups/${encodeURIComponent(group.id)}/members/${encodeURIComponent(input.userId)}`,
    { method: "PUT" },
    [204, 409],
  );

  const uuid = await clientUuid(input.clientId);
  const desired = await Promise.all(input.roles.map((role) => clientRole(uuid, role)));
  const mappingPath =
    `/organizations/${encodeURIComponent(input.organizationId)}` +
    `/groups/${encodeURIComponent(group.id)}/role-mappings/clients/${encodeURIComponent(uuid)}`;
  const currentResponse = await request(mappingPath);
  const current = await currentResponse.json() as RoleRepresentation[];
  const desiredNames = new Set(desired.map((role) => role.name));
  const currentNames = new Set(current.map((role) => role.name));
  const add = desired.filter((role) => !currentNames.has(role.name));
  const remove = current.filter((role) => !desiredNames.has(role.name));
  if (add.length) {
    await request(mappingPath, {
      method: "POST",
      body: JSON.stringify(add),
    });
  }
  if (remove.length) {
    await request(mappingPath, {
      method: "DELETE",
      body: JSON.stringify(remove),
    });
  }
  return { groupId: group.id, roles: desired.map((role) => role.name).sort() };
}

export async function readOrganizationReconciliation(
  organizationId: string,
  roleClientId: string,
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

  const members = await paged<UserRepresentation>(
    `/organizations/${encodeURIComponent(organizationId)}/members`,
  );
  const memberRoles = new Map<string, Set<string>>();
  for (const member of members) {
    if (member.id) memberRoles.set(member.id, new Set());
  }
  if (organization.enabled === false) {
    return { organizationId, enabled: false, memberRoles: new Map() };
  }

  const uuid = await clientUuid(roleClientId);
  const groups = await paged<GroupRepresentation>(
    `/organizations/${encodeURIComponent(organizationId)}/groups`,
  );
  for (const group of groups) {
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
    memberRoles: new Map([...memberRoles].map(([subject, roles]) => [
      subject,
      [...roles].sort(),
    ])),
  };
}
