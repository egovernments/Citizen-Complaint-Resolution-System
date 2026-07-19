// Tenant bootstrap — register a brand-new state root so the wizard's Phase 2-4
// writes (which target the new tenant) can find the schemas + role records they need.
//
// Mirrors DIGIT-MCP's `tenant_bootstrap` tool (src/tools/mdms-tenant.ts:837). Runs
// inline in the SPA for now; a follow-up can refactor to call MCP over HTTP once
// MCP is part of personal-install's compose.
//
// Two tenants in play, never three:
//   - operator (auth identity from session token — typically ADMIN@pg with SUPERUSER)
//   - target (the new state root being bootstrapped — derived from the wizard's new tenant code)
//
// The ~14 essential data schemas + role registrations are required because:
//   - egov-user validates assigned role codes against ACCESSCONTROL-ROLES.roles at the
//     user's tenant before creating an employee (INVALID_ROLE otherwise).
//   - egov-mdms-v2 rejects every _create with SCHEMA_DEFINITION_NOT_FOUND_ERR if the
//     target tenant has no schema definitions of its own (no parent fallback on _create).
//   - inbox + PGR's @PostConstruct init reads DataSecurity.* policies at startup; missing
//     records crash the services. Bootstrap seeds them so wizard Phase 3-4 writes proceed.

import { apiClient } from '../client';
import { ENDPOINTS } from '../config';
import { DEFAULT_PASSWORD } from '../config';

interface SchemaDefinition {
  code: string;
  description?: string;
  definition: Record<string, unknown>;
  isActive?: boolean;
}

interface MdmsRecordRaw {
  tenantId: string;
  schemaCode: string;
  uniqueIdentifier: string;
  data: Record<string, unknown>;
  isActive?: boolean;
}

export interface BootstrapResult {
  schemas: { copied: string[]; skipped: string[]; failed: string[] };
  data: { copied: string[]; skipped: string[]; failed: string[] };
  admin: { created: boolean; tenantId: string } | null;
  workflow: { copied: string[]; failed: string[] };
  localization: { success: number; failed: number };
}

export interface BootstrapProgress {
  step: 'schemas' | 'self-record' | 'data' | 'admin' | 'workflow' | 'localization';
  current: number;
  total: number;
  detail?: string;
}

// Schemas whose data the wizard needs at the new tenant root for Phase 2-4 to work.
// Order matters: ACCESSCONTROL-ROLES.roles must be in place before any user create.
// DataSecurity.* must be in place before inbox/PGR/user services accept writes targeting
// the new tenant (their @PostConstruct init evaluates these).
const ESSENTIAL_DATA_SCHEMAS = [
  'ACCESSCONTROL-ROLES.roles',
  'ACCESSCONTROL-ACTIONS-TEST.actions-test',
  'ACCESSCONTROL-ROLEACTIONS.roleactions',
  'common-masters.IdFormat',
  'common-masters.Department',
  'DataSecurity.DecryptionABAC',
  'DataSecurity.EncryptionPolicy',
  'DataSecurity.SecurityPolicy',
  'DataSecurity.MaskingPatterns',
  'common-masters.Designation',
  'common-masters.StateInfo',
  'common-masters.GenderType',
  'common-masters.ThemeConfig',
  'egov-hrms.EmployeeStatus',
  'egov-hrms.EmployeeType',
  'egov-hrms.DeactivationReason',
  'Workflow.BusinessService',
  'INBOX.InboxQueryConfiguration',
];

// Roles the new state's ADMIN user needs. INTERNAL_MICROSERVICE_ROLE is non-negotiable —
// inbox crashes at startup if no user has it on the state tenant.
const ADMIN_ROLES = [
  { code: 'EMPLOYEE', name: 'Employee' },
  { code: 'CITIZEN', name: 'Citizen' },
  { code: 'CSR', name: 'CSR' },
  { code: 'GRO', name: 'Grievance Routing Officer' },
  { code: 'PGR_LME', name: 'PGR Last Mile Employee' },
  { code: 'DGRO', name: 'Department GRO' },
  { code: 'SUPERUSER', name: 'Super User' },
  { code: 'INTERNAL_MICROSERVICE_ROLE', name: 'Internal Microservice Role' },
];

