import express from "express";
import crypto from "node:crypto";

interface MockUser {
  id: string;
  username: string;
  email: string;
  firstName?: string;
  lastName?: string;
  enabled: boolean;
  emailVerified: boolean;
  attributes?: Record<string, string[]>;
  requiredActions?: string[];
  activationEmails?: number;
}

interface RealmState {
  name: string;
  roles: Array<{ id: string; name: string; description?: string }>;
  groups: Map<string, { id: string; name: string; path: string }>;
  userGroups: Map<string, string[]>; // userId -> groupId[]
  userRoles: Map<string, Array<{ id: string; name: string }>>; // userId -> roles[]
  users: MockUser[];
  organizations: Map<string, {
    id: string;
    name: string;
    alias: string;
    enabled: boolean;
    attributes: Record<string, string[]>;
    groups: Map<string, { id: string; name: string }>;
    members: Set<string>;
    groupMembers: Map<string, Set<string>>;
    groupClientRoles: Map<string, Array<{ id: string; name: string }>>;
  }>;
  clients: Map<string, {
    id: string;
    clientId: string;
    roles: Array<{ id: string; name: string }>;
  }>;
}

let realms: Map<string, RealmState>;
let lastAdminGrantType: string | undefined;
/** "METHOD /path" of every Admin API call, so tests can assert read scope. */
let adminRequests: string[];

function initState() {
  realms = new Map();
  lastAdminGrantType = undefined;
  adminRequests = [];
}

export function getLastAdminGrantType(): string | undefined {
  return lastAdminGrantType;
}

export function adminRequestLog(): string[] {
  return [...adminRequests];
}

export function resetAdminRequestLog(): void {
  adminRequests = [];
}

export function resetState() {
  initState();
}

function getRealm(name: string): RealmState | undefined {
  return realms.get(name);
}

function getOrCreateRealm(name: string): RealmState {
  let realm = realms.get(name);
  if (!realm) {
    realm = {
      name,
      roles: [],
      groups: new Map(),
      userGroups: new Map(),
      userRoles: new Map(),
      users: [],
      organizations: new Map(),
      clients: new Map([
        ["digit-ui", {
          id: "digit-ui-uuid",
          clientId: "digit-ui",
          roles: [
            "TENANT_ADMIN", "VIEWER", "GRO", "PGR_VIEWER",
            "ACCOUNT_ADMIN", "MDMS_ADMIN", "LOC_ADMIN", "SUPERUSER",
          ].map((role) => ({
            id: `${role.toLowerCase()}-id`,
            name: role,
          })),
        }],
        ["digit-identity-bff-magic-link", {
          id: "digit-identity-bff-magic-link-uuid",
          clientId: "digit-identity-bff-magic-link",
          enabled: true,
          roles: [],
        }],
      ]),
    };
    realms.set(name, realm);
  }
  return realm;
}

