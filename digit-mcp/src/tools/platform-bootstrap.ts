import { randomUUID } from 'node:crypto';
import { digitApi } from '../services/digit-api.js';
import { digitDb } from '../services/digit-db.js';
import { adminRoleCodes, checkToolAccess } from '../services/auth.js';
import { loadPlatformSeed, substituteTenant } from './platform-baseline.js';
import { DASHBOARD_L10N_PACKS } from './dashboard-l10n-seed.js';

/** PGR operating roles the deploy administrator held before the seed existed (#2269 review item 2). */
export const DEPLOY_ADMIN_PGR_ROLES = ['CITIZEN', 'CSR', 'GRO', 'PGR_LME', 'DGRO'];

/** Reserved founder hierarchy; shared with PGR onboarding (OnboardingSteps.WORKSPACE_HIERARCHY). */
export const WORKSPACE_HIERARCHY = 'WORKSPACE';

/** A TenantBoundary wrapper is returned even without relationships; only the root node proves one. */
function hasWorkspaceRoot(trees: Record<string, unknown>[], tenant: string): boolean {
  return trees.some((tree) => {
    const type = tree.hierarchyType as unknown;
    const code = type && typeof type === 'object' ? (type as { code?: unknown }).code : type;
    if (code && code !== WORKSPACE_HIERARCHY) return false;
    const roots = Array.isArray(tree.boundary) ? tree.boundary : tree.boundary ? [tree.boundary] : [];
    return roots.some((root: any) => root?.code === tenant && root?.boundaryType === 'ROOT');
  });
}

/** Seeded by SQL before the first gateway write: accesscontrol authorizes writes from these rows (CCRS#1928). */
const ACCESS_FLOOR_SCHEMAS = ['ACCESSCONTROL-ACTIONS-TEST.actions-test', 'ACCESSCONTROL-ROLEACTIONS.roleactions'];

interface FloorDb {
  execute(sql: string, params?: unknown[]): Promise<number>;
}

interface BootstrapOptions {
  deriveMobile(regex: string, length: number, requested?: string): string;
  defaultPassword(): string;
  api?: typeof digitApi;
  fetcher?: typeof fetch;
  mdmsHost?: string;
  userHost?: string;
  direct?: boolean;
  stateTenant?: string;
  /** DIGIT database for the role-action floor; defaults to the shared egov pool. */
  db?: FloorDb;
}