const isDuplicateError = (msg: string): boolean =>
  /duplicate|already exists|unique|NON_UNIQUE/i.test(msg);

// --- Step 0: detection ---------------------------------------------------

/** True iff the state root has zero schemas registered. If so, wizard must bootstrap.
 *  Transport errors propagate — "no response from MDMS" is not the same signal as
 *  "MDMS confirmed zero schemas". Swallowing the former would trigger 100+ failing
 *  bootstrap calls against a service that's already unreachable and surface the
 *  wrong error to the user. */
export async function stateNeedsBootstrap(stateRoot: string): Promise<boolean> {
  const response = await apiClient.post(ENDPOINTS.MDMS_SCHEMA_SEARCH, {
    RequestInfo: apiClient.buildRequestInfo(),
    SchemaDefCriteria: { tenantId: stateRoot, limit: 1 },
  });
  const schemas = (response.SchemaDefinitions || []) as SchemaDefinition[];
  return schemas.length === 0;
}

// --- Step 1: schema clone ------------------------------------------------

async function searchSchemas(tenantId: string): Promise<SchemaDefinition[]> {
  const response = await apiClient.post(ENDPOINTS.MDMS_SCHEMA_SEARCH, {
    RequestInfo: apiClient.buildRequestInfo(),
    SchemaDefCriteria: { tenantId, limit: 500 },
  });
  return (response.SchemaDefinitions || []) as SchemaDefinition[];
}

async function createSchema(tenantId: string, schema: SchemaDefinition): Promise<void> {
  await apiClient.post(ENDPOINTS.MDMS_SCHEMA_CREATE, {
    RequestInfo: apiClient.buildRequestInfo(),
    SchemaDefinition: {
      tenantId,
      code: schema.code,
      description: schema.description || schema.code,
      definition: schema.definition,
      isActive: true,
    },
  });
}

// --- Step 3: essential data copy ----------------------------------------

async function searchData(tenantId: string, schemaCode: string): Promise<MdmsRecordRaw[]> {
  const response = await apiClient.post(ENDPOINTS.MDMS_SEARCH, {
    RequestInfo: apiClient.buildRequestInfo(),
    MdmsCriteria: { tenantId, schemaCode, limit: 500 },
  });
  return (response.mdms || []) as MdmsRecordRaw[];
}

async function createData(record: MdmsRecordRaw): Promise<void> {
  await apiClient.post(`${ENDPOINTS.MDMS_CREATE}/${record.schemaCode}`, {
    RequestInfo: apiClient.buildRequestInfo(),
    Mdms: {
      tenantId: record.tenantId,
      schemaCode: record.schemaCode,
      uniqueIdentifier: record.uniqueIdentifier,
      data: record.data,
      isActive: true,
    },
  });
}

// --- Step 3.5: register the tenant with egov-enc-service -----------------

