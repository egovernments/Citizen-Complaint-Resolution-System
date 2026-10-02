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
/**
 * egov-user's `UserUtils.getStateLevelTenantForCitizen`: a CITIZEN on a dotted
 * tenant is searched, logged in, uniqueness-checked AND stored (in
 * `UserRepository.create`) at the first dotted segment. Other types keep the
 * tenant they are given. Explicit role tenantIds are kept as sent.
 */
const citizenTenant = (tenantId: string, userType: unknown) =>
  userType === "CITIZEN" && typeof tenantId === "string" && tenantId.includes(".")
    ? tenantId.split(".")[0]
    : tenantId;
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
  const stats = {
    adminLogins: 0, userLogins: 0, creates: 0, updates: 0, passwordUpdates: 0, logouts: 0,
    otpCreates: 0, citizenOtpLogins: 0, internalLogins: 0, localizationSearches: 0,
  };
  // egov-user can mask PII in search responses; tests turn this on to prove
  // callers never depend on the searched mobileNumber.
  let maskSearchMobileNumbers = false;
  /** Role codes that account writes reject as undefined at the tenant. */
  const undefinedRoles = new Set<string>();
  /** egov-otp store: `${identity}|${tenantId}` -> live one-time codes. */
  const otps = new Map<string, Set<string>>();
  /** egov-localization rows. */
  const localization: Array<{ tenantId: string; locale: string; module: string; code: string; message: string }> = [];
  const receivedPasswords: string[] = [];
  const bootstrapSchemaCodes = [
    "tenant.tenants", "tenant.OnboardingConfig", "ACCESSCONTROL-ROLES.roles",
    "ACCESSCONTROL-ACTIONS-TEST.actions-test", "ACCESSCONTROL-ROLEACTIONS.roleactions",
    "common-masters.IdFormat", "common-masters.Department", "DataSecurity.DecryptionABAC",
    "DataSecurity.EncryptionPolicy", "DataSecurity.SecurityPolicy", "DataSecurity.MaskingPatterns",
    "common-masters.Designation", "common-masters.StateInfo", "common-masters.GenderType",
    "common-masters.MobileNumberValidation",
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

  // egov-otp internal create: the response carries the code (no SMS here).
  app.post("/otp/v1/_create", (req, res) => {
    const identity = req.body?.otp?.identity;
    const tenantId = req.body?.otp?.tenantId;
    if (typeof identity !== "string" || typeof tenantId !== "string") {
      return res.status(400).json({ error: "identity and tenantId are required" });
    }
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const key = `${identity}|${tenantId}`;
    otps.set(key, new Set([...(otps.get(key) || []), otp]));
    stats.otpCreates += 1;
    return res.json({ otp: { otp, UUID: randomUUID(), identity, tenantId, isValidationSuccessful: false } });
  });

  app.post("/user/oauth/token", express.urlencoded({ extended: false }), (req, res) => {
    // isInternal skips credential validation in egov-user; the BFF must never send it.
    if (req.body.isInternal !== undefined) stats.internalLogins += 1;
    const tenantId = citizenTenant(req.body.tenantId, req.body.userType);
    const account = [...accounts.values()].find((candidate) =>
      candidate.userName === req.body.username && candidate.tenantId === tenantId &&
      candidate.type === req.body.userType);
    // Mirrors egov-user with citizen.login.password.otp.enabled=true: a
    // CITIZEN password is validated (and consumed) as an egov-otp code for
    // the account's mobileNumber at its tenant (UserService.validateOtp uses
    // user.getMobileNumber() and user.getTenantId()), never its stored hash.
    const citizenOtps = account?.type === "CITIZEN"
      ? otps.get(`${account.mobileNumber}|${account.tenantId}`)
      : undefined;
    const credentialValid = account?.type === "CITIZEN"
      ? Boolean(citizenOtps?.delete(String(req.body.password)))
      : account?.passwordHash === hash(String(req.body.password));
    if (!account || !account.active || !credentialValid) {
      return res.status(400).json({ error: "invalid_request", error_description: "Invalid login credentials" });
    }
    if (account.type === "CITIZEN") stats.citizenOtpLogins += 1;
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
    const tenantId = citizenTenant(req.body.tenantId, req.body.userType);
    const matches = [...accounts.values()].filter((account) =>
      account.userName === req.body.userName && account.tenantId === tenantId &&
      account.type === req.body.userType && account.active === (req.body.active !== false));
    return res.json({ user: matches.map(publicAccount).map((user) => maskSearchMobileNumbers && user.mobileNumber
      ? { ...user, mobileNumber: `******${user.mobileNumber.slice(-4)}` }
      : user) });
  });

  app.post("/user/users/_createnovalidate", (req, res) => {
    if (!requireAdmin(req, res)) return;
    const user = req.body.user;
    if (!POLICY.test(user.password || "") || !user.mobileNumber || !user.roles?.length) {
      return res.status(400).json({ error: "invalid user" });
    }
    // egov-user's answer to a role that is not defined at the tenant.
    if (user.roles.some((role: Role) => undefinedRoles.has(role.code))) {
      return res.status(400).json({ Errors: [{ code: "INVALID_ROLE", message: "Unable to validate role from MDMS" }] });
    }
    if (options.validateRoles) {
      const validRoles = new Set((mdms.get(mdmsKey(user.tenantId, "ACCESSCONTROL-ROLES.roles")) || [])
        .filter((record) => record.isActive !== false)
        .map((record) => record.data?.code));
      if (user.roles.some((role: Role) => role.tenantId !== user.tenantId || !validRoles.has(role.code))) {
        return res.status(400).json({ Errors: [{ code: "INVALID_ROLE", message: "Unable to validate role from MDMS" }] });
      }
      const mobileRule = (mdms.get(mdmsKey(user.tenantId, "common-masters.MobileNumberValidation")) || [])
        .find((record) => record.isActive !== false && record.data?.default === true)?.data;
      if (!mobileRule?.mobileNumberRegex || mobileRule.countryCode !== user.countryCode ||
          !new RegExp(mobileRule.mobileNumberRegex).test(user.mobileNumber)) {
        return res.status(400).json({ error: "INVALID_MOBILE_NUMBER" });
      }
    }
    const tenantId = citizenTenant(user.tenantId, user.type);
    if ([...accounts.values()].some((account) => account.userName === user.userName &&
        account.tenantId === tenantId && account.type === user.type)) {
      return res.status(400).json({ error: "duplicate" });
    }
    receivedPasswords.push(user.password);
    stats.creates += 1;
    const account = addAccount({ ...user, tenantId, password: user.password });
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
    const moduleDetails = req.body?.MdmsCriteria?.moduleDetails as Array<{
      moduleName: string; masterDetails: Array<{ name: string }>;
    }> | undefined;
    if (moduleDetails?.some((module) => module.moduleName !== "tenant")) {
      // v1 compatibility shape over the v2 store: exact tenant, no inheritance.
      const MdmsRes: Record<string, Record<string, unknown[]>> = {};
      for (const module of moduleDetails) {
        MdmsRes[module.moduleName] = Object.fromEntries(module.masterDetails.map((master) => [
          master.name,
          (mdms.get(mdmsKey(root, `${module.moduleName}.${master.name}`)) || [])
            .filter((record) => record.isActive !== false)
            .map((record) => record.data),
        ]));
      }
      return res.json({ MdmsRes });
    }
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
    stats.localizationSearches += 1;
    const modules = new Set(String(req.query.module || "").split(",").filter(Boolean));
    return res.json({ messages: localization.filter((row) =>
      row.tenantId === req.query.tenantId && row.locale === req.query.locale && modules.has(row.module)) });
  });
  app.post("/localization/messages/v1/_upsert", (req, res) => res.json({ messages: req.body?.messages || [] }));

  let server: Server;
  return {
    accounts, tokens, stats, receivedPasswords, addAccount, encKeys, schemas, mdms, workflows,
    otps, localization, mdmsKey,
    setTokenTtlSeconds(seconds: number) { tokenTtlSeconds = seconds; },
    setMaskSearchMobileNumbers(mask: boolean) { maskSearchMobileNumbers = mask; },
    setUndefinedRoles(codes: string[]) { undefinedRoles.clear(); codes.forEach((code) => undefinedRoles.add(code)); },
    expireAllTokens() { for (const entry of tokens.values()) entry.expiresAt = Date.now() - 1; },
    async start(): Promise<string> {
      server = app.listen(0);
      await new Promise((resolve) => server.once("listening", resolve));
      return `http://localhost:${(server.address() as AddressInfo).port}`;
    },
    async stop() { await new Promise((resolve) => server.close(resolve)); },
  };
}