export function createKcAdminMock() {
  initState();

  const app = express();
  // The mock runs in vitest's globalSetup process, so tests read the log over
  // HTTP rather than through the exports above.
  app.use((req, _res, next) => {
    if (!req.path.startsWith("/__test")) adminRequests.push(`${req.method} ${req.path}`);
    next();
  });
  app.get("/__test/admin-log", (_req, res) => res.json(adminRequestLog()));
  app.delete("/__test/admin-log", (_req, res) => {
    resetAdminRequestLog();
    res.status(204).end();
  });
  app.use(express.json({ limit: "10mb", strict: false }));

  // POST /realms/master/protocol/openid-connect/token — admin auth
  app.post(
    "/realms/:realm/protocol/openid-connect/token",
    express.urlencoded({ extended: true }),
    (req, res) => {
      lastAdminGrantType = req.body.grant_type;
      res.json({
        access_token: "mock-kc-admin-token",
        token_type: "Bearer",
        expires_in: 60,
      });
    },
  );

  // POST /admin/realms — create realm
  app.post("/admin/realms", (req, res) => {
    const body = req.body;
    const realmName = body.realm;
    if (!realmName) {
      return res.status(400).json({ error: "realm name required" });
    }
    if (realms.has(realmName)) {
      return res
        .status(409)
        .json({ errorMessage: `Conflict detected. See logs for details` });
    }

    // Extract roles from the realm representation
    const realmRoles: Array<{ id: string; name: string; description?: string }> =
      (body.roles?.realm || []).map(
        (r: { name: string; description?: string }) => ({
          id: crypto.randomUUID(),
          name: r.name,
          description: r.description,
        }),
      );

    // Extract groups from the realm representation
    const groups = new Map<string, { id: string; name: string; path: string }>();
    if (Array.isArray(body.groups)) {
      for (const g of body.groups) {
        const id = crypto.randomUUID();
        groups.set(g.name, { id, name: g.name, path: `/${g.name}` });
      }
    }

    realms.set(realmName, {
      name: realmName,
      roles: realmRoles,
      groups,
      userGroups: new Map(),
      userRoles: new Map(),
      users: [],
      organizations: new Map(),
      clients: new Map(),
    });

    res.status(201).json({});
  });

  // GET /admin/realms — list realms
  app.get("/admin/realms", (_req, res) => {
    const list = Array.from(realms.values()).map((r) => ({
      realm: r.name,
      enabled: true,
    }));
    res.json(list);
  });

  // GET /admin/realms/:realm — get realm
  app.get("/admin/realms/:realm", (req, res) => {
    const realm = getRealm(req.params.realm);
    if (!realm) {
      return res
        .status(404)
        .json({ error: `Realm not found: ${req.params.realm}` });
    }
    res.json({ realm: realm.name, enabled: true });
  });

  // POST /admin/realms/:realm/groups — create group
  app.post("/admin/realms/:realm/groups", (req, res) => {
    const realm = getRealm(req.params.realm);
    if (!realm) {
      return res.status(404).json({ error: "Realm not found" });
    }
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ error: "group name required" });
    }
    if (realm.groups.has(name)) {
      return res
        .status(409)
        .json({ errorMessage: `Top level group named '${name}' already exists.` });
    }
    const id = crypto.randomUUID();
    realm.groups.set(name, { id, name, path: `/${name}` });
    res.status(201).set("Location", `/admin/realms/${req.params.realm}/groups/${id}`).json({});
  });

  // GET /admin/realms/:realm/groups — list groups
  app.get("/admin/realms/:realm/groups", (req, res) => {
    const realm = getRealm(req.params.realm);
    if (!realm) {
      return res.status(404).json({ error: "Realm not found" });
    }
    res.json(Array.from(realm.groups.values()));
  });

  // GET /admin/realms/:realm/users — search users (supports ?email=...&exact=true)
  app.get("/admin/realms/:realm/users", (req, res) => {
    const realm = getOrCreateRealm(req.params.realm);
    const emailFilter = req.query.email as string | undefined;
    if (emailFilter) {
      const matches = realm.users.filter((u) => u.email === emailFilter);
      return res.json(matches);
    }
    const first = Number(req.query.first || 0);
    const max = Number(req.query.max || realm.users.length);
    res.json(realm.users.slice(first, first + max));
  });

  // POST /admin/realms/:realm/users — create user
  app.post("/admin/realms/:realm/users", (req, res) => {
    const realm = getOrCreateRealm(req.params.realm);
    const {
      id, username, email, firstName, lastName, enabled, emailVerified, attributes,
      requiredActions,
    } = req.body;
    // Check for duplicate by email or username
    const exists = realm.users.some(
      (u) => u.email === email || u.username === username,
    );
    if (exists) {
      return res.status(409).json({ errorMessage: "User exists with same username" });
    }
    const user: MockUser = {
      id: id || crypto.randomUUID(),
      username: username || email,
      email,
      firstName,
      lastName,
      enabled: enabled ?? true,
      emailVerified: emailVerified ?? false,
      attributes,
      requiredActions,
    };
    realm.users.push(user);
    res.status(201).set("Location", `/admin/realms/${req.params.realm}/users/${user.id}`).end();
  });

  app.get("/admin/realms/:realm/users/:userId", (req, res) => {
    const realm = getOrCreateRealm(req.params.realm);
    const user = realm.users.find((candidate) => candidate.id === req.params.userId);
    return user ? res.json(user) : res.status(404).json({ error: "User not found" });
  });

  app.put("/admin/realms/:realm/users/:userId", (req, res) => {
    const realm = getOrCreateRealm(req.params.realm);
    const index = realm.users.findIndex((candidate) => candidate.id === req.params.userId);
    if (index < 0) return res.status(404).json({ error: "User not found" });
    realm.users[index] = { ...realm.users[index], ...req.body, id: req.params.userId };
    return res.status(204).end();
  });

  app.put("/admin/realms/:realm/users/:userId/execute-actions-email", (req, res) => {
    const realm = getOrCreateRealm(req.params.realm);
    const user = realm.users.find((candidate) => candidate.id === req.params.userId);
    if (!user) return res.status(404).json({ error: "User not found" });
    if (!Array.isArray(req.body) || !req.body.every((action) => typeof action === "string")) {
      return res.status(400).json({ error: "actions required" });
    }
    user.requiredActions = [...new Set([...(user.requiredActions || []), ...req.body])];
    user.activationEmails = (user.activationEmails || 0) + 1;
    return res.status(204).end();
  });

  // PUT /admin/realms/:realm/users/:userId/groups/:groupId — add user to group
  app.put(
    "/admin/realms/:realm/users/:userId/groups/:groupId",
    (req, res) => {
      const realm = getRealm(req.params.realm);
      if (!realm) {
        return res.status(404).json({ error: "Realm not found" });
      }
      const { userId, groupId } = req.params;
      const existing = realm.userGroups.get(userId) || [];
      if (!existing.includes(groupId)) {
        existing.push(groupId);
      }
      realm.userGroups.set(userId, existing);
      res.status(204).end();
    },
  );

  // GET /admin/realms/:realm/users/:userId/groups — get user groups
  app.get("/admin/realms/:realm/users/:userId/groups", (req, res) => {
    const realm = getRealm(req.params.realm);
    if (!realm) {
      return res.status(404).json({ error: "Realm not found" });
    }
    const groupIds = realm.userGroups.get(req.params.userId) || [];
    const groups = groupIds
      .map((gid) =>
        Array.from(realm.groups.values()).find((g) => g.id === gid),
      )
      .filter(Boolean);
    res.json(groups);
  });

  // GET /admin/realms/:realm/roles — list realm roles
  app.get("/admin/realms/:realm/roles", (req, res) => {
    const realm = getRealm(req.params.realm);
    if (!realm) {
      return res.status(404).json({ error: "Realm not found" });
    }
    res.json(realm.roles);
  });

  // GET /admin/realms/:realm/roles/:roleName — get role by name
  app.get("/admin/realms/:realm/roles/:roleName", (req, res) => {
    const realm = getRealm(req.params.realm);
    if (!realm) {
      return res.status(404).json({ error: "Realm not found" });
    }
    const role = realm.roles.find((r) => r.name === req.params.roleName);
    if (!role) {
      return res
        .status(404)
        .json({ error: `Could not find role: ${req.params.roleName}` });
    }
    res.json({ id: role.id, name: role.name });
  });

  // POST /admin/realms/:realm/users/:userId/role-mappings/realm — assign realm roles
  app.post(
    "/admin/realms/:realm/users/:userId/role-mappings/realm",
    (req, res) => {
      const realm = getRealm(req.params.realm);
      if (!realm) {
        return res.status(404).json({ error: "Realm not found" });
      }
      const { userId } = req.params;
      const rolesToAssign: Array<{ id: string; name: string }> = req.body;
      const existing = realm.userRoles.get(userId) || [];
      for (const role of rolesToAssign) {
        if (!existing.find((r) => r.id === role.id)) {
          existing.push({ id: role.id, name: role.name });
        }
      }
      realm.userRoles.set(userId, existing);
      res.status(204).end();
    },
  );

  // GET /admin/realms/:realm/users/:userId/role-mappings/realm — get user realm roles
  app.get(
    "/admin/realms/:realm/users/:userId/role-mappings/realm",
    (req, res) => {
      const realm = getRealm(req.params.realm);
      if (!realm) {
        return res.status(404).json({ error: "Realm not found" });
      }
      const roles = realm.userRoles.get(req.params.userId) || [];
      res.json(roles);
    },
  );

  app.get("/admin/realms/:realm/organizations", (req, res) => {
    const realm = getOrCreateRealm(req.params.realm);
    const q = String(req.query.q || "");
    const [attribute, ...valueParts] = q.split(":");
    const value = valueParts.join(":");
    const organizations = Array.from(realm.organizations.values()).filter(
      (organization) => !q || organization.attributes[attribute]?.includes(value),
    );
    res.json(organizations);
  });

  app.post("/admin/realms/:realm/organizations", (req, res) => {
    const realm = getOrCreateRealm(req.params.realm);
    if (Array.from(realm.organizations.values()).some(
      (organization) => organization.alias === req.body.alias,
    )) return res.status(409).json({ error: "duplicate alias" });
    const id = typeof req.body.id === "string" ? req.body.id : crypto.randomUUID();
    realm.organizations.set(id, {
      id,
      name: req.body.name,
      alias: req.body.alias,
      enabled: req.body.enabled !== false,
      attributes: req.body.attributes || {},
      groups: new Map(),
      members: new Set(),
      groupMembers: new Map(),
      groupClientRoles: new Map(),
    });
    res.status(201).set(
      "Location",
      `/admin/realms/${req.params.realm}/organizations/${id}`,
    ).end();
  });

  app.put("/admin/realms/:realm/organizations/:organizationId", (req, res) => {
    const realm = getOrCreateRealm(req.params.realm);
    const organization = realm.organizations.get(req.params.organizationId);
    if (!organization) return res.status(404).json({ error: "not found" });
    Object.assign(organization, req.body);
    res.status(204).end();
  });

  app.get("/admin/realms/:realm/organizations/:organizationId", (req, res) => {
    const realm = getOrCreateRealm(req.params.realm);
    const organization = realm.organizations.get(req.params.organizationId);
    return organization ? res.json(organization) : res.status(404).json({ error: "not found" });
  });

  app.post("/admin/realms/:realm/organizations/:organizationId/members", (req, res) => {
    const realm = getOrCreateRealm(req.params.realm);
    const organization = realm.organizations.get(req.params.organizationId);
    if (!organization) return res.status(404).json({ error: "not found" });
    if (organization.members.has(req.body)) return res.status(409).end();
    organization.members.add(req.body);
    res.status(201).end();
  });

  app.get("/admin/realms/:realm/organizations/:organizationId/members/:memberId", (req, res) => {
    const realm = getOrCreateRealm(req.params.realm);
    const organization = realm.organizations.get(req.params.organizationId);
    if (!organization?.members.has(req.params.memberId)) {
      return res.status(404).json({ error: "not a member" });
    }
    res.json({ id: req.params.memberId });
  });

  app.delete("/admin/realms/:realm/organizations/:organizationId/members/:memberId", (req, res) => {
    const realm = getOrCreateRealm(req.params.realm);
    const organization = realm.organizations.get(req.params.organizationId);
    if (!organization?.members.delete(req.params.memberId)) return res.status(404).end();
    res.status(204).end();
  });

  app.get("/admin/realms/:realm/organizations/:organizationId/members", (req, res) => {
    const realm = getOrCreateRealm(req.params.realm);
    const organization = realm.organizations.get(req.params.organizationId);
    if (!organization) return res.status(404).json({ error: "not found" });
    const first = Number(req.query.first || 0);
    const max = Number(req.query.max || 100);
    res.json([...organization.members].slice(first, first + max).map((id) => ({ id })));
  });

  app.get("/admin/realms/:realm/organizations/:organizationId/groups", (req, res) => {
    const realm = getOrCreateRealm(req.params.realm);
    const organization = realm.organizations.get(req.params.organizationId);
    if (!organization) return res.status(404).json({ error: "not found" });
    const search = String(req.query.search || "");
    res.json(Array.from(organization.groups.values()).filter(
      (group) => !search || group.name === search,
    ));
  });

  app.post("/admin/realms/:realm/organizations/:organizationId/groups", (req, res) => {
    const realm = getOrCreateRealm(req.params.realm);
    const organization = realm.organizations.get(req.params.organizationId);
    if (!organization) return res.status(404).json({ error: "not found" });
    const existing = Array.from(organization.groups.values()).find(
      (group) => group.name === req.body.name,
    );
    if (existing) return res.status(409).end();
    const id = crypto.randomUUID();
    organization.groups.set(id, { id, name: req.body.name });
    res.status(201).set(
      "Location",
      `/admin/realms/${req.params.realm}/organizations/${req.params.organizationId}/groups/${id}`,
    ).end();
  });

  app.put(
    "/admin/realms/:realm/organizations/:organizationId/groups/:groupId/members/:userId",
    (req, res) => {
      const realm = getOrCreateRealm(req.params.realm);
      const organization = realm.organizations.get(req.params.organizationId);
      if (!organization) return res.status(404).json({ error: "not found" });
      if (!organization.members.has(req.params.userId)) {
        return res.status(400).json({ error: "not an organization member" });
      }
      const members = organization.groupMembers.get(req.params.groupId) || new Set();
      members.add(req.params.userId);
      organization.groupMembers.set(req.params.groupId, members);
      res.status(204).end();
    },
  );

  app.get(
    "/admin/realms/:realm/organizations/:organizationId/groups/:groupId/members",
    (req, res) => {
      const realm = getOrCreateRealm(req.params.realm);
      const organization = realm.organizations.get(req.params.organizationId);
      if (!organization) return res.status(404).json({ error: "not found" });
      const first = Number(req.query.first || 0);
      const max = Number(req.query.max || 100);
      const members = [...(organization.groupMembers.get(req.params.groupId) || new Set())];
      res.json(members.slice(first, first + max).map((id) => ({ id })));
    },
  );

  app.get("/admin/realms/:realm/clients", (req, res) => {
    const realm = getOrCreateRealm(req.params.realm);
    const clientId = String(req.query.clientId || "");
    const client = realm.clients.get(clientId);
    res.json(client ? [client] : []);
  });

  app.get("/admin/realms/:realm/identity-provider/instances", (_req, res) => {
    res.json([
      { alias: "google", displayName: "Google", enabled: true },
      { alias: "disabled-provider", enabled: false },
    ]);
  });

  app.get("/admin/realms/:realm/clients/:clientUuid/roles/:roleName", (req, res) => {
    const realm = getOrCreateRealm(req.params.realm);
    const client = Array.from(realm.clients.values()).find(
      (candidate) => candidate.id === req.params.clientUuid,
    );
    const role = client?.roles.find((candidate) => candidate.name === req.params.roleName);
    return role ? res.json(role) : res.status(404).json({ error: "not found" });
  });

  const roleMappingPath =
    "/admin/realms/:realm/organizations/:organizationId/groups/:groupId" +
    "/role-mappings/clients/:clientUuid";
  app.get(roleMappingPath, (req, res) => {
    const realm = getOrCreateRealm(req.params.realm);
    const organization = realm.organizations.get(req.params.organizationId);
    if (!organization) return res.status(404).json({ error: "not found" });
    res.json(organization.groupClientRoles.get(
      `${req.params.groupId}:${req.params.clientUuid}`,
    ) || []);
  });
  app.post(roleMappingPath, (req, res) => {
    const realm = getOrCreateRealm(req.params.realm);
    const organization = realm.organizations.get(req.params.organizationId);
    if (!organization) return res.status(404).json({ error: "not found" });
    const key = `${req.params.groupId}:${req.params.clientUuid}`;
    const current = organization.groupClientRoles.get(key) || [];
    for (const role of req.body) {
      if (!current.some((candidate) => candidate.id === role.id)) current.push(role);
    }
    organization.groupClientRoles.set(key, current);
    res.status(204).end();
  });
  app.delete(roleMappingPath, (req, res) => {
    const realm = getOrCreateRealm(req.params.realm);
    const organization = realm.organizations.get(req.params.organizationId);
    if (!organization) return res.status(404).json({ error: "not found" });
    const key = `${req.params.groupId}:${req.params.clientUuid}`;
    const remove = new Set(req.body.map((role: { id: string }) => role.id));
    organization.groupClientRoles.set(
      key,
      (organization.groupClientRoles.get(key) || []).filter(
        (role) => !remove.has(role.id),
      ),
    );
    res.status(204).end();
  });

  return { app };
}
