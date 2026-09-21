import { createHash, randomUUID } from "node:crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

interface Role { code: string; name?: string; tenantId: string }
interface Account {
  id: number;
  uuid: string;
  userName: string;
  name: string;
  mobileNumber: string | null;
  countryCode?: string | null;
  emailId: string | null;
  tenantId: string;
  type: string;
  active: boolean;
  identificationMark: string | null;
  roles: Role[];
  passwordHash: string;
}

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const POLICY = /^(?=.*\d)(?=.*[a-z])(?=.*[A-Z])(?=.*[@#$%])\S{8,15}$/;

/**
 * Stateful stand-in for egov-user's user-service contract plus MDMS tenant
 * search. Stores only password hashes, like egov-user, and records every
 * plaintext it received so tests can prove none leaked into BFF storage.
 */
export function createFakeDigitUser(options: { tenants: string[]; validateRoles?: boolean }) {
  const app = express();
  app.use(express.json());
  const accounts = new Map<string, Account>();
  const tokens = new Map<string, { uuid: string; expiresAt: number }>();
  const stats = { adminLogins: 0, userLogins: 0, creates: 0, updates: 0, passwordUpdates: 0, logouts: 0 };
  const receivedPasswords: string[] = [];
  const bootstrapSchemaCodes = [
    "tenant.tenants", "tenant.OnboardingConfig", "ACCESSCONTROL-ROLES.roles",
    "ACCESSCONTROL-ACTIONS-TEST.actions-test", "ACCESSCONTROL-ROLEACTIONS.roleactions",
    "common-masters.IdFormat", "common-masters.Department", "DataSecurity.DecryptionABAC",
    "DataSecurity.EncryptionPolicy", "DataSecurity.SecurityPolicy", "DataSecurity.MaskingPatterns",
    "common-masters.Designation", "common-masters.StateInfo", "common-masters.GenderType",
    "common-masters.ThemeConfig", "egov-hrms.EmployeeStatus", "egov-hrms.EmployeeType",
    "egov-hrms.DeactivationReason", "Workflow.BusinessService", "INBOX.InboxQueryConfiguration",
    "dss.DashboardConfig",
  ];
  const schemas = new Map<string, Map<string, any>>([
    ["pg", new Map(bootstrapSchemaCodes.map((code) => [code, {
      tenantId: "pg", code, description: code, definition: { type: "object", additionalProperties: true }, isActive: true,
    }]))],
  ]);
  const mdms = new Map<string, any[]>();
  const mdmsKey = (tenantId: string, schemaCode: string) => `${tenantId}|${schemaCode}`;
  mdms.set(mdmsKey("pg", "common-masters.StateInfo"), [{
    tenantId: "pg", schemaCode: "common-masters.StateInfo", uniqueIdentifier: "state-info",
    data: { code: "PG", name: "Bootstrap", languages: [{ label: "ENGLISH", value: "en_IN" }] }, isActive: true,
  }]);
  const bootstrapRoles = [
    "EMPLOYEE", "GRO", "PGR_VIEWER", "ACCOUNT_ADMIN", "MDMS_ADMIN", "LOC_ADMIN", "SUPERUSER",
  ];
  mdms.set(mdmsKey("pg", "ACCESSCONTROL-ROLES.roles"), bootstrapRoles.map((code) => ({
    tenantId: "pg", schemaCode: "ACCESSCONTROL-ROLES.roles", uniqueIdentifier: `role-${code}`,
    data: { code, name: code, description: `${code} role` }, isActive: true,
  })));
  const workflows = new Map<string, any[]>([["pg", [{
    tenantId: "pg", businessService: "PGR", business: "pgr", businessServiceSla: 1,
    states: [{ uuid: "start", state: "PENDING", isStartState: true, actions: [] }],
  }]]]);
  let nextId = 1;
  let tokenTtlSeconds = 604800;

  function addAccount(input: Omit<Account, "id" | "uuid" | "passwordHash"> & { password: string }) {
    const { password, ...fields } = input;
    const account: Account = { ...fields, id: nextId++, uuid: randomUUID(), passwordHash: hash(password) };
    accounts.set(account.uuid, account);
    return account;
  }
  const publicAccount = ({ passwordHash: _hash, ...account }: Account) => account;
  const bearer = (req: express.Request) => {
    const token = req.body?.RequestInfo?.authToken as string | undefined;
    const entry = token ? tokens.get(token) : undefined;
    return entry && entry.expiresAt > Date.now() ? accounts.get(entry.uuid) : undefined;
  };
  const requireAdmin = (req: express.Request, res: express.Response) => {
    const caller = bearer(req);
    if (!caller) { res.status(401).json({ error: "invalid token" }); return null; }
    if (!caller.roles.some((role) => role.code === "ACCOUNT_ADMIN")) {
      res.status(403).json({ error: "forbidden" }); return null;
    }
    return caller;
  };

  app.post("/user/oauth/token", express.urlencoded({ extended: false }), (req, res) => {
    const account = [...accounts.values()].find((candidate) =>
      candidate.userName === req.body.username && candidate.tenantId === req.body.tenantId &&
      candidate.type === req.body.userType);
    if (!account || !account.active || account.passwordHash !== hash(String(req.body.password))) {
      return res.status(400).json({ error: "invalid_request", error_description: "Invalid login credentials" });
    }
    if (account.roles.some((role) => role.code === "ACCOUNT_ADMIN")) stats.adminLogins += 1;
    else stats.userLogins += 1;
    const existing = [...tokens.entries()].find(([, entry]) =>
      entry.uuid === account.uuid && entry.expiresAt > Date.now());
    const token = existing?.[0] || randomUUID();
    const expiresAt = existing?.[1].expiresAt || Date.now() + tokenTtlSeconds * 1000;
    tokens.set(token, { uuid: account.uuid, expiresAt });
    return res.json({
      access_token: token,
      token_type: "bearer",
      refresh_token: randomUUID(),
      expires_in: Math.floor((expiresAt - Date.now()) / 1000),
      // Deliberately noisy: the BFF must not pass unexpected fields through.
      UserRequest: { ...publicAccount(account), password: "must-not-leak" },
    });
  });

  app.post("/user/_search", (req, res) => {
    if (!requireAdmin(req, res)) return;
    const matches = [...accounts.values()].filter((account) =>
      account.userName === req.body.userName && account.tenantId === req.body.tenantId &&
      account.type === req.body.userType && account.active === (req.body.active !== false));
    return res.json({ user: matches.map(publicAccount) });
  });

  app.post("/user/users/_createnovalidate", (req, res) => {
    if (!requireAdmin(req, res)) return;
    const user = req.body.user;
    if (!POLICY.test(user.password || "") || !user.mobileNumber || !user.roles?.length) {
      return res.status(400).json({ error: "invalid user" });
    }
    if (options.validateRoles) {
      const validRoles = new Set((mdms.get(mdmsKey(user.tenantId, "ACCESSCONTROL-ROLES.roles")) || [])
        .filter((record) => record.isActive !== false)
        .map((record) => record.data?.code));
      if (user.roles.some((role: Role) => role.tenantId !== user.tenantId || !validRoles.has(role.code))) {
        return res.status(400).json({ error: "INVALID_ROLE" });
      }
    }
    if ([...accounts.values()].some((account) => account.userName === user.userName && account.tenantId === user.tenantId)) {
      return res.status(400).json({ error: "duplicate" });
    }
    receivedPasswords.push(user.password);
    stats.creates += 1;
    const account = addAccount({ ...user, password: user.password });
    return res.json({ user: [publicAccount(account)] });
  });

  app.post("/user/users/_updatenovalidate", (req, res) => {
    if (!requireAdmin(req, res)) return;
    const user = req.body.user;
    const account = accounts.get(user.uuid);
    if (!account) return res.status(400).json({ error: "not found" });
    if (!user.roles?.length) return res.status(400).json({ error: "roles required" });
    if (user.password) {
      if (!POLICY.test(user.password)) return res.status(400).json({ error: "INVALID_PWD_PATTERN" });
      receivedPasswords.push(user.password);
      account.passwordHash = hash(user.password);
      stats.passwordUpdates += 1;
    }
    stats.updates += 1;
    Object.assign(account, {
      name: user.name, mobileNumber: user.mobileNumber ?? account.mobileNumber, emailId: user.emailId,
      countryCode: user.countryCode ?? account.countryCode,
      active: user.active ?? account.active, identificationMark: user.identificationMark, roles: user.roles,
    });
    return res.json({ user: [publicAccount(account)] });
  });

  app.post("/user/_logout", (req, res) => {
    // Mirrors egov-user's TokenWrapper body plus Kong's RequestInfo authorization.
    const token = req.body?.access_token;
    if (!token || req.body?.RequestInfo?.authToken !== token) return res.status(400).json({ error: "Logout failed" });
    if (!tokens.delete(token)) return res.status(401).json({ error: "invalid token" });
    stats.logouts += 1;
    return res.json({ status: "ok" });
  });

  app.post("/mdms-v2/schema/v1/_search", (req, res) => {
    const tenantId = req.body?.SchemaDefCriteria?.tenantId;
    return res.json({ SchemaDefinitions: [...(schemas.get(tenantId)?.values() || [])] });
  });

  app.post("/mdms-v2/schema/v1/_create", (req, res) => {
    const caller = bearer(req);
    if (!caller) return res.status(401).json({ error: "invalid token" });
    const value = req.body?.SchemaDefinition;
    if (!value?.tenantId || !value?.code) return res.status(400).json({ error: "invalid schema" });
    const tenantSchemas = schemas.get(value.tenantId) || new Map();
    if (tenantSchemas.has(value.code)) return res.status(409).json({ error: "duplicate" });
    tenantSchemas.set(value.code, value);
    schemas.set(value.tenantId, tenantSchemas);
    return res.json({ SchemaDefinitions: [value] });
  });

  app.post("/mdms-v2/v2/_create/:schemaCode", (req, res) => {
    const caller = bearer(req);
    if (!caller) return res.status(401).json({ error: "invalid token" });
    if (!caller.roles.some((role) => role.code === "MDMS_ADMIN")) return res.status(403).json({ error: "forbidden" });
    const value = req.body?.Mdms;
    if (!value?.tenantId || value.schemaCode !== req.params.schemaCode || !value.uniqueIdentifier) {
      return res.status(400).json({ error: "invalid record" });
    }
    const key = mdmsKey(value.tenantId, value.schemaCode);
    const values = mdms.get(key) || [];
    if (values.some((record) => record.uniqueIdentifier === value.uniqueIdentifier)) {
      return res.status(400).json({ error: "DUPLICATE_RECORD" });
    }
    values.push(value);
    mdms.set(key, values);
    if (value.schemaCode === "tenant.tenants") {
      const code = value.data?.code;
      if (!code || !value.data?.name || value.tenantId !== code) return res.status(400).json({ error: "invalid root" });
      if (!options.tenants.includes(code)) options.tenants.push(code);
    }
    return res.json({ mdms: [value] });
  });

  const encKeys = new Set<string>();
  app.post("/egov-enc-service/crypto/v1/_generatekey", (req, res) => {
    const tenantId = req.body?.tenantId;
    if (!tenantId) return res.status(400).json({ error: "tenantId" });
    const created = !encKeys.has(tenantId);
    encKeys.add(tenantId);
    return res.json({ tenantId, created, keyId: 1 });
  });

  app.post("/mdms-v2/v1/_search", (req, res) => {
    const root = req.body?.MdmsCriteria?.tenantId;
    const schemaCode = req.body?.MdmsCriteria?.schemaCode;
    if (schemaCode) return res.json({ mdms: mdms.get(mdmsKey(root, schemaCode)) || [] });
    return res.json({ MdmsRes: { tenant: { tenants: options.tenants
      .filter((tenant) => tenant.split(".")[0] === root).map((code) => ({ code })) } } });
  });

  app.post("/mdms-v2/v2/_search", (req, res) => {
    const tenantId = req.body?.MdmsCriteria?.tenantId;
    const schemaCode = req.body?.MdmsCriteria?.schemaCode;
    return res.json({ mdms: mdms.get(mdmsKey(tenantId, schemaCode)) || [] });
  });

  app.post("/egov-workflow-v2/egov-wf/businessservice/_search", (req, res) => {
    return res.json({ BusinessServices: workflows.get(String(req.query.tenantId)) || [] });
  });
  app.post("/egov-workflow-v2/egov-wf/businessservice/_create", (req, res) => {
    const target = String(req.query.tenantId);
    workflows.set(target, req.body?.BusinessServices || []);
    return res.json({ BusinessServices: workflows.get(target) });
  });
  app.post("/localization/messages/v1/_search", (req, res) => {
    const module = String(req.query.module);
    return res.json({ messages: [{ code: `${module.toUpperCase()}_LABEL`, message: module, module, locale: req.query.locale }] });
  });
  app.post("/localization/messages/v1/_upsert", (req, res) => res.json({ messages: req.body?.messages || [] }));

  let server: Server;
  return {
    accounts, tokens, stats, receivedPasswords, addAccount, encKeys, schemas, mdms, workflows,
    setTokenTtlSeconds(seconds: number) { tokenTtlSeconds = seconds; },
    expireAllTokens() { for (const entry of tokens.values()) entry.expiresAt = Date.now() - 1; },
    async start(): Promise<string> {
      server = app.listen(0);
      await new Promise((resolve) => server.once("listening", resolve));
      return `http://localhost:${(server.address() as AddressInfo).port}`;
    },
    async stop() { await new Promise((resolve) => server.close(resolve)); },
  };
}