// egov-enc-service discovers tenants via an MDMS search scoped to its own
// STATE_LEVEL_TENANT_ID env var — a brand-new state root is invisible to it
// until this is called, so provisionAdmin()'s _createnovalidate (which
// encrypts the user's PII) would otherwise fail with "Tenant Id not found"
// even though every step above succeeded. Idempotent (created:false when a
// key already exists). Non-fatal: swallow failures here and let Step 4
// surface the real error if enc-service is genuinely unreachable.
async function registerEncKey(target: string): Promise<void> {
  try {
    await apiClient.post(ENDPOINTS.ENC_GENERATE_KEY, {
      RequestInfo: apiClient.buildRequestInfo(),
      tenantId: target,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[bootstrap] enc-service key generation for ${target} failed: ${msg}`);
  }
}

// --- Step 4: ADMIN user at new tenant -----------------------------------

async function provisionAdmin(target: string): Promise<{ uuid: string } | null> {
  // userName uniqueness is per-tenant; the same "ADMIN" name can coexist across tenants.
  const payload = {
    RequestInfo: apiClient.buildRequestInfo(),
    user: {
      name: 'Admin',
      userName: 'ADMIN',
      password: DEFAULT_PASSWORD,
      mobileNumber: '9999999999',
      emailId: 'admin@digit.org',
      tenantId: target,
      type: 'EMPLOYEE',
      active: true,
      roles: ADMIN_ROLES.map((r) => ({ ...r, tenantId: target })),
    },
  };
  const response = await apiClient.post(ENDPOINTS.USER_CREATE, payload);
  const user = (response.user as Array<{ uuid: string }> | undefined)?.[0];
  return user ? { uuid: user.uuid } : null;
}

// --- Step 5: workflow PGR copy ------------------------------------------

interface WorkflowState {
  uuid?: string;
  state?: string;
  applicationStatus?: string;
  docUploadRequired?: boolean;
  isStartState?: boolean;
  isTerminateState?: boolean;
  isStateUpdatable?: boolean;
  actions?: WorkflowAction[];
}

interface WorkflowAction {
  uuid?: string;
  action?: string;
  nextState?: string; // UUID from source, must resolve to state code before re-send
  roles?: string[];
  active?: boolean;
}

interface WorkflowBusinessService {
  tenantId: string;
  businessService: string;
  business: string;
  businessServiceSla: number;
  states: WorkflowState[];
}

async function workflowCopyPGR(source: string, target: string): Promise<string[]> {
  // Most stacks register the PGR workflow at the state root, not at a city. naipepea
  // has it at `ke`; bomet has it at `pg` (the bomet state root in their config). Only
  // personal-install's default pg.citya/pg.cityb sample data registers at the city.
  // Try state-root first, fall back to <source>.citya for that one case.
  let response = await apiClient.post(
    `${ENDPOINTS.WORKFLOW_BS_SEARCH}?tenantId=${source}&businessServices=PGR`,
    { RequestInfo: apiClient.buildRequestInfo() }
  );
  let services = (response.BusinessServices || []) as WorkflowBusinessService[];
  if (services.length === 0) {
    response = await apiClient.post(
      `${ENDPOINTS.WORKFLOW_BS_SEARCH}?tenantId=${source}.citya&businessServices=PGR`,
      { RequestInfo: apiClient.buildRequestInfo() }
    );
    services = (response.BusinessServices || []) as WorkflowBusinessService[];
  }
  if (services.length === 0) return [];

  // Rebind each service to the target tenant. Critical detail: source states
  // reference each other via UUID in `actions[].nextState`. The new tenant's
  // states get fresh UUIDs on insert, so source UUID references would dangle
  // and the first state transition would crash with NPE on `getResultantState`.
  // Build a UUID→state-code map from source, then rewrite each action's
  // nextState as the state code (a name like "PENDINGFORASSIGNMENT"); the
  // workflow-v2 create resolves the code to the new UUID server-side.
  const cleaned = services.map((svc) => {
    const uuidToCode = new Map<string, string>();
    for (const s of svc.states) {
      if (s.uuid && s.state) uuidToCode.set(s.uuid, s.state);
    }
    const cleanStates: WorkflowState[] = svc.states.map((s) => ({
      state: s.state,
      applicationStatus: s.applicationStatus,
      docUploadRequired: s.docUploadRequired,
      isStartState: s.isStartState,
      isTerminateState: s.isTerminateState,
      isStateUpdatable: s.isStateUpdatable,
      actions: (s.actions || []).map((a) => ({
        action: a.action,
        nextState: a.nextState ? uuidToCode.get(a.nextState) ?? a.nextState : undefined,
        roles: a.roles,
        active: a.active,
      })),
    }));
    return {
      tenantId: target,
      businessService: svc.businessService,
      business: svc.business,
      businessServiceSla: svc.businessServiceSla,
      states: cleanStates,
    };
  });

  await apiClient.post(`${ENDPOINTS.WORKFLOW_BS_CREATE}?tenantId=${target}`, {
    RequestInfo: apiClient.buildRequestInfo(),
    BusinessServices: cleaned,
  });
  return cleaned.map((s) => s.businessService);
}

// --- Step 6: localization copy ------------------------------------------

// Modules the DIGIT-UI loads at tenant init. Missing entries show as raw keys
// in the complaint form, common UI labels, and employee screens.
const BASE_LOCALE_MODULES = [
  'rainmaker-common',
  'rainmaker-pgr',
  'digit-ui',
  'digit-tenants',
  'digit-privacy-policy',
  'rainmaker-common-masters',
];

export async function bootstrapLocalization(
  source: string,
  target: string,
  locale = 'en_IN'
): Promise<{ success: number; failed: number }> {
  let success = 0;
  let failed = 0;
  const BATCH = 500;

  for (const module of BASE_LOCALE_MODULES) {
    try {
      const qs = new URLSearchParams({ locale, tenantId: source, module });
      const response = await apiClient.post(
        `${ENDPOINTS.LOCALIZATION_SEARCH}?${qs.toString()}`,
        { RequestInfo: apiClient.buildRequestInfo() }
      );
      // Trim code/module and deduplicate by (code, module) — source data can
      // carry trailing-space twins (e.g. "TOTAL_CHALLANS" + "TOTAL_CHALLANS ")
      // that map to the same DB unique key after trimming. Sending both in one
      // batch causes the entire batch to fail on unique_message_entry.
      const seen = new Map<string, { code: string; message: string; module: string; locale: string }>();
      for (const m of (response.messages || []) as { code: string; message: string; module: string; locale: string }[]) {
        const code = m.code.trim();
        const mod = (m.module || '').trim();
        if (!code || code.startsWith('SERVICEDEFS')) continue;
        seen.set(`${mod}::${code}`, { ...m, code, module: mod });
      }
      const messages = Array.from(seen.values());
      if (messages.length === 0) continue;

      for (let i = 0; i < messages.length; i += BATCH) {
        const batch = messages.slice(i, i + BATCH);
        try {
          await apiClient.post(ENDPOINTS.LOCALIZATION_UPSERT, {
            RequestInfo: apiClient.buildRequestInfo({ apiId: 'emp', action: 'create' }),
            tenantId: target,
            locale,
            messages: batch.map((m) => ({
              code: m.code,
              message: m.message,
              module: m.module,
              locale: m.locale || locale,
            })),
          });
          success += batch.length;
        } catch {
          failed += batch.length;
        }
      }
    } catch {
      failed++;
    }
  }
  return { success, failed };
}

// --- Top-level orchestration --------------------------------------------

export async function bootstrapStateRoot(
  target: string,
  options: { source?: string; onProgress?: (p: BootstrapProgress) => void } = {}
): Promise<BootstrapResult> {
  const source = options.source || 'pg';
  const onProgress = options.onProgress || (() => undefined);

  const result: BootstrapResult = {
    schemas: { copied: [], skipped: [], failed: [] },
    data: { copied: [], skipped: [], failed: [] },
    admin: null,
    workflow: { copied: [], failed: [] },
    localization: { success: 0, failed: 0 },
  };

  // Step 0: register the target with egov-enc-service before anything below
  // needs to encrypt/decrypt for it (Step 4's ADMIN user creation, in particular).
  await registerEncKey(target);

  // Step 1: schemas
  const sourceSchemas = await searchSchemas(source);
  if (sourceSchemas.length === 0) {
    // Bootstrap from an empty source would silently succeed at the wizard level
    // (no errors per-schema because there are no schemas to copy) but leave the
    // target tenant with zero schemas — every subsequent Phase 3-4 write would
    // fail with SCHEMA_DEFINITION_NOT_FOUND_ERR, the same failure mode this
    // bootstrap exists to prevent. Fail fast with a message the operator can act on.
    throw new Error(
      `Bootstrap source tenant '${source}' has no schemas registered. ` +
      `Pick a tenant that has already been onboarded (one that has MDMS schemas ` +
      `registered) via the source option.`
    );
  }
  onProgress({ step: 'schemas', current: 0, total: sourceSchemas.length });
  for (let i = 0; i < sourceSchemas.length; i++) {
    const schema = sourceSchemas[i];
    try {
      await createSchema(target, schema);
      result.schemas.copied.push(schema.code);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isDuplicateError(msg)) result.schemas.skipped.push(schema.code);
      else result.schemas.failed.push(`${schema.code}: ${msg}`);
    }
    onProgress({ step: 'schemas', current: i + 1, total: sourceSchemas.length, detail: schema.code });
  }

  // Step 2: self-record (tenant.tenants/<target> at <target>)
  onProgress({ step: 'self-record', current: 0, total: 1 });
  try {
    await createData({
      tenantId: target,
      schemaCode: 'tenant.tenants',
      uniqueIdentifier: target,
      data: {
        code: target,
        name: target,
        description: `State tenant root: ${target}`,
        city: {
          code: target.toUpperCase(),
          name: target,
          districtCode: target.toUpperCase(),
          districtName: target,
        },
      },
    });
    result.data.copied.push(`tenant.tenants/${target} (self-record)`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (isDuplicateError(msg)) result.data.skipped.push(`tenant.tenants/${target}`);
    else result.data.failed.push(`tenant.tenants/${target}: ${msg}`);
  }
  onProgress({ step: 'self-record', current: 1, total: 1 });

  // Step 3: essential data
  onProgress({ step: 'data', current: 0, total: ESSENTIAL_DATA_SCHEMAS.length });
  for (let i = 0; i < ESSENTIAL_DATA_SCHEMAS.length; i++) {
    const schemaCode = ESSENTIAL_DATA_SCHEMAS[i];
    try {
      const records = await searchData(source, schemaCode);
      for (const record of records) {
        try {
          await createData({ ...record, tenantId: target });
          result.data.copied.push(`${schemaCode}/${record.uniqueIdentifier}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (isDuplicateError(msg)) result.data.skipped.push(`${schemaCode}/${record.uniqueIdentifier}`);
          else result.data.failed.push(`${schemaCode}/${record.uniqueIdentifier}: ${msg}`);
        }
      }
    } catch (err) {
      // Schema absent at source — non-fatal
      result.data.skipped.push(`${schemaCode} (not at source)`);
    }
    onProgress({ step: 'data', current: i + 1, total: ESSENTIAL_DATA_SCHEMAS.length, detail: schemaCode });
  }

  // Step 4: ADMIN user
  onProgress({ step: 'admin', current: 0, total: 1 });
  try {
    result.admin = await provisionAdmin(target).then((u) =>
      u ? { created: true, tenantId: target } : null
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!isDuplicateError(msg)) {
      console.warn(`[bootstrap] ADMIN provision at ${target} failed: ${msg}`);
    }
  }
  onProgress({ step: 'admin', current: 1, total: 1 });

  // Step 5: workflow PGR copy
  onProgress({ step: 'workflow', current: 0, total: 1 });
  try {
    const copied = await workflowCopyPGR(source, target);
    result.workflow.copied = copied;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!isDuplicateError(msg)) result.workflow.failed.push(`PGR: ${msg}`);
  }
  onProgress({ step: 'workflow', current: 1, total: 1 });

  return result;
}