/** Versioned platform bootstrap; workspace business masters are populated by workspace setup. */
export async function bootstrapPlatform(args: Record<string, unknown>, options: BootstrapOptions) {
  const api = options.api ?? digitApi;
  const auth = api.getAuthInfo();
  const denied = checkToolAccess('tenant_bootstrap', 'admin', auth.user);
  const roles = auth.user?.roles?.map((role) => role.code.toUpperCase()) ?? [];
  if (denied || !auth.authenticated || !roles.some((role) => adminRoleCodes().includes(role))) {
    throw new Error('tenant_bootstrap requires an authenticated platform administrator');
  }
  const target = String(args.target_tenant);
  const source = args.source_tenant ? String(args.source_tenant) : 'platform-baseline';
  const seed = loadPlatformSeed();
  const direct = options.direct ?? process.env.MCP_PLATFORM_BOOTSTRAP_DIRECT === 'true';
  const host = direct ? (options.mdmsHost ?? process.env.EGOV_MDMS_HOST ?? '').replace(/\/$/, '') : '';
  if (direct && !host) throw new Error('EGOV_MDMS_HOST is required for internal platform bootstrap');
  if (host && !/^https?:\/\/[^?#]+$/.test(host)) throw new Error('EGOV_MDMS_HOST must be a service URL');
  const fetcher = options.fetcher ?? fetch;
  let verifiedUser = auth.user;
  if (direct) {
    // These are server configuration, never the caller's configurable environment
    // or claimed userInfo. Verify with the trusted egov-user origin on every call.
    const userHost = (options.userHost ?? process.env.EGOV_USER_HOST ?? '').replace(/\/$/, '');
    if (!/^https?:\/\/[^?#]+$/.test(userHost)) throw new Error('EGOV_USER_HOST is required for direct platform bootstrap');
    if (!auth.token) throw new Error('Direct platform bootstrap requires a verified state administrator');
    const response = await fetcher(`${userHost}/user/_details?access_token=${encodeURIComponent(auth.token)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ RequestInfo: { authToken: auth.token } }), signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error('Direct platform bootstrap requires a verified state administrator');
    const details = await response.json();
    verifiedUser = details.UserRequest ?? details;
    const stateTenant = options.stateTenant ?? process.env.CRS_STATE_TENANT ?? 'pg';
    if (!verifiedUser?.uuid || (verifiedUser as any).active === false || !verifiedUser.roles?.some(role =>
      ['SUPERUSER', 'MDMS_ADMIN'].includes(role.code) && role.tenantId === stateTenant)) {
      throw new Error('Direct platform bootstrap requires a verified state administrator');
    }
  }
  const results = {
    schemas: { copied: [] as string[], skipped: [] as string[], failed: [] as string[] },
    data: { copied: [] as string[], skipped: [] as string[], failed: [] as string[] },
    workflow: { created: [] as string[], skipped: [] as string[], failed: [] as string[] },
    warnings: [] as string[],
  };
  for (const input of ['pincode_allowlist', 'dashboard_roles']) {
    if (Object.prototype.hasOwnProperty.call(args, input)) {
      results.warnings.push(`${input} is a legacy input and is ignored by platform bootstrap; configure it in the workspace.`);
    }
  }
  async function post(path: string, body: Record<string, unknown>): Promise<Record<string, any>> {
    if (!direct) {
      // Default transport retains normal Kong authorization and endpoint mapping.
      const b = body as Record<string, any>;
      if (path.endsWith('/schema/v1/_search')) return { SchemaDefinitions: await api.mdmsSchemaSearch(target, b.SchemaDefCriteria.codes) };
      if (path.endsWith('/schema/v1/_create')) return { SchemaDefinition: await api.mdmsSchemaCreate(target, b.SchemaDefinition.code, b.SchemaDefinition.description, b.SchemaDefinition.definition) };
      if (path.endsWith('/v2/_search')) return { mdms: await api.mdmsV2SearchRaw(b.MdmsCriteria.tenantId, b.MdmsCriteria.schemaCode, b.MdmsCriteria) };
      if (path.includes('/v2/_create/')) return { mdms: [await api.mdmsV2Create(b.Mdms.tenantId, b.Mdms.schemaCode, b.Mdms.uniqueIdentifier, b.Mdms.data)] };
      if (path.includes('/v2/_update/')) return { mdms: [await api.mdmsV2UpdateData(b.Mdms, b.Mdms.data)] };
      throw new Error('Unsupported platform MDMS operation');
    }
    const response = await fetcher(`${host}${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, RequestInfo: { apiId: 'digit-mcp-bootstrap', ts: Date.now(), authToken: auth.token, userInfo: verifiedUser } }), signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`Platform MDMS returned HTTP ${response.status}`);
    return await response.json() as Record<string, any>;
  }
  type Row = { tenantId?: string; schemaCode?: string; uniqueIdentifier?: string; data: Record<string, unknown>; isActive?: boolean };
  async function records(code: string, id?: string, tenant = target) {
    const response = await post('/egov-mdms-service/v2/_search', {
      MdmsCriteria: { tenantId: tenant, schemaCode: code, ...(id && { uniqueIdentifiers: [id] }), limit: 1000 },
    });
    if (!Array.isArray(response.mdms)) throw new Error('Invalid MDMS response');
    return response.mdms as Row[];
  }
  /** Create-if-absent. `match` finds an existing row by content where the server derives the uid. */
  async function record(code: string, id: string, data: Record<string, unknown>, tenant = target, match?: (row: Row) => boolean) {
    const find = async () => match ? (await records(code, undefined, tenant)).filter(match) : await records(code, id, tenant);
    const existing = await find();
    if (existing.length) {
      if (existing[0].isActive === false) throw new Error(`Inactive platform record ${code}/${id}`);
      results.data.skipped.push(`${code}/${id}`); return;
    }
    await post(`/egov-mdms-service/v2/_create/${code}`, {
      Mdms: { tenantId: tenant, schemaCode: code, uniqueIdentifier: id, isActive: true, data },
    });
    // A successful write is not proof that the asynchronous MDMS projection is visible.
    await visible(async () => (await find()).length > 0);
    results.data.copied.push(`${code}/${id}`);
  }
  async function visible(probe: () => Promise<boolean>) {
    for (let attempt = 0; attempt < 20; attempt++) {
      if (await probe()) return;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error('Accepted platform record is not visible yet; retry bootstrap');
  }
  const cityRoot = target.includes('.') ? target.split('.')[0] : undefined;
  async function registerCityModules() {
    // digit-ui reads tenant.citymodule at the root, so the city joins each root module's
    // tenants[]. mdms-v2 has no array append: read, modify, write; idempotent.
    for (const row of await records('tenant.citymodule', undefined, cityRoot)) {
      if (row.isActive === false || (row.tenantId && row.tenantId !== cityRoot)) continue;
      const tenants = Array.isArray(row.data.tenants) ? row.data.tenants as { code?: string }[] : [];
      if (tenants.some((entry) => entry?.code === target)) { results.data.skipped.push(`tenant.citymodule/${row.uniqueIdentifier} (${target})`); continue; }
      await post(`/egov-mdms-service/v2/_update/tenant.citymodule`, { Mdms: { ...row, data: { ...row.data, tenants: [...tenants, { code: target }] } } });
      await visible(async () => (await records('tenant.citymodule', row.uniqueIdentifier, cityRoot))
        .some((r) => (r.data.tenants as { code?: string }[] | undefined)?.some((entry) => entry?.code === target)));
      results.data.copied.push(`tenant.citymodule/${row.uniqueIdentifier} (${target})`);
    }
  }
  const localizations: { locale: string; copied: number; failed: number }[] = [];
  async function copyLocalizations() {
    // Copies the source tenant's message packs as tenant_bootstrap did before the seed (#2269
    // review item 1b): locales from the source StateInfo, messages from the source and its root,
    // the dashboard packs as a floor. Whole modules are written before the tenant-name key, since
    // egov-localization stops falling back once a tenant holds any message for a module (#2257).
    if (!args.source_tenant) return; // nextSteps says how to get them
    const sources = [...new Set([source, source.split('.')[0]])];
    const stateInfo = await api.mdmsV2SearchRaw(source, 'common-masters.StateInfo', { limit: 5 }).catch(() => []);
    const languages = ((stateInfo[0]?.data as { languages?: { value?: unknown }[] } | undefined)?.languages ?? [])
      .map((language) => language?.value).filter((value): value is string => typeof value === 'string' && value.length > 0);
    const segment = target.split('.').pop()!;
    const tenantName = { code: `TENANT_TENANTS_${target.toUpperCase().replace(/\./g, '_')}`,
      message: segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase(), module: 'rainmaker-common' };
    for (const locale of [...new Set(['en_IN', ...languages])]) {
      const messages = new Map<string, { code: string; message: string; module: string }>();
      for (const tenant of sources) {
        for (const m of await api.localizationSearch(tenant, locale).catch(() => [] as Record<string, unknown>[])) {
          const code = typeof m.code === 'string' ? m.code.trim() : '';
          const module = typeof m.module === 'string' ? m.module.trim() : 'rainmaker-common';
          // Complaint types are workspace-owned and seeded with them, as ComplaintHierarchy is.
          if (!code || code.startsWith('SERVICEDEFS') || typeof m.message !== 'string') continue;
          if (!messages.has(`${module}::${code}`)) messages.set(`${module}::${code}`, { code, message: m.message, module });
        }
      }
      for (const m of DASHBOARD_L10N_PACKS[locale] ?? []) if (!messages.has(`${m.module}::${m.code}`)) messages.set(`${m.module}::${m.code}`, m);
      if (!messages.size) continue;
      const result = { locale, copied: 0, failed: 0 };
      const batch = [...messages.values()];
      let nameModuleFailed = 0;
      for (let offset = 0; offset < batch.length; offset += 500) {
        const chunk = batch.slice(offset, offset + 500);
        try { await api.localizationUpsert(target, locale, chunk); result.copied += chunk.length; continue; } catch { /* isolate the bad row */ }
        for (const m of chunk) {
          try { await api.localizationUpsert(target, locale, [m]); result.copied++; } catch (error) {
            if (/duplicate|already exists|unique/i.test(error instanceof Error ? error.message : String(error))) result.copied++;
            else { result.failed++; if (m.module === tenantName.module) nameModuleFailed++; }
          }
        }
      }
      // As PGR onboarding (OnboardingSteps.seedsTenantNameModule): a tenant gets its name key only in a
      // locale where it holds the whole rainmaker-common module. A lone key would stop egov-localization
      // falling back for that module, and the tenant would lose every other common label (#2257).
      // The target qualifies when the module was copied in full; the city's root when it holds the
      // module already. The tenant name is branding an operator may have changed: never overwritten.
      const copiedNameModule = nameModuleFailed === 0 && batch.some((m) => m.module === tenantName.module && m.code !== tenantName.code);
      for (const tenant of cityRoot ? [target, cityRoot] : [target]) {
        try {
          if (tenant === target && !copiedNameModule) continue;
          const held = await api.localizationSearch(tenant, locale, tenantName.module);
          if (tenant !== target && !held.some((m) => !String(m.code).startsWith('TENANT_TENANTS_'))) continue;
          if (!held.some((m) => m.code === tenantName.code)) await api.localizationUpsert(tenant, locale, [tenantName]);
        } catch { result.failed++; }
      }
      localizations.push(result);
    }
    // Drop egov-localization's cached (empty) packs; the next UI load reads the database.
    await api.localizationCacheBust().catch(() => results.warnings.push('Localization cache bust failed; packs appear after the cache expires.'));
  }
  let rules = args.user_validation as Record<string, unknown>[] | undefined;
  if (!rules) {
    // The seed is the default source; reading a live tenant's rule is an explicit source_tenant opt-in.
    // Empty strings are absent: Ansible renders an unset countryCode as "" (#2269 review item 3).
    const prefix = (args.mobile_prefix || args.mobile_zone || undefined) as string | undefined;
    const regex = (args.mobile_regex || undefined) as string | undefined;
    const current = args.source_tenant
      ? (await api.mdmsV2SearchRaw(source, 'common-masters.MobileNumberValidation', { limit: 100 }))
        .find((row) => row.isActive !== false && row.data?.default === true)?.data
      : args.country ? seed.countryMobileRules[String(args.country).toUpperCase()]
        : Object.values(seed.countryMobileRules).find((rule) => rule.countryCode === prefix);
    if (!current && !regex) throw new Error('Country mobile rule is missing');
    // An explicit regex without a prefix takes the prefix of the rule it belongs to: the named country's,
    // the source tenant's when the regex is the source's own, else the seeded country with that regex.
    // Never a default: +91 beside another country's regex breaks every number (#2269 round-3 item 6).
    const regexCountry = Object.values(seed.countryMobileRules).find((rule) => rule.mobileNumberRegex === regex);
    const countryCode = prefix
      || (!regex || args.country || regex === current?.mobileNumberRegex ? current?.countryCode : regexCountry?.countryCode);
    if (!countryCode) {
      throw new Error(`mobile_regex ${regex} matches no seeded country (${Object.keys(seed.countryMobileRules).join(', ')}): `
        + 'pass mobile_prefix (the dialling code, e.g. +254) or country');
    }
    rules = [{ countryCode, mobileNumberRegex: regex || current?.mobileNumberRegex, default: true }];
  }
  if (!Array.isArray(rules) || !rules.length || rules.some((rule) => typeof rule.countryCode !== 'string' || typeof rule.mobileNumberRegex !== 'string')) {
    throw new Error('Invalid country mobile rules');
  }
  let accessFloorSeeded = 0;
  async function accessFloor() {
    // Gateway writes are authorized by egov-accesscontrol from the target's own role-action rows.
    // A brand-new tenant has none, and the only way to grant one is an MDMS write that itself
    // needs a grant, so the seed's actions and role-actions are inserted directly first (CCRS#1928).
    // Runs every time, so a tenant holding only part of the set (an older bootstrap copied 500 of
    // 945) is topped up. Additive: a row is skipped when the tenant already has it, by
    // uniqueidentifier or by content (action id; role code + action id), since rows from
    // full-dump.sql or an older copy carry other uniqueidentifiers. Non-fatal: if the database
    // is unreachable, the first gateway write fails with the real 403 instead.
    const db = options.db ?? digitDb;
    try {
      if (!options.db) await digitDb.initialize();
      const now = Date.now();
      for (const record of seed.records.filter((r) => ACCESS_FLOOR_SCHEMAS.includes(r.schemaCode))) {
        accessFloorSeeded += await db.execute(
          `INSERT INTO eg_mdms_data (id, tenantid, uniqueidentifier, schemacode, data, isactive, createdby, lastmodifiedby, createdtime, lastmodifiedtime)
           SELECT $1::text, $2::text, $3::text, $4::text, $5::jsonb, true, 'system-mdms-seed-rbac-floor', 'system-mdms-seed-rbac-floor', $6::bigint, $6::bigint
           WHERE NOT EXISTS (SELECT 1 FROM eg_mdms_data held WHERE held.tenantid = $2 AND held.schemacode = $4
             AND CASE WHEN $4 = 'ACCESSCONTROL-ROLEACTIONS.roleactions'
               THEN held.data->>'rolecode' = $5::jsonb->>'rolecode' AND held.data->>'actionid' = $5::jsonb->>'actionid'
               ELSE held.data->>'id' = $5::jsonb->>'id' END)
           ON CONFLICT (tenantid, schemacode, uniqueidentifier) DO NOTHING`,
          [randomUUID(), target, record.uniqueIdentifier, record.schemaCode, JSON.stringify(substituteTenant(record.data, target)), now]);
      }
    } catch (error) {
      results.warnings.push(`Role-action floor was not seeded for ${target} (CCRS#1928): ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (!args.user_only) {
    // Direct mode writes to MDMS without the gateway, so it needs no floor.
    if (!direct) await accessFloor();
    for (const schema of seed.schemas) {
      const criteria = { SchemaDefCriteria: { tenantId: target, codes: [schema.code] } };
      const exists = async () => {
        const response = await post('/egov-mdms-service/schema/v1/_search', criteria);
        if (!Array.isArray(response.SchemaDefinitions)) throw new Error('Invalid schema search response');
        return response.SchemaDefinitions.length > 0;
      };
      if (await exists()) { results.schemas.skipped.push(schema.code); continue; }
      await post('/egov-mdms-service/schema/v1/_create', { SchemaDefinition: { ...schema, tenantId: target, description: schema.code, isActive: true } });
      await visible(exists); results.schemas.copied.push(schema.code);
    }
    const tenantRecord = { code: target, name: target, type: 'CITY', domainUrl: '', imageId: null,
      emailId: '', address: '', contactNumber: '', OfficeTimings: { 'Mon - Fri': '' },
      city: { code: target, name: target, districtName: '', districtTenantCode: target, ulbGrade: '' } };
    if (cityRoot) {
      // A city's record lives in its root's tenant list as Tenant.<city>, where digit-ui,
      // idgen and the escalation scheduler list cities (#2269 review item 1c).
      await record('tenant.tenants', `Tenant.${target}`, { ...tenantRecord, parent: cityRoot }, cityRoot,
        (row) => row.data?.code === target && (!row.tenantId || row.tenantId === cityRoot));
    } else {
      await record('tenant.tenants', target, tenantRecord);
    }
    for (const row of seed.records) await record(row.schemaCode, row.uniqueIdentifier, substituteTenant(row.data, target));
    if (cityRoot) await registerCityModules();
    for (const rule of rules) await record('common-masters.MobileNumberValidation', String(rule.countryCode), rule);
    // The seed carries no PG- complaint-ID prefix; derive it from the target (idgen reads only [..] tokens).
    await record('common-masters.IdFormat', 'pgr.servicerequestid', { idname: 'pgr.servicerequestid',
      format: `${target.toUpperCase().replace(/[^A-Z0-9-]/g, '-')}-PGR-[cy:yyyy-MM-dd]-[SEQ_EG_PGR_ID]` });
    // The PGR business service from the same seed PGR onboarding uses; without it no complaint
    // can be created on a fresh non-pg tenant (#2269 review item 1a).
    for (const definition of seed.workflow ?? []) {
      const code = String(definition.businessService);
      try {
        // workflow-v2 caches searches in-JVM, so an accepted create is the checkpoint: re-searching
        // before its persister lands would pin an empty result (as in OnboardingSteps).
        if ((await api.workflowBusinessServiceSearch(target, [code])).length) { results.workflow.skipped.push(code); continue; }
        await api.workflowBusinessServiceCreate(target, substituteTenant(definition, target));
        results.workflow.created.push(code);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/duplicate|already exists/i.test(message)) results.workflow.skipped.push(code);
        else results.workflow.failed.push(`${code}: ${message}`);
      }
    }
    await copyLocalizations();
  }
  await api.generateEncKey(target);
  const username = auth.user?.userName || 'ADMIN';
  // The deploy administrator also files and routes complaints, as it did before the seed
  // existed; the seed's founder roles alone would leave it unable to run a PGR lifecycle.
  const employeeRoles = [...new Set([...seed.founderRoles, ...DEPLOY_ADMIN_PGR_ROLES])]
    .map((code) => ({ code, name: code, tenantId: target }));
  // egov-user's search returns only active users unless asked, so look for a deactivated ADMIN
  // too; otherwise the deploy would try to create it again and fail on the duplicate username.
  let existing = await api.userSearch(target, { userName: username, limit: 2 });
  if (!existing.length) existing = await api.userSearch(target, { userName: username, active: false, limit: 2 });
  if (existing.length > 1) throw new Error('Ambiguous bootstrap administrator');
  const adminMobile = () => options.deriveMobile(String(rules!.find((rule) => rule.default)?.mobileNumberRegex ?? rules![0].mobileNumberRegex),
    Number(args.mobile_length) || 10, args.admin_mobile as string | undefined);
  if (existing[0]) {
    // Additive only: roles granted elsewhere (other tenants, operators) are never removed (#2269 review item 2).
    const held = (existing[0].roles ?? []) as { code: string; tenantId?: string }[];
    const missing = employeeRoles.filter((role) => !held.some((r) => r.code === role.code && r.tenantId === role.tenantId));
    if (args.user_only) {
      // Re-provisioning re-encrypts mobile/password under the now-active state key and is the
      // recovery path after credential drift, so it also clears a lockout from failed logins
      // (44650d3b2). `active` is left as it is: an operator may have deactivated this ADMIN on
      // purpose, and a deploy must not bring it back (#2269 round-3 item 7).
      await api.userUpdate({ ...existing[0], mobileNumber: adminMobile(), password: api.getLoginPassword() || options.defaultPassword(),
        accountLocked: false, roles: [...held, ...missing] });
    } else if (missing.length) {
      await api.userUpdate({ ...existing[0], roles: [...held, ...missing] });
    }
  } else {
    await api.userCreate({ name: auth.user?.name || 'Administrator', mobileNumber: adminMobile(), userName: username,
      password: api.getLoginPassword() || options.defaultPassword(), type: 'EMPLOYEE', active: true, roles: employeeRoles, tenantId: target }, target);
  }
  let employeeProvisioned = false;
  if (!args.user_only) {
    // Founder jurisdiction lives in the reserved WORKSPACE hierarchy, as in PGR onboarding
    // (OnboardingSteps.WORKSPACE_HIERARCHY). A one-level ADMIN/ROOT could never grow levels and
    // blocked the operational ADMIN hierarchy (#2260, #2269 review item 4).
    if (!(await api.boundaryHierarchySearch(target, WORKSPACE_HIERARCHY)).some((h) => h.hierarchyType === WORKSPACE_HIERARCHY)) {
      await api.boundaryHierarchyCreate(target, WORKSPACE_HIERARCHY, [{ boundaryType: 'ROOT', parentBoundaryType: null, active: true }]);
    }
    if (!(await api.boundarySearch(target, undefined, { codes: [target] })).some((b) => b.code === target)) {
      await api.boundaryCreate(target, [{ code: target }]);
    }
    if (!hasWorkspaceRoot(await api.boundaryRelationshipTreeSearch(target, WORKSPACE_HIERARCHY), target)) {
      await api.boundaryRelationshipCreate(target, target, WORKSPACE_HIERARCHY, 'ROOT', null);
    }
    const employees = await api.employeeSearch(target, { codes: [username], limit: 2 });
    if (employees.length > 1) throw new Error('Ambiguous bootstrap employee');
    if (!employees.length) {
      let users = await api.userSearch(target, { userName: username, limit: 2 });
      if (!users.length) users = await api.userSearch(target, { userName: username, active: false, limit: 2 });
      if (users.length !== 1 || !users[0].uuid) throw new Error('Bootstrap user is not visible yet; retry bootstrap');
      const now = Date.now();
      await api.employeeCreate(target, [{ tenantId: target, code: username, employeeType: 'PERMANENT', employeeStatus: 'EMPLOYED',
        dateOfAppointment: now, isActive: true, user: users[0], assignments: [{ department: 'ONBOARDING_ADMIN', designation: 'ONBOARDING_FOUNDER', fromDate: now, isCurrentAssignment: true }],
        jurisdictions: [{ tenantId: target, hierarchy: WORKSPACE_HIERARCHY, boundaryType: 'ROOT', boundary: target, roles: employeeRoles }] }]);
    }
    employeeProvisioned = true;
  }
  return {
    success: results.workflow.failed.length === 0 && localizations.every((l) => l.failed === 0), source, target, seedVersion: seed.version, ...(args.user_only === true ? { user_only: true, admin_user_provisioned: true } : {}),
    summary: { schemas_copied: results.schemas.copied.length, schemas_skipped: results.schemas.skipped.length, schemas_failed: 0,
      data_copied: results.data.copied.length, data_skipped: results.data.skipped.length, data_failed: 0,
      workflows_created: results.workflow.created.length, workflows_skipped: results.workflow.skipped.length, workflows_failed: results.workflow.failed.length, localizations_copied: localizations.reduce((n, l) => n + l.copied, 0),
      localizations_failed: localizations.reduce((n, l) => n + l.failed, 0), locales_seen: localizations.length, admin_user_provisioned: true, admin_employee_provisioned: employeeProvisioned, access_floor_seeded: accessFloorSeeded, warnings: results.warnings.length },
    adminUser: { provisioned: true, username, tenantId: target, roles: employeeRoles.map((role) => role.code) },
    adminEmployee: { provisioned: employeeProvisioned, code: username, department: 'ONBOARDING_ADMIN', designation: 'ONBOARDING_FOUNDER' },
    localizations, results, nextSteps: ['Configure workspace branding, geography, departments, employees and complaint types.',
      ...(!args.user_only && !args.source_tenant ? ['Localizations were not copied: re-run with source_tenant to copy its message packs.'] : [])],
  };
}
