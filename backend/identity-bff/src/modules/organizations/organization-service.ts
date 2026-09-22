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

interface CredentialRepresentation {
  id?: string;
  type?: string;
}

interface FederatedIdentityRepresentation {
  identityProvider?: string;
  userId?: string;
}

const MANAGED_TENANTS_ATTRIBUTE = "digit.managedTenants";
const BFF_INVITED_USER_ATTRIBUTE = "digit.identityBffInvited";
const BFF_SIGNUP_USER_ATTRIBUTE = "digit.identityBffSignup";

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

/**
 * The single enabled Organization mapped to `tenantId`, without listing the
 * realm. Backs the subject-scoped login path. (Dhruv review, #2088.)
 */
export async function readOrganizationMappingForTenant(
  tenantId: string,
): Promise<OrganizationMapping | null> {
  const matches = await organizationsForTenant(tenantId);
  if (matches.length > 1) {
    throw new IdentityAdminError("Multiple Organizations map to this tenant", 409);
  }
  return matches[0] ? asMapping(matches[0]) : null;
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
}): Promise<void> {
  const response = await request(`/users/${encodeURIComponent(input.userId)}`);
  const user = await response.json() as UserRepresentation;
  if (user.id !== input.userId || user.enabled === false ||
      user.email?.trim().toLowerCase() !== input.email || user.emailVerified !== true) {
    throw new IdentityAdminError("The verified magic-link identity does not match the signup");
  }
  const attributes = { ...user.attributes };
  delete attributes[BFF_SIGNUP_USER_ATTRIBUTE];
  await request(`/users/${encodeURIComponent(input.userId)}`, {
    method: "PUT",
    body: JSON.stringify({
      ...user,
      firstName: input.firstName,
      lastName: input.lastName,
      attributes,
    }),
  });
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
    if (managedDraft &&
        (existing.firstName !== input.firstName || existing.lastName !== input.lastName)) {
      await request(`/users/${encodeURIComponent(existing.id)}`, {
        method: "PUT",
        body: JSON.stringify({
          ...existing,
          firstName: input.firstName,
          lastName: input.lastName,
        }),
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
  const id = response.headers.get("location")?.split("/").filter(Boolean).pop();
  if (response.status === 201 && id) return { id, created: true };

  // A concurrent request may have won the create. Resolve the same unique
  // email record rather than treating the idempotent retry as a new identity.
  const raced = await findIdentityUserByEmail(input.email);
  if (!raced?.id || raced.enabled === false) {
    throw new IdentityAdminError("Keycloak did not identify the signup user", 409);
  }
  return { id: raced.id, created: false };
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
  const response = await request(`/users/${encodeURIComponent(userId)}`);
  const user = await response.json() as UserRepresentation;
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
}): Promise<void> {
  const query = new URLSearchParams({
    client_id: config.keycloakBffClientId,
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The subject an assignment group belongs to, or null for a shared group.
 * `ensureOrganizationRoleAssignment` names every group it creates
 * `<groupName>--<userId>`, so a group whose name ends in a UUID other than the
 * subject we are reading cannot contribute roles to that subject and its role
 * mappings and member list never need to be fetched. Groups an operator made
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
    `/organizations/${encodeURIComponent(organizationId)}/groups`,
  );
  for (const group of groups) {
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
