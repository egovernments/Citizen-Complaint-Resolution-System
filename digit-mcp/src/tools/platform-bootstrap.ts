import { digitApi } from '../services/digit-api.js';
import { adminRoleCodes, checkToolAccess } from '../services/auth.js';
import { loadPlatformSeed, substituteTenant } from './platform-baseline.js';

interface BootstrapOptions {
  deriveMobile(regex: string, length: number, requested?: string): string;
  defaultPassword(): string;
  api?: typeof digitApi;
  fetcher?: typeof fetch;
  mdmsHost?: string;
  userHost?: string;
  direct?: boolean;
  stateTenant?: string;
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
  const source = String(args.source_tenant || api.getEnvironmentInfo().stateTenantId);
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
      if (path.endsWith('/v2/_search')) return { mdms: await api.mdmsV2SearchRaw(target, b.MdmsCriteria.schemaCode, b.MdmsCriteria) };
      if (path.includes('/v2/_create/')) return { mdms: [await api.mdmsV2Create(target, b.Mdms.schemaCode, b.Mdms.uniqueIdentifier, b.Mdms.data)] };
      throw new Error('Unsupported platform MDMS operation');
    }
    const response = await fetcher(`${host}${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, RequestInfo: { apiId: 'digit-mcp-bootstrap', ts: Date.now(), authToken: auth.token, userInfo: verifiedUser } }), signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`Platform MDMS returned HTTP ${response.status}`);
    return await response.json() as Record<string, any>;
  }
  async function records(code: string, id?: string) {
    const response = await post('/egov-mdms-service/v2/_search', {
      MdmsCriteria: { tenantId: target, schemaCode: code, ...(id && { uniqueIdentifiers: [id] }), limit: 1000 },
    });
    if (!Array.isArray(response.mdms)) throw new Error('Invalid MDMS response');
    return response.mdms as { data: Record<string, unknown>; isActive?: boolean }[];
  }
  async function record(code: string, id: string, data: Record<string, unknown>) {
    const existing = await records(code, id);
    if (existing.length) {
      if (existing[0].isActive === false) throw new Error(`Inactive platform record ${code}/${id}`);
      results.data.skipped.push(`${code}/${id}`); return;
    }
    await post(`/egov-mdms-service/v2/_create/${code}`, {
      Mdms: { tenantId: target, schemaCode: code, uniqueIdentifier: id, isActive: true, data },
    });
    // A successful write is not proof that the asynchronous MDMS projection is visible.
    await visible(async () => (await records(code, id)).length > 0);
    results.data.copied.push(`${code}/${id}`);
  }
  async function visible(probe: () => Promise<boolean>) {
    for (let attempt = 0; attempt < 20; attempt++) {
      if (await probe()) return;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error('Accepted platform record is not visible yet; retry bootstrap');
  }
  let rules = args.user_validation as Record<string, unknown>[] | undefined;
  if (!rules) {
    const countryRules = await api.mdmsV2SearchRaw(source, 'common-masters.MobileNumberValidation', { limit: 100 });
    const current = countryRules.find((row) => row.isActive !== false && row.data?.default === true)?.data;
    if (!current && !args.mobile_regex) throw new Error('Country mobile rule is missing');
    const countryCode = args.mobile_prefix ?? args.mobile_zone ?? current?.countryCode;
    if (!countryCode) throw new Error('Country mobile prefix is missing');
    rules = [{ countryCode, mobileNumberRegex: args.mobile_regex ?? current?.mobileNumberRegex, default: true }];
  }
  if (!Array.isArray(rules) || !rules.length || rules.some((rule) => typeof rule.countryCode !== 'string' || typeof rule.mobileNumberRegex !== 'string')) {
    throw new Error('Invalid country mobile rules');
  }
  if (!args.user_only) {
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
    await record('tenant.tenants', target, { code: target, name: target, type: 'CITY', domainUrl: '', imageId: null,
      emailId: '', address: '', contactNumber: '', OfficeTimings: { 'Mon - Fri': '' },
      city: { code: target, name: target, districtName: '', districtTenantCode: target, ulbGrade: '' } });
    for (const row of seed.records) await record(row.schemaCode, row.uniqueIdentifier, substituteTenant(row.data, target));
    for (const rule of rules) await record('common-masters.MobileNumberValidation', String(rule.countryCode), rule);
  }
  await api.generateEncKey(target);
  const username = auth.user?.userName || 'ADMIN';
  const employeeRoles = seed.founderRoles.map((code) => ({ code, name: code, tenantId: target }));
  const existing = await api.userSearch(target, { userName: username, limit: 2 });
  if (existing.length > 1) throw new Error('Ambiguous bootstrap administrator');
  if (args.user_only || !existing.length) {
    const mobile = options.deriveMobile(String(rules.find((rule) => rule.default)?.mobileNumberRegex ?? rules[0].mobileNumberRegex), Number(args.mobile_length) || 10, args.admin_mobile as string | undefined);
    const user = { name: auth.user?.name || 'Administrator', mobileNumber: mobile, userName: username,
      password: api.getLoginPassword() || options.defaultPassword(), type: 'EMPLOYEE', active: true, roles: employeeRoles, tenantId: target };
    if (existing[0]) await api.userUpdate({ ...existing[0], ...user }); else await api.userCreate(user, target);
  }
  let employeeProvisioned = false;
  if (!args.user_only) {
    if (!(await api.boundaryHierarchySearch(target, 'ADMIN')).length) {
      await api.boundaryHierarchyCreate(target, 'ADMIN', [{ boundaryType: 'ROOT', parentBoundaryType: null, active: true }]);
    }
    if (!(await api.boundarySearch(target, 'ADMIN', { codes: [target] })).length) {
      await api.boundaryCreate(target, [{ code: target }]);
    }
    if (!(await api.boundaryRelationshipTreeSearch(target, 'ADMIN')).length) {
      await api.boundaryRelationshipCreate(target, target, 'ADMIN', 'ROOT', null);
    }
    const employees = await api.employeeSearch(target, { codes: [username], limit: 2 });
    if (employees.length > 1) throw new Error('Ambiguous bootstrap employee');
    if (!employees.length) {
      const users = await api.userSearch(target, { userName: username, limit: 2 });
      if (users.length !== 1 || !users[0].uuid) throw new Error('Bootstrap user is not visible yet; retry bootstrap');
      const now = Date.now();
      await api.employeeCreate(target, [{ tenantId: target, code: username, employeeType: 'PERMANENT', employeeStatus: 'EMPLOYED',
        dateOfAppointment: now, isActive: true, user: users[0], assignments: [{ department: 'ONBOARDING_ADMIN', designation: 'ONBOARDING_FOUNDER', fromDate: now, isCurrentAssignment: true }],
        jurisdictions: [{ tenantId: target, hierarchy: 'ADMIN', boundaryType: 'ROOT', boundary: target, roles: employeeRoles }] }]);
    }
    employeeProvisioned = true;
  }
  return {
    success: true, source, target, seedVersion: seed.version, ...(args.user_only === true ? { user_only: true, admin_user_provisioned: true } : {}),
    summary: { schemas_copied: results.schemas.copied.length, schemas_skipped: results.schemas.skipped.length, schemas_failed: 0,
      data_copied: results.data.copied.length, data_skipped: results.data.skipped.length, data_failed: 0,
      workflows_created: 0, workflows_skipped: 0, workflows_failed: 0, localizations_copied: 0, localizations_failed: 0,
      locales_seen: 0, admin_user_provisioned: true, admin_employee_provisioned: employeeProvisioned, warnings: results.warnings.length },
    adminUser: { provisioned: true, username, tenantId: target, roles: employeeRoles.map((role) => role.code) },
    adminEmployee: { provisioned: employeeProvisioned, code: username, department: 'ONBOARDING_ADMIN', designation: 'ONBOARDING_FOUNDER' },
    localizations: [], results, nextSteps: ['Configure workspace branding, geography, departments, employees and complaint types.'],
  };
}
