import { randomUUID } from 'node:crypto';
import { bootstrapPlatform } from './platform-bootstrap.js';
import type { ToolMetadata, MdmsRecord } from '../types/index.js';
import { MDMS_SCHEMAS } from '../types/index.js';
import type { ToolRegistry } from './registry.js';
import { isReadOnlyEffective } from './registry.js';
import { digitApi } from '../services/digit-api.js';
import { digitDb } from '../services/digit-db.js';
import { ensureAuthenticated, checkBaseUrlAllowed, getAuthMode, defaultProvisioningPassword } from '../services/auth.js';
import { emitProgress } from '../services/progress.js';
import { ENVIRONMENTS } from '../config/environments.js';
import { autoPaginate, PAGINATION_SCHEMA_PROPERTIES } from '../utils/pagination.js';
import type { PaginationOptions } from '../utils/pagination.js';
import { buildOrderedLevels } from './validators.js';
import { validateTenantId, validateResourceId } from '../utils/validation.js';
import { applyFieldMask } from '../utils/field-mask.js';
import { probeServices } from '../utils/probe.js';
import type { ProbeReport } from '../utils/probe.js';
import { loadFromXlsx } from '../utils/xlsx-loader.js';
import { DASHBOARD_L10N_PACKS } from './dashboard-l10n-seed.js';
import {
  DASHBOARD_CATALOG_SCHEMAS,
  DASHBOARD_KPI_DEFINITIONS,
  DASHBOARD_PACKS,
} from './dashboard-catalog-seed.js';
import {
  DASHBOARD_ACCESS_ACTIONS,
  PGR_SEARCH_SCOPE_RESOURCE,
  buildDashboardConfig,
  buildDashboardRoleAction,
  normalizeDashboardRoles,
} from './dashboard-bootstrap-seed.js';

/**
 * True for error messages that indicate a record already exists (duplicate / unique
 * key violation). Matters because tenant_bootstrap is idempotent — a re-run of
 * `mz` over an already-bootstrapped `mz` should count those records as `skipped`,
 * not `failed`.
 *
 * Subtle history: `msg.includes('DUPLICATE')` was the original check at 11 call
 * sites. mdms-v2 actually emits "Duplicate record" (capital D, two words) for the
 * tenant.tenants self-record, which slips past case-sensitive .includes — so a
 * second `./deploy.sh maputo` would surface "tenant.tenants/mz: Duplicate record"
 * as a real failure even though it was a benign re-run. One call site got fixed
 * inline with a regex; the others did not. This helper unifies all 11.
 *
 * Important non-match: "Unique attribute list cannot be empty" is a SCHEMA
 * VALIDATION error (the schema's x-unique is missing), NOT a duplicate. The
 * earlier inline regex's lone `unique` term caught that as a duplicate-skip,
 * silently swallowing a real schema bug (Workflow.BusinessServiceMasterConfig).
 * This helper is intentionally precise: only true duplicate signals match.
 */
export function isDuplicateError(msg: string): boolean {
  return /DUPLICATE|duplicate record|already exists|NON[_-]?UNIQUE|unique constraint|unique key|unique index/i.test(msg);
}

/**
 * Evict egov-user's Redis-backed ValidationRulesCache entry for a tenant.
 *
 * egov-user caches MobileNumberValidation rules in a Redis hash:
 *   key: validationRules   field: validation:<tenantId>
 *
 * The default-data-handler seeds the MobileNumberValidation record for the
 * target tenant at stack startup (before bootstrap). egov-user's first mz
 * request triggers a Cache MISS → reads from MDMS → caches in Redis with
 * TTL=3600s. MCP bootstrap then corrects MDMS to the country pattern but
 * Redis still holds the stale record. Evicting the key forces egov-user to
 * re-read from MDMS on the next _createnovalidate call and find the correct
 * pattern. Non-fatal — bootstrap continues if Redis is unreachable.
 */
async function evictValidationCache(tenantId: string): Promise<void> {
  const host = process.env.EGOV_REDIS_HOST || 'redis';
  const port = parseInt(process.env.EGOV_REDIS_PORT || '6379', 10);
  const field = `validation:${tenantId}`;
  const cmd = `*3\r\n$4\r\nHDEL\r\n$15\r\nvalidationRules\r\n$${field.length}\r\n${field}\r\n`;
  const { createConnection } = await import('net');
  return new Promise((resolve) => {
    const socket = createConnection(port, host);
    const done = () => { try { socket.destroy(); } catch { /* ignore */ } resolve(); };
    socket.once('connect', () => socket.write(cmd));
    socket.once('data', done);
    socket.once('error', done);
    setTimeout(done, 2000);
  });
}

/**
 * Derive a mobile number that satisfies the TARGET tenant's mobile rule.
 *
 * tenant_bootstrap copies an ADMIN from the source country, but that mobile
 * won't match a different target country's UserValidation pattern (e.g. India
 * `^[6-9][0-9]{9}$` vs Mozambique `^8[0-9]{8}$`). egov-user's _createnovalidate
 * enforces the pattern, so the copied/fallback `9999999999` is rejected and the
 * ADMIN row never gets created — login then fails. This generates a conforming
 * placeholder from the same `mobile_regex` the bootstrap already receives.
 *
 * Returns `preferred` if it already matches; else the first-valid-lead-digit +
 * a repeated tail padded to `length` that the regex accepts; else best-effort.
 */
/**
 * Rotate '0123456789' to start at seed's leading digit.
 *
 * Two calls deriving a fallback mobile for the same regex with different
 * `preferred` values (e.g. ADMIN's '8888888888' vs an HRMS employee's
 * '9999999999') should diverge instead of both walking the exhaustive lead x
 * fill sweep in the same 0..9 order and returning the same first match.
 * Seeding the order from `preferred` makes them diverge whenever the regex
 * admits more than one lead/fill combination at a given length; regexes with
 * a fixed multi-character literal prefix (e.g. `^77[0-9]{6}$`) admit exactly
 * one combination regardless of search order, so those still collide.
 */
function seededDigitOrder(seed?: string): string {
  const digits = '0123456789';
  if (!seed || !digits.includes(seed[0])) return digits;
  const i = digits.indexOf(seed[0]);
  return digits.slice(i) + digits.slice(0, i);
}

export function deriveValidMobile(regex: string, length: number, preferred?: string): string {
  let re: RegExp | null = null;
  try { re = new RegExp(regex); } catch { re = null; }
  const matches = (s?: string): s is string => !!s && (!re || re.test(s));
  const preferredFill = preferred ? preferred[preferred.length - 1] : undefined;
  if (matches(preferred)) return preferred;
  const n = length && length > 0 ? length : 10;
  // Try every lead digit x fill digit at length n (and n+1 / n-1, since
  // patterns like ^0?[17][0-9]{8}$ accept 9 OR 10 digits). Looping the lead
  // digit instead of parsing it handles optional prefixes like `0?` and
  // character classes uniformly.
  //
  // Search a wide window around n, closest lengths first, so a tenant whose
  // mobileNumberRegex requires a length far from the hinted default (e.g. 8
  // for `^77[0-9]{6}$`, vs the default n=10) still derives a match instead of
  // exhausting n-1/n/n+1 and falling through to an unmatched placeholder.
  const lengths = Array.from(new Set([...Array.from({ length: 10 }, (_, i) => i + 6), n, n + 1, n - 1]))
    .sort((a, b) => Math.abs(a - n) - Math.abs(b - n));

  // Within each length, try the caller's own fill digit first (e.g. '9' for
  // '9999999999', '8' for '8888888888') before the rest of digitOrder, so
  // several distinct users on the same target tenant (ADMIN, HRMS employee,
  // ...) with different `preferred` values diverge instead of both landing
  // on the same lead x fill candidate. This must stay a single pass over
  // `lengths` — trying preferredFill across *every* length before the
  // fallback fill sweep gets a turn would let a farther length "win" over a
  // closer one that only works with a different fill, breaking the
  // closest-length-first guarantee documented above.
  const digitOrder = seededDigitOrder(preferred);
  const fills = [...(preferredFill ? [preferredFill] : []), ...digitOrder.split('').filter((d) => d !== preferredFill)];

  for (const len of lengths) {
    if (len <= 0) continue;
    for (const f of fills) {
      for (const d of digitOrder) {
        const cand = d + f.repeat(len - 1);
        if (cand.length === len && matches(cand)) return cand;
      }
    }
  }
  return preferred || '9'.repeat(n);
}

/**
 * Normalize the tenant_bootstrap `pincode_allowlist` arg into the shape
 * mdms-v2 accepts on tenant.tenants. The schema declares pincode items
 * as Number, so numeric strings must be coerced or the update is
 * rejected with "expected type: Number, found: String". Leading zeros
 * still match in the UI: its serviceability gate strips them from both
 * sides before comparing. Non-numeric entries pass through unchanged
 * for deployments with alphanumeric-postcode schemas. Returns null
 * (meaning "don't touch pincode at all") for non-arrays and for lists
 * that are empty after trimming — mdms-v2 also rejects pincode: [],
 * so absence is the only valid off state.
 */
export function normalizePincodeAllowlist(input: unknown): Array<string | number> | null {
  if (!Array.isArray(input)) return null;
  const cleaned = (input as unknown[])
    .map((p) => String(p).trim())
    .filter((p) => p.length > 0)
    .map((p) => (/^[0-9]+$/.test(p) ? Number(p) : p));
  return cleaned.length > 0 ? cleaned : null;
}

/** Minimal shape of an mdms-v2 record this module needs to read a master's code + name. */
interface MasterRowLike {
  uniqueIdentifier?: string;
  data?: Record<string, unknown>;
}

/**
 * #1590: derive `COMMON_MASTERS_DEPARTMENT_<CODE>` / `COMMON_MASTERS_DESIGNATION_<CODE>`
 * messages from the department/designation MASTERS a bootstrap just copied.
 *
 * tenant_bootstrap's localization step can only carry a message that already
 * exists on some source tenant, while the MDMS data copy carries the masters
 * unconditionally. A master the source dump never localized therefore lands on
 * the target with no message and renders as its raw code — the canned
 * `pg.citya` / `india.citya` `PMC_*` departments are the live example, and the
 * dashboard's department tiles show `PMC_ELEC` because the dimensionLabel
 * contract deliberately has no humaniser
 * (digit-ui-esbuild/products/dashboard/src/i18n/dimensionLabel.js).
 *
 * The message text is the master's own `name` — DATA-OWNED text an operator
 * authored, which is exactly what that contract sanctions as fallback. A
 * master with no `name` yields nothing: the gap stays visible rather than
 * being papered over with a label invented from the code.
 *
 * Callers apply this as a FLOOR (a real copied message always wins) and for
 * the primary locale only — writing an English master name into a pt_PT pack
 * would hide a genuine translation gap.
 */
export function deriveMasterLocalizations(
  departments: MasterRowLike[],
  designations: MasterRowLike[],
): { code: string; message: string; module: string }[] {
  const out: { code: string; message: string; module: string }[] = [];
  const seen = new Set<string>();
  const derive = (rows: MasterRowLike[], prefix: string) => {
    for (const row of rows || []) {
      const data = row?.data || {};
      // Both fields are typed loosely enough to arrive non-string from a
      // hand-edited or dump-imported record. Guard before trim(): a throw
      // here escapes into the caller's catch and drops the WHOLE derived
      // floor, not just the malformed row.
      const identifier = typeof row?.uniqueIdentifier === 'string' ? row.uniqueIdentifier.trim() : '';
      const dataCode = typeof data.code === 'string' ? data.code.trim() : '';
      const code = identifier || dataCode;
      const name = typeof data.name === 'string' ? data.name.trim() : '';
      if (!code || !name) continue;
      const key = `${prefix}${code}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ code: key, message: name, module: 'rainmaker-common' });
    }
  };
  derive(departments, 'COMMON_MASTERS_DEPARTMENT_');
  derive(designations, 'COMMON_MASTERS_DESIGNATION_');
  return out;
}

/**
 * Schemas where copying ZERO records from the source is a defect, not a no-op.
 *
 * The bootstrap copy is silent about an empty source: no records to iterate
 * means nothing lands in `copied`, `skipped` OR `failed`, so the run reports
 * success and the operator finds out weeks later that a feature renders blank.
 * These schemas carry platform-level definitions that every root needs and
 * that no other step seeds, so an empty source gets an explicit warning.
 *
 * Deliberately NOT in this list: tenant-specific masters (ComplaintHierarchy,
 * ServiceDefs) whose emptiness at the source is the correct, expected state —
 * they are operator-owned and loaded via the configurator.
 */
const SCHEMAS_EMPTY_IS_A_PROBLEM = new Map<string, { impact: string; remedy: string }>([
  // dss.KpiDefinition / dss.DashboardPack are intentionally NOT here: they are
  // backfilled from the repo by the catalog floor (Step 2b), so an empty source
  // is no longer a problem for them. The remaining entries have no floor yet.
  [
    'INBOX.InboxQueryConfiguration',
    {
      impact: 'employee inbox searches will fail to resolve their query config',
      remedy: 'copy the master from a populated root (no installer script covers this one)',
    },
  ],
  [
    'ACCESSCONTROL-ROLEACTIONS.roleactions',
    {
      impact: 'no role will have any action grants, so every sidebar renders empty',
      remedy: 'seed ACCESSCONTROL-ROLEACTIONS from the ansible seed files',
    },
  ],
]);

/**
 * True when an MDMS data payload is actually a JSON Schema document.
 *
 * Posting a schema body to `/v2/_create/<schema>` instead of
 * `/schema/v1/_create` produces a data row whose payload is the schema itself.
 * mdms-v2 accepts it, it occupies the uniqueIdentifier that the real record
 * needs, and every later seed of that record is rejected as a duplicate — so
 * the master stays permanently broken while looking populated. Observed live
 * on `mz` for dss.KpiDefinition and dss.DashboardPack.
 *
 * Both markers are required, and both must be at the TOP level. Masters that
 * legitimately carry a JSON Schema as part of their data (e.g.
 * RAINMAKER-PGR.ComplaintExtendedAttributeSchema) nest it under a field —
 * verified live on `mz`, where those rows have neither `$schema` nor
 * `properties` as a top-level key.
 */
function isSchemaDocument(data: Record<string, unknown> | undefined): boolean {
  if (!data || typeof data !== 'object') return false;
  return (
    typeof data['$schema'] === 'string' &&
    typeof data['properties'] === 'object' &&
    data['properties'] !== null
  );
}

/**
 * Search for MDMS records across all state tenants.
 * First queries the default state tenant to discover all root-level tenants,
 * then queries each discovered root to get the complete set.
 */
async function searchAllStateTenants(
  defaultStateTenantId: string,
  schemaCode: string,
  filterState?: string
): Promise<Record<string, unknown>[]> {
  // If filtering to a specific state, just search that one
  if (filterState) {
    return digitApi.mdmsV2Search<Record<string, unknown>>(filterState, schemaCode);
  }

  // First search under the default state tenant
  const defaultResults = await digitApi.mdmsV2Search<Record<string, unknown>>(
    defaultStateTenantId,
    schemaCode
  );

  // Discover all state-level tenant roots from:
  // 1. The default state tenant
  // 2. Tenant codes found in the default search results
  // 3. Tenant IDs from the logged-in user's roles (covers cross-tenant admins)
  const knownRoots = new Set<string>();
  knownRoots.add(defaultStateTenantId);
  for (const t of defaultResults) {
    const code = t.code as string;
    if (code) {
      const root = code.includes('.') ? code.split('.')[0] : code;
      knownRoots.add(root);
    }
  }
  // Also check roles — the user may have roles on state tenants not in pg's MDMS
  const auth = digitApi.getAuthInfo();
  if (auth.user?.roles) {
    for (const role of auth.user.roles) {
      if (role.tenantId) {
        const root = role.tenantId.includes('.') ? role.tenantId.split('.')[0] : role.tenantId;
        knownRoots.add(root);
      }
    }
  }

  // Query each discovered root that differs from the default
  const allResults = [...defaultResults];
  const seenCodes = new Set(defaultResults.map((t) => t.code as string));

  for (const root of knownRoots) {
    if (root === defaultStateTenantId) continue;
    try {
      const results = await digitApi.mdmsV2Search<Record<string, unknown>>(root, schemaCode);
      for (const t of results) {
        if (!seenCodes.has(t.code as string)) {
          allResults.push(t);
          seenCodes.add(t.code as string);
        }
      }
    } catch (err) {
      // Skip unreachable state tenants — log for debugging
      console.error(`[mdms_get_tenants] Failed to fetch tenants for state "${root}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return allResults;
}

/**
 * Copy workflow business service definitions from one tenant root to another.
 * Reusable by both tenant_bootstrap and city_setup.
 */
async function copyWorkflowDefinitions(
  sourceRoot: string,
  targetRoot: string,
): Promise<{ created: string[]; skipped: string[]; failed: string[] }> {
  const results = { created: [] as string[], skipped: [] as string[], failed: [] as string[] };

  const knownServices = ['PGR', 'PT.CREATE', 'PT.UPDATE', 'NewTL', 'NewWS1', 'NewSW1', 'FSM', 'BPAREG', 'BPA'];
  const sourceServices = await digitApi.workflowBusinessServiceSearch(sourceRoot, knownServices);
  if (sourceServices.length === 0) {
    results.failed.push(`No workflow services found in source "${sourceRoot}"`);
    return results;
  }

  const buildStateMap = (states: Record<string, unknown>[]): Map<string, string> => {
    const map = new Map<string, string>();
    for (const s of states) {
      if (s.uuid && s.state) map.set(s.uuid as string, s.state as string);
    }
    return map;
  };

  for (const bs of sourceServices) {
    const bsCode = bs.businessService as string;
    try {
      const existing = await digitApi.workflowBusinessServiceSearch(targetRoot, [bsCode]);
      if (existing.length > 0) {
        results.skipped.push(bsCode);
        continue;
      }

      const sourceStates = (bs.states || []) as Record<string, unknown>[];
      const stateMap = buildStateMap(sourceStates);

      const cleanStates = sourceStates.map((s) => ({
        state: s.state,
        applicationStatus: s.applicationStatus,
        docUploadRequired: s.docUploadRequired,
        isStartState: s.isStartState,
        isTerminateState: s.isTerminateState,
        isStateUpdatable: s.isStateUpdatable,
        actions: ((s.actions || []) as Record<string, unknown>[]).map((a) => {
          const nextState = a.nextState as string;
          const resolvedNext = stateMap.get(nextState) || nextState;
          return {
            action: a.action,
            nextState: resolvedNext,
            roles: a.roles,
            active: a.active,
          };
        }),
      }));

      const result = await digitApi.workflowBusinessServiceCreate(targetRoot, {
        businessService: bsCode,
        business: bs.business,
        businessServiceSla: bs.businessServiceSla,
        states: cleanStates,
      });

      if (result.uuid || result.businessService) {
        results.created.push(bsCode);
      } else {
        results.failed.push(`${bsCode}: API returned 200 but no data`);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (isDuplicateError(msg)) {
        results.skipped.push(bsCode);
      } else {
        results.failed.push(`${bsCode}: ${msg}`);
      }
    }
  }

  return results;
}

export function registerMdmsTenantTools(registry: ToolRegistry): void {
  // ──────────────────────────────────────────
  // core group
  // ──────────────────────────────────────────

  // configure — authenticate with a DIGIT environment
  registry.register({
    name: 'configure',
    group: 'core',
    category: 'environment',
    // 'write', not 'read': this tool authenticates AND can grant roles on the
    // target tenant (see provision_roles). Labelling it read-risk meant clients
    // that auto-approve read tools auto-approved a privilege grant.
    access: 'admin',
    risk: 'write',
    description:
      'Connect to a DIGIT environment by logging in with credentials. This must be called before any tool that queries the DIGIT API. Accepts environment key, username, password, and tenant ID. If credentials are provided via CRS_USERNAME/CRS_PASSWORD env vars, those are used as defaults.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        base_url: {
          type: 'string',
          description:
            'Base URL of a DIGIT instance (e.g. "https://unified-dev.digit.org"). ' +
            'When provided, connects directly to this URL instead of using a named environment. ' +
            'Runs service probing to detect available APIs.',
        },
        environment: {
          type: 'string',
          description:
            'Environment to connect to. Optional when base_url is provided. Available: ' +
            Object.keys(ENVIRONMENTS).join(', '),
        },
        username: {
          type: 'string',
          description: 'DIGIT username (default: CRS_USERNAME env var)',
        },
        password: {
          type: 'string',
          description: 'DIGIT password (default: CRS_PASSWORD env var)',
        },
        tenant_id: {
          type: 'string',
          description: 'Set the operational state tenant (e.g. "statea", "pg"). ' +
            'This controls which tenant context is used for MDMS queries, role assignments, and API operations. ' +
            'Login always uses the user\'s home tenant to preserve the full role set.',
        },
        state_tenant: {
          type: 'string',
          description: 'Explicitly set the root state tenant for all subsequent operations. ' +
            'This overrides the environment default (e.g. switch from "pg" to "statea"). ' +
            'All MDMS queries, role assignments, and tenant lookups will use this as the root.',
        },
        provision_roles: {
          type: 'boolean',
          description: 'Opt in to granting this user the standard role set (CITIZEN, EMPLOYEE, CSR, GRO, ' +
            'PGR_LME, DGRO, SUPERUSER) on the target tenant when login had to fall back to a different one. ' +
            'Default false. This WRITES to the user record and includes SUPERUSER — request it deliberately.',
        },
      },
    },
    handler: async (args) => {
      const baseUrl = args.base_url as string | undefined;
      const envKey = (args.environment as string) || process.env.CRS_ENVIRONMENT || 'self-hosted';

      // A read-only instance must not be steered to an arbitrary host at all:
      // base_url flows to setAdHocEnvironment and, with the CRS_USERNAME/CRS_PASSWORD
      // fallback below, would POST the admin credentials there and poison the
      // process-wide client for every later read. Refuse it outright — stricter
      // than the allow-list guards below. (configure stays a read tool because a
      // read-only instance still needs it to connect to its own environment.)
      if (isReadOnlyEffective() && baseUrl) {
        return JSON.stringify({
          success: false,
          error: 'base_url is not allowed on a read-only MCP instance.',
        }, null, 2);
      }

      // ── base_url guards ──
      // Pointing the client at a caller-chosen host makes it send credentials
      // there. Two independent checks: the host must be allow-listed, and the
      // server's own stored credentials are never used for an ad-hoc target —
      // the caller has to supply their own.
      if (baseUrl) {
        const baseUrlError = checkBaseUrlAllowed(baseUrl);
        if (baseUrlError) {
          return JSON.stringify({ success: false, error: baseUrlError, code: 'BASE_URL_NOT_ALLOWED' }, null, 2);
        }
        if (getAuthMode() === 'token' && !(args.username && args.password)) {
          return JSON.stringify({
            success: false,
            error:
              'username and password are required when base_url is supplied. The server will not send its ' +
              'own stored credentials to a caller-specified host.',
            code: 'EXPLICIT_CREDENTIALS_REQUIRED',
          }, null, 2);
        }
      }

      // Switch environment: ad-hoc URL or named environment
      if (baseUrl) {
        digitApi.setAdHocEnvironment(baseUrl);
      } else {
        if (!ENVIRONMENTS[envKey]) {
          return JSON.stringify({
            success: false,
            error: `Unknown environment "${envKey}". Available: ${Object.keys(ENVIRONMENTS).join(', ')}`,
          }, null, 2);
        }
        digitApi.setEnvironment(envKey);
      }

      const env = digitApi.getEnvironmentInfo();
      // Env credentials are a convenience for the process owner (stdio), not a
      // substitute identity for a network caller. In token mode the caller is
      // already authenticated as themselves; falling back here would let an
      // admin on one tenant silently adopt the container's ADMIN account.
      const ambient = getAuthMode() === 'ambient';
      const username = (args.username as string) || (ambient ? process.env.CRS_USERNAME : undefined);
      const password = (args.password as string) || (ambient ? process.env.CRS_PASSWORD : undefined);
      const explicitTenantId = (args.tenant_id as string) || (args.state_tenant as string);
      const defaultLoginTenant = process.env.CRS_TENANT_ID || env.stateTenantId;

      // Login tenant resolution:
      // If the user provides explicit credentials + tenant_id, use that tenant (or its root) for login.
      // Users created under a non-default root (e.g. "tenant") only exist in that root's user store.
      // Fall back to CRS_TENANT_ID / env default when no explicit tenant is given.
      const explicitRoot = explicitTenantId
        ? (explicitTenantId.includes('.') ? explicitTenantId.split('.')[0] : explicitTenantId)
        : null;
      const loginTenantId = explicitRoot || defaultLoginTenant;

      // Desired operational state tenant
      const desiredStateTenant = explicitRoot || null;

      if (!username || !password) {
        if (desiredStateTenant) {
          digitApi.setStateTenant(desiredStateTenant);
        }
        const currentEnv = digitApi.getEnvironmentInfo();
        return JSON.stringify(
          {
            success: false,
            error: 'Username and password are required. Provide them as arguments or set CRS_USERNAME/CRS_PASSWORD env vars.',
            environment: currentEnv,
            stateTenantId: currentEnv.stateTenantId,
          },
          null,
          2
        );
      }

      // Try login with multiple tenant candidates. DIGIT employees may only be findable
      // at the exact city-level tenant (e.g. "tenant.coimbatore"), the state root ("tenant"),
      // or the environment default ("pg"). Try all unique candidates in order.
      const loginCandidates: string[] = [];
      if (explicitRoot) loginCandidates.push(explicitRoot);
      if (explicitTenantId && explicitTenantId !== explicitRoot) loginCandidates.push(explicitTenantId);
      if (defaultLoginTenant && defaultLoginTenant !== 'default' && !loginCandidates.includes(defaultLoginTenant)) {
        loginCandidates.push(defaultLoginTenant);
      }
      // For ad-hoc base_url with no explicit tenant, try common DIGIT root tenants
      if (baseUrl && loginCandidates.length === 0) {
        loginCandidates.push('pg', 'default');
      }
      if (loginCandidates.length === 0) loginCandidates.push(defaultLoginTenant);

      let loginError: string | null = null;
      let usedLoginTenant = loginCandidates[0];

      for (const candidate of loginCandidates) {
        try {
          await digitApi.login(username, password, candidate);
          usedLoginTenant = candidate;
          loginError = null;
          break;
        } catch (error) {
          loginError = error instanceof Error ? error.message : String(error);
        }
      }

      if (loginError) {
        const triedTenants = loginCandidates.map((t) => `"${t}"`).join(', ');
        return JSON.stringify(
          {
            success: false,
            error: 'Invalid login credentials',
            environment: { name: env.name, url: env.url },
            triedLoginTenants: triedTenants,
            hint: `Login failed against tenants: ${triedTenants}. ` +
              `IMPORTANT: HRMS employee usernames are the EMPLOYEE CODE (e.g. "EMP-LIVE-000057"), NOT the mobile number. ` +
              `Check the employee_create response for the "code" field and use that as the username. ` +
              `Default password is the configured provisioning password (MCP_DEFAULT_PROVISIONING_PASSWORD).`,
          },
          null,
          2
        );
      }

      // Set the operational state tenant.
      // For ad-hoc environments, derive it from the successful login tenant.
      if (desiredStateTenant) {
        digitApi.setStateTenant(desiredStateTenant);
      } else if (baseUrl) {
        // Derive state tenant from the tenant we successfully logged in with
        const derivedRoot = usedLoginTenant.includes('.') ? usedLoginTenant.split('.')[0] : usedLoginTenant;
        digitApi.setStateTenant(derivedRoot);
      }

      // ── Cross-tenant role provisioning ──
      // If we fell back to a different tenant (e.g. logged in on "pg" but target is "tenant"),
      // the user lacks roles for the target root. Adding them makes direct API login
      // (e.g. from a frontend) work for the target tenant too.
      //
      // OPT-IN (M6). This used to run automatically on any tenant fallback and
      // granted SUPERUSER among others — a privilege escalation performed as a
      // side effect of a tool documented as "connect to an environment", and one
      // that clients auto-approving read-risk tools would never be asked about.
      // The caller now has to ask for it explicitly.
      const provisionRoles = args.provision_roles === true;
      const tenantFellBack =
        !!explicitRoot && usedLoginTenant !== explicitRoot && usedLoginTenant !== explicitTenantId;
      let rolesProvisioned: string[] | null = null;
      let rolesProvisionSkipped: Record<string, unknown> | null = null;
      // The provisioning branch below calls userUpdate to self-grant SUPERUSER
      // (and eight other roles) on the target root — a write to the DIGIT user
      // store, which a read-only instance must never do. Surface a skip note
      // instead of attempting it, even when provision_roles was requested.
      if (tenantFellBack && provisionRoles && isReadOnlyEffective()) {
        rolesProvisionSkipped = {
          targetTenant: explicitRoot,
          loggedInOn: usedLoginTenant,
          note:
            `Logged in on "${usedLoginTenant}" but you asked for "${explicitRoot}". Role provisioning grants ` +
            `SUPERUSER and is disabled on a read-only MCP instance; assign roles out of band if needed.`,
        };
      } else if (tenantFellBack && !provisionRoles) {
        rolesProvisionSkipped = {
          targetTenant: explicitRoot,
          loggedInOn: usedLoginTenant,
          note:
            `Logged in on "${usedLoginTenant}" but you asked for "${explicitRoot}". This user may lack roles ` +
            `on the target tenant. Re-run configure with provision_roles: true to grant the standard role set ` +
            `(includes SUPERUSER), or assign roles explicitly with user_role_add.`,
        };
      } else if (tenantFellBack && provisionRoles) {
        try {
          const auth = digitApi.getAuthInfo();
          const searchTenant = auth.user?.tenantId || usedLoginTenant;
          const users = await digitApi.userSearch(searchTenant, { userName: username, limit: 1 });

          if (users.length > 0) {
            const user = users[0];
            const existingRoles = (user.roles || []) as Array<{ code: string; name: string; tenantId: string }>;
            const existingForTarget = new Set(
              existingRoles.filter((r) => r.tenantId === explicitRoot).map((r) => r.code),
            );

            const standardRoles = ['CITIZEN', 'EMPLOYEE', 'CSR', 'GRO', 'PGR_LME', 'DGRO', 'SUPERUSER', 'MDMS_ADMIN', 'LOC_ADMIN'];
            const newRoles = standardRoles
              .filter((code) => !existingForTarget.has(code))
              .map((code) => ({ code, name: code, tenantId: explicitRoot }));

            if (newRoles.length > 0) {
              await digitApi.userUpdate({
                ...user,
                roles: [...existingRoles, ...newRoles],
              });
              rolesProvisioned = newRoles.map((r) => r.code);

              // Re-login with the target tenant now that roles exist
              try {
                await digitApi.login(username, password, explicitRoot);
                usedLoginTenant = explicitRoot;
              } catch (reloginErr) {
                console.error(`[configure] Re-login to "${explicitRoot}" failed after role provisioning: ${reloginErr instanceof Error ? reloginErr.message : String(reloginErr)}`);
              }
            }
          }
        } catch (provErr) {
          console.error(`[configure] Role provisioning failed: ${provErr instanceof Error ? provErr.message : String(provErr)}`);
        }
      }

      const auth = digitApi.getAuthInfo();
      const envAfterLogin = digitApi.getEnvironmentInfo();

      // ── Service probing (when using ad-hoc base_url) ──
      let probeReport: ProbeReport | undefined;
      if (baseUrl) {
        const authInfo = digitApi.getAuthInfo();
        probeReport = await probeServices(baseUrl, authInfo.token!);

        // Apply detected endpoint overrides so subsequent tool calls use correct paths
        if (Object.keys(probeReport.detectedEndpointOverrides).length > 0) {
          digitApi.setAdHocEnvironment(baseUrl, probeReport.detectedEndpointOverrides);
          // Re-authenticate since setAdHocEnvironment clears auth
          await digitApi.login(username, password, usedLoginTenant);
        }
      }

      return JSON.stringify(
        {
          success: true,
          message: `Authenticated as "${username}" on ${envAfterLogin.name}`,
          environment: { name: envAfterLogin.name, url: envAfterLogin.url },
          stateTenantId: envAfterLogin.stateTenantId,
          loginTenantId: usedLoginTenant,
          ...(baseUrl ? { source: 'base_url' } : {}),
          ...(probeReport ? {
            services: probeReport.services,
            detectedEndpointOverrides: probeReport.detectedEndpointOverrides,
          } : {}),
          ...(rolesProvisionSkipped ? { rolesNotProvisioned: rolesProvisionSkipped } : {}),
          ...(rolesProvisioned && {
            rolesProvisioned: {
              tenant: explicitRoot,
              roles: rolesProvisioned,
              note: `Added roles for "${explicitRoot}" so direct API login with this tenant now works.`,
            },
          }),
          user: auth.user
            ? {
                userName: auth.user.userName,
                name: auth.user.name,
                tenantId: auth.user.tenantId,
                roles: auth.user.roles?.map((r: { code: string }) => r.code),
              }
            : null,
        },
        null,
        2
      );
    },
  } satisfies ToolMetadata);

  // get_environment_info — show current environment config
  registry.register({
    name: 'get_environment_info',
    group: 'core',
    category: 'environment',
    access: 'public',
    risk: 'read',
    description:
      'Show the current DIGIT environment configuration (name, URL, state tenant ID). Also lists all available environments. ' +
      'Can switch environment or change the active state tenant.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        switch_to: {
          type: 'string',
          description:
            'Optional: switch to a different environment before returning info. Available keys: ' +
            Object.keys(ENVIRONMENTS).join(', '),
        },
        state_tenant: {
          type: 'string',
          description: 'Optional: override the root state tenant (e.g. switch from "pg" to "statea")',
        },
      },
    },
    handler: async (args) => {
      if (args.switch_to) {
        digitApi.setEnvironment(args.switch_to as string);
      }
      if (args.state_tenant) {
        digitApi.setStateTenant(args.state_tenant as string);
      }

      const env = digitApi.getEnvironmentInfo();
      const auth = digitApi.getAuthInfo();
      return JSON.stringify(
        {
          success: true,
          current: {
            name: env.name,
            url: env.url,
            stateTenantId: env.stateTenantId,
          },
          authenticated: auth.authenticated,
          user: auth.user ? { userName: auth.user.userName, tenantId: auth.user.tenantId } : null,
          available: Object.entries(ENVIRONMENTS).map(([key, e]) => ({
            key,
            name: e.name,
            url: e.url,
            defaultStateTenantId: e.stateTenantId,
          })),
        },
        null,
        2
      );
    },
  } satisfies ToolMetadata);

  // mdms_get_tenants — list tenants from MDMS (all state tenants)
  registry.register({
    name: 'mdms_get_tenants',
    group: 'core',
    category: 'mdms',
    risk: 'read',
    description:
      'Fetch all tenant records from MDMS across all state tenants. Returns tenant codes, names, and city info. Requires authentication — will attempt auto-login using CRS_USERNAME/CRS_PASSWORD env vars if not authenticated.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        state_tenant_id: {
          type: 'string',
          description: 'Filter to a specific state tenant (default: return all)',
        },
      },
    },
    handler: async (args) => {
      await ensureAuthenticated();

      const env = digitApi.getEnvironmentInfo();
      const filterState = args.state_tenant_id as string | undefined;

      // Search across all state tenants to get the full picture
      const allTenants = await searchAllStateTenants(
        env.stateTenantId,
        MDMS_SCHEMAS.TENANT,
        filterState
      );

      return JSON.stringify(
        {
          success: true,
          environment: env.name,
          count: allTenants.length,
          tenants: allTenants.map((t) => ({
            code: t.code,
            name: t.name,
            description: t.description,
            city: t.city,
          })),
        },
        null,
        2
      );
    },
  } satisfies ToolMetadata);

  // ──────────────────────────────────────────
  // mdms group
  // ──────────────────────────────────────────

  // validate_tenant — check if a tenant code exists
  registry.register({
    name: 'validate_tenant',
    group: 'mdms',
    category: 'validation',
    risk: 'read',
    description:
      'Validate that a tenant code exists in the MDMS tenant list. Returns the tenant details if found, or an error if not. Useful before running other validations that require a valid tenant.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tenant_id: {
          type: 'string',
          description: 'Tenant code to validate (e.g. "pg.citya")',
        },
      },
      required: ['tenant_id'],
    },
    handler: async (args) => {
      await ensureAuthenticated();

      const tenantId = args.tenant_id as string;
      const env = digitApi.getEnvironmentInfo();

      // Search across all state tenants to find this tenant
      const allTenants = await searchAllStateTenants(
        env.stateTenantId,
        MDMS_SCHEMAS.TENANT
      );

      const found = allTenants.find((t) => t.code === tenantId);

      if (found) {
        return JSON.stringify(
          {
            success: true,
            valid: true,
            tenant: {
              code: found.code,
              name: found.name,
              description: found.description,
              city: found.city,
            },
          },
          null,
          2
        );
      }

      const suggestions = allTenants
        .filter((t) => {
          const code = (t.code as string) || '';
          return code.includes(tenantId) || tenantId.includes(code);
        })
        .map((t) => t.code);

      return JSON.stringify(
        {
          success: true,
          valid: false,
          error: `Tenant "${tenantId}" not found`,
          suggestions: suggestions.length > 0 ? suggestions : undefined,
          availableCount: allTenants.length,
        },
        null,
        2
      );
    },
  } satisfies ToolMetadata);

  // mdms_search — generic MDMS search
  registry.register({
    name: 'mdms_search',
    group: 'mdms',
    category: 'mdms',
    risk: 'read',
    description:
      'Search MDMS v2 for records by schema code. Returns the data field of each record. Common schemas: ' +
      Object.entries(MDMS_SCHEMAS)
        .map(([k, v]) => `${k}="${v}"`)
        .join(', '),
    inputSchema: {
      type: 'object' as const,
      properties: {
        tenant_id: {
          type: 'string',
          description: 'Tenant ID to search in',
        },
        schema_code: {
          type: 'string',
          description: 'MDMS schema code (e.g. "common-masters.Department")',
        },
        unique_identifiers: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter by specific unique identifiers',
        },
        limit: {
          type: 'number',
          description: 'Max records to return (default: 100)',
        },
        offset: {
          type: 'number',
          description: 'Offset for pagination (default: 0)',
        },
        ...PAGINATION_SCHEMA_PROPERTIES,
        fields: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional: only return these fields per result. Available: uniqueIdentifier, data, isActive',
        },
      },
      required: ['tenant_id', 'schema_code'],
    },
    handler: async (args) => {
      await ensureAuthenticated();

      const tenantId = args.tenant_id as string;
      const schemaCode = args.schema_code as string;
      const uniqueIdentifiers = args.unique_identifiers as string[] | undefined;
      const pageOpts = args as PaginationOptions;

      let records: MdmsRecord[];
      let paginationMeta: Record<string, unknown> | undefined;

      if (pageOpts.page_all) {
        const result = await autoPaginate(
          (limit, offset) => digitApi.mdmsV2SearchRaw(tenantId, schemaCode, { limit, offset, uniqueIdentifiers }),
          pageOpts,
          100,
        );
        records = result.items;
        paginationMeta = { totalFetched: result.totalFetched, pages: result.pages, truncated: result.truncated };
      } else {
        records = await digitApi.mdmsV2SearchRaw(tenantId, schemaCode, {
          limit: (args.limit as number) || 100,
          offset: (args.offset as number) || 0,
          uniqueIdentifiers,
        });
      }

      const fields = args.fields as string[] | undefined;
      const mapped = records.map((r) => ({
        uniqueIdentifier: r.uniqueIdentifier,
        data: r.data,
        isActive: r.isActive,
      }));
      const { items: masked, truncated } = applyFieldMask(mapped, fields);

      return JSON.stringify(
        {
          success: true,
          tenantId: args.tenant_id,
          schemaCode: args.schema_code,
          count: records.length,
          ...(paginationMeta ? { pagination: paginationMeta } : {}),
          records: masked,
          truncated,
          ...(fields ? { fieldsApplied: fields } : {}),
        },
        null,
        2
      );
    },
  } satisfies ToolMetadata);

  // mdms_schema_search — search schema definitions
  registry.register({
    name: 'mdms_schema_search',
    group: 'mdms',
    category: 'mdms',
    risk: 'read',
    description:
      'Search MDMS v2 schema definitions for a tenant. Shows what schemas are registered and available for creating data records. ' +
      'If mdms_create fails with "Schema definition not found", use this to check which tenant root has the schema.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tenant_id: {
          type: 'string',
          description: 'Tenant ID (typically the state-level root, e.g. "pg", "statea", "tenant")',
        },
        codes: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional: filter by specific schema codes (e.g. ["RAINMAKER-PGR.ComplaintHierarchy"])',
        },
      },
      required: ['tenant_id'],
    },
    handler: async (args) => {
      await ensureAuthenticated();

      const tenantId = args.tenant_id as string;
      const codes = args.codes as string[] | undefined;
      const schemas = await digitApi.mdmsSchemaSearch(tenantId, codes);

      return JSON.stringify(
        {
          success: true,
          tenantId,
          count: schemas.length,
          schemas: schemas.map((s) => ({
            code: s.code,
            description: s.description,
            tenantId: s.tenantId,
            isActive: s.isActive,
          })),
        },
        null,
        2
      );
    },
  } satisfies ToolMetadata);

  // mdms_schema_create — register a schema definition
  registry.register({
    name: 'mdms_schema_create',
    group: 'mdms',
    category: 'mdms',
    access: 'admin',
    risk: 'write',
    description:
      'Register a new MDMS v2 schema definition for a tenant. Schemas must exist at the state-level root tenant before data records can be created. ' +
      'Use mdms_schema_search on an existing tenant (e.g. "pg") to find the schema definition to copy, then register it on the new tenant root. ' +
      'You can also provide a custom JSON Schema definition.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tenant_id: {
          type: 'string',
          description: 'Tenant ID to register the schema under (state-level root, e.g. "tenant", "statea")',
        },
        code: {
          type: 'string',
          description: 'Schema code (e.g. "RAINMAKER-PGR.ComplaintHierarchy", "common-masters.Department")',
        },
        description: {
          type: 'string',
          description: 'Human-readable description of the schema',
        },
        definition: {
          type: 'object',
          description: 'JSON Schema definition object. Must include "type", "properties", and optionally "required", "x-unique".',
        },
        copy_from_tenant: {
          type: 'string',
          description: 'Optional: copy the schema definition from another tenant (e.g. "pg"). If provided, "definition" is ignored.',
        },
      },
      required: ['tenant_id', 'code'],
    },
    handler: async (args) => {
      validateTenantId(args.tenant_id, 'tenant_id');
      validateResourceId(args.code, 'code');
      if (args.copy_from_tenant) validateTenantId(args.copy_from_tenant, 'copy_from_tenant');

      await ensureAuthenticated();

      const tenantId = args.tenant_id as string;
      const code = args.code as string;
      const description = (args.description as string) || code;
      const copyFrom = args.copy_from_tenant as string | undefined;
      let definition = args.definition as Record<string, unknown> | undefined;

      // Copy schema from another tenant if requested
      if (copyFrom) {
        const schemas = await digitApi.mdmsSchemaSearch(copyFrom, [code]);
        if (schemas.length === 0) {
          return JSON.stringify({
            success: false,
            error: `Schema "${code}" not found in tenant "${copyFrom}". Use mdms_schema_search to list available schemas.`,
          }, null, 2);
        }
        definition = schemas[0].definition as Record<string, unknown>;
      }

      if (!definition) {
        return JSON.stringify({
          success: false,
          error: 'Either "definition" or "copy_from_tenant" must be provided.',
        }, null, 2);
      }

      try {
        const result = await digitApi.mdmsSchemaCreate(tenantId, code, description, definition);
        return JSON.stringify({
          success: true,
          message: `Schema "${code}" registered for tenant "${tenantId}"`,
          schema: {
            id: result.id,
            tenantId: result.tenantId,
            code: result.code,
            isActive: result.isActive,
          },
        }, null, 2);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (isDuplicateError(msg)) {
          return JSON.stringify({
            success: true,
            message: `Schema "${code}" already exists for tenant "${tenantId}"`,
            alreadyExists: true,
          }, null, 2);
        }
        throw error;
      }
    },
  } satisfies ToolMetadata);

  // tenant_bootstrap — consume the versioned PGR platform baseline
  registry.register({
    name: 'tenant_bootstrap',
    group: 'mdms',
    category: 'mdms',
    access: 'admin',
    risk: 'write',
    description:
      'Bootstrap a tenant using the versioned platform baseline shared with PGR. Requires an authenticated platform administrator. Uses the gateway by default; direct MDMS requires server opt-in and live state-admin verification. ' +
      'Seeds platform access/security/HRMS prerequisites and an ADMIN user. Workspace business masters are configured separately. ' +
      'source_tenant supplies country mobile rules only; no schemas or business data are cloned.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        target_tenant: {
          type: 'string',
          description: 'The new tenant root to bootstrap (e.g. "tenant", "ke")',
        },
        source_tenant: {
          type: 'string',
          description: 'Country mobile-rule source only (default: configured state tenant). Platform schemas and records come from the versioned seed.',
        },
        mobile_regex: {
          type: 'string',
          description:
            'Mobile-number regex stored as mobileNumberRegex in the synthesized ' +
            'common-masters.MobileNumberValidation record. Inherited from the source tenant\'s ' +
            'MobileNumberValidation when omitted; fails if no country rule or explicit regex is available. ' +
            'Kenya: "^[17][0-9]{8}$". Mozambique: "^8[0-9]{8}$".',
        },
        mobile_length: {
          type: 'integer',
          description:
            'Mobile-number length used to generate a conforming ADMIN mobile number when ' +
            'admin_mobile is not supplied. Default 10 (India). Kenya/Mozambique: 9. ' +
            'Used with user_validation too.',
        },
        mobile_prefix: {
          type: 'string',
          description:
            'Country dialling prefix (e.g. "+258" for Mozambique, "+254" for Kenya). ' +
            'Used as the countryCode field and x-unique key in the MobileNumberValidation record. ' +
            'Inherited from the source tenant\'s MobileNumberValidation when omitted. ' +
            'Ignored when user_validation is supplied.',
        },
        mobile_zone: {
          type: 'string',
          description:
            'Deprecated — superseded by mobile_prefix. Accepted for backwards compatibility ' +
            'but ignored when mobile_prefix is also provided.',
        },
        admin_mobile: {
          type: 'string',
          description:
            'Mobile number for the provisioned ADMIN user on the target tenant. Optional — ' +
            'if omitted, a value conforming to mobile_regex is generated (the source country\'s ' +
            'mobile would fail the target tenant\'s MobileNumberValidation pattern). ' +
            'Set it to pin a specific number.',
        },
        pincode_allowlist: {
          type: 'array',
          items: { type: ['string', 'integer'] },
          description:
            'Legacy compatibility input, ignored by platform bootstrap with a warning. Configure postal codes in the workspace.',
        },
        dashboard_roles: {
          type: 'array',
          minItems: 1,
          uniqueItems: true,
          items: { type: 'string' },
          description:
            'Legacy compatibility input, ignored by platform bootstrap with a warning. Configure dashboard access in the workspace.',
        },
        user_validation: {
          type: 'array',
          description:
            'Mobile validation rules — one entry per country. Each entry maps to a ' +
            'common-masters.MobileNumberValidation record (x-unique: countryCode). ' +
            'When supplied, supersedes mobile_regex/mobile_prefix.',
          items: {
            type: 'object',
            properties: {
              countryCode: { type: 'string', description: 'Country dialling prefix, used as x-unique key (e.g. "+254" for Kenya, "+258" for Mozambique, "+91" for India).' },
              mobileNumberRegex: { type: 'string', description: 'regex the mobile number must match (e.g. "^[17][0-9]{8}$")' },
              default: { type: 'boolean', description: 'Whether this is the default validation rule for the tenant (default: true).' },
            },
            required: ['countryCode', 'mobileNumberRegex'],
          },
        },
        user_only: {
          type: 'boolean',
          description:
            'When true, skip platform seeding and employee setup; create or update the administrator user on ' +
            'target_tenant. Called after post-bootstrap changes STATE_LEVEL_TENANT_ID ' +
            'from pg to the real state root so the user is stored with the correct enc key.',
        },
      },
      required: ['target_tenant'],
    },
    handler: async (args) => {
      validateTenantId(args.target_tenant, 'target_tenant');
      if (args.source_tenant) validateTenantId(args.source_tenant, 'source_tenant');
      await ensureAuthenticated();
      return JSON.stringify(await bootstrapPlatform(args, {
        deriveMobile: deriveValidMobile, defaultPassword: defaultProvisioningPassword,
      }), null, 2);
    },
  } satisfies ToolMetadata);

  // city_setup — set up a city-level tenant with everything needed for PGR
  registry.register({
    name: 'city_setup',
    group: 'mdms',
    category: 'mdms',
    access: 'admin',
    risk: 'write',
    description:
      'Set up a city-level tenant under an existing root with everything needed for PGR. ' +
      'Creates tenant record, provisions dual-scoped ADMIN user, copies workflow definitions, and creates boundary hierarchy. ' +
      'Call tenant_bootstrap first to set up the root.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tenant_id: {
          type: 'string',
          description: 'City tenant ID e.g. "pg.newcity"',
        },
        city_name: {
          type: 'string',
          description: 'Human-readable city name',
        },
        source_tenant: {
          type: 'string',
          description: 'Source for workflow copy (default: root tenant, falls back to "pg")',
        },
        create_boundaries: {
          type: 'boolean',
          description: 'Create default boundary hierarchy (default: true)',
        },
        locality_codes: {
          type: 'array',
          items: { type: 'string' },
          description: 'Custom locality codes. Default: auto-generated LOC_<CITYCODE>_1',
        },
      },
      required: ['tenant_id', 'city_name'],
    },
    handler: async (args) => {
      validateTenantId(args.tenant_id, 'tenant_id');
      if (args.source_tenant) validateTenantId(args.source_tenant, 'source_tenant');

      await ensureAuthenticated();

      const tenantId = args.tenant_id as string;
      const cityName = args.city_name as string;
      const sourceArg = args.source_tenant as string | undefined;
      const createBoundaries = (args.create_boundaries as boolean) ?? true;
      const localityCodes = args.locality_codes as string[] | undefined;

      // Validate city-level tenant ID
      if (!tenantId.includes('.')) {
        return JSON.stringify({
          success: false,
          error: `tenant_id "${tenantId}" must be a city-level ID containing a dot (e.g. "pg.newcity"). ` +
            'Use tenant_bootstrap for state-level root tenants.',
        }, null, 2);
      }

      // Register the city tenant with egov-enc-service before Step 3 creates its
      // dual-scoped ADMIN user — each tenantId needs its own key (the root's key,
      // provisioned by tenant_bootstrap, doesn't cover a distinct city tenantId).
      // See tenant_bootstrap's identical call above for the full rationale.
      // Non-fatal: if enc-service is unreachable, let Step 3 surface the real error.
      try {
        await digitApi.generateEncKey(tenantId);
      } catch (e) {
        console.error(`[city_setup] enc-service key generation failed for "${tenantId}": ${e instanceof Error ? e.message : String(e)}`);
      }

      const root = tenantId.split('.')[0];
      const cityCode = tenantId.split('.').slice(1).join('.').toUpperCase().replace(/\./g, '_');

      const steps: Record<string, unknown> = {};

      // Step 1: Validate root tenant exists
      try {
        const rootTenants = await digitApi.mdmsV2SearchRaw(root, 'tenant.tenants', {
          uniqueIdentifiers: [root],
          limit: 1,
        });
        if (rootTenants.length === 0) {
          // Also check if root exists in pg's MDMS (multi-root setup)
          const pgTenants = await digitApi.mdmsV2SearchRaw('pg', 'tenant.tenants', {
            uniqueIdentifiers: [root],
            limit: 1,
          });
          if (pgTenants.length === 0 && root !== 'pg') {
            return JSON.stringify({
              success: false,
              error: `Root tenant "${root}" not found. Run tenant_bootstrap with target_tenant="${root}" first.`,
            }, null, 2);
          }
        }
      } catch (err) {
        // If root MDMS search fails, root likely doesn't exist
        if (root !== 'pg') {
          return JSON.stringify({
            success: false,
            error: `Root tenant "${root}" not accessible: ${err instanceof Error ? err.message : String(err)}. ` +
              `Run tenant_bootstrap with target_tenant="${root}" first.`,
          }, null, 2);
        }
      }

      // Step 2: Create city tenant MDMS record
      try {
        const existing = await digitApi.mdmsV2SearchRaw(root, 'tenant.tenants', {
          uniqueIdentifiers: [`Tenant.${tenantId}`],
          limit: 1,
        });
        if (existing.length > 0 && existing[0].isActive) {
          steps.tenantRecord = 'already_exists';
        } else if (existing.length > 0 && !existing[0].isActive) {
          await digitApi.mdmsV2Update(existing[0], true);
          steps.tenantRecord = 'reactivated';
        } else {
          await digitApi.mdmsV2Create(root, 'tenant.tenants', `Tenant.${tenantId}`, {
            code: tenantId,
            name: cityName,
            tenantId,
            parent: root,
            city: {
              code: cityCode,
              name: cityName,
              districtName: root,
            },
          });
          steps.tenantRecord = 'created';
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (isDuplicateError(msg)) {
          steps.tenantRecord = 'already_exists';
        } else {
          return JSON.stringify({
            success: false,
            error: `Failed to create city tenant record: ${msg}`,
            hint: `Ensure root "${root}" has tenant.tenants schema with x-unique. Run tenant_bootstrap if needed.`,
          }, null, 2);
        }
      }

      // Step 3: Provision dual-scoped ADMIN user
      const adminUserResult: { provisioned: boolean; dualScoped: boolean; rolesAdded: number; error?: string } = {
        provisioned: false,
        dualScoped: false,
        rolesAdded: 0,
      };
      try {
        const auth = digitApi.getAuthInfo();
        const currentUsername = auth.user?.userName || process.env.CRS_USERNAME || 'ADMIN';
        const currentPassword = digitApi.getLoginPassword() || process.env.CRS_PASSWORD || defaultProvisioningPassword();

        const standardRoles = ['EMPLOYEE', 'CITIZEN', 'CSR', 'GRO', 'PGR_LME', 'DGRO', 'SUPERUSER', 'MDMS_ADMIN', 'LOC_ADMIN', 'ACCOUNT_ADMIN', 'INTERNAL_MICROSERVICE_ROLE'];

        // Build dual-scoped roles (both root and city)
        const dualRoles = standardRoles.flatMap(code => [
          { code, name: code, tenantId: root },
          { code, name: code, tenantId: tenantId },
        ]);

        // Search for ADMIN user on root tenant
        const sourceTenantForSearch = auth.user?.tenantId || root;
        const rootUsers = await digitApi.userSearch(sourceTenantForSearch, {
          userName: currentUsername,
          limit: 1,
        });

        const sourceUser = rootUsers[0];
        const userName = (sourceUser?.userName as string) || currentUsername;
        const name = (sourceUser?.name as string) || 'Admin';
        const mobileNumber = (sourceUser?.mobileNumber as string) || '9999999999';

        // Check if user exists on city tenant
        let userOnCity: Record<string, unknown> | null = null;
        try {
          const cityUsers = await digitApi.userSearch(tenantId, { userName: userName, limit: 1 });
          if (cityUsers.length > 0) userOnCity = cityUsers[0];
        } catch (_) {
          // City user search may fail if city tenant is brand new
        }

        if (userOnCity) {
          // User exists — ensure dual-scoped roles
          const existingRoles = (userOnCity.roles || []) as Array<{ code: string; tenantId: string }>;
          const existingSet = new Set(existingRoles.map(r => `${r.code}@${r.tenantId}`));
          const missingRoles = dualRoles.filter(r => !existingSet.has(`${r.code}@${r.tenantId}`));
          if (missingRoles.length > 0) {
            await digitApi.userUpdate({
              ...userOnCity,
              roles: [...existingRoles, ...missingRoles],
            });
            adminUserResult.rolesAdded = missingRoles.length;
          }
          adminUserResult.provisioned = true;
          adminUserResult.dualScoped = true;
        } else {
          // Create user on city tenant with dual-scoped roles
          await digitApi.userCreate({
            name,
            mobileNumber,
            userName,
            password: currentPassword,
            type: 'EMPLOYEE',
            active: true,
            emailId: (sourceUser?.emailId as string) || null,
            gender: (sourceUser?.gender as string) || null,
            roles: dualRoles,
            tenantId,
          }, tenantId);
          adminUserResult.provisioned = true;
          adminUserResult.dualScoped = true;
          adminUserResult.rolesAdded = dualRoles.length;
        }

        // Also ensure the root-level user has city-scoped roles
        if (sourceUser) {
          const rootExistingRoles = (sourceUser.roles || []) as Array<{ code: string; tenantId: string }>;
          const rootExistingSet = new Set(rootExistingRoles.map(r => `${r.code}@${r.tenantId}`));
          const cityRoles = standardRoles
            .map(code => ({ code, name: code, tenantId }))
            .filter(r => !rootExistingSet.has(`${r.code}@${r.tenantId}`));
          if (cityRoles.length > 0) {
            await digitApi.userUpdate({
              ...sourceUser,
              roles: [...rootExistingRoles, ...cityRoles],
            });
            adminUserResult.rolesAdded += cityRoles.length;
          }
        }
      } catch (err) {
        adminUserResult.error = err instanceof Error ? err.message : String(err);
      }
      steps.adminUser = adminUserResult;

      // Step 4: Copy workflow definitions (idempotent)
      let workflowResult = { created: [] as string[], skipped: [] as string[], failed: [] as string[] };
      try {
        // Determine source for workflow: explicit arg > root (if it has workflows) > "pg"
        let workflowSource = sourceArg || root;
        if (!sourceArg) {
          try {
            const rootWorkflows = await digitApi.workflowBusinessServiceSearch(root, ['PGR']);
            if (rootWorkflows.length === 0 && root !== 'pg') {
              workflowSource = 'pg';
            }
          } catch (_) {
            if (root !== 'pg') workflowSource = 'pg';
          }
        }
        workflowResult = await copyWorkflowDefinitions(workflowSource, root);
      } catch (err) {
        workflowResult.failed.push(`workflow copy error: ${err instanceof Error ? err.message : String(err)}`);
      }
      steps.workflow = workflowResult;

      // Step 5: Create boundary hierarchy + entities
      if (createBoundaries) {
        const boundaryResult: {
          hierarchyReused: boolean;
          entitiesCreated: number;
          localityCodes: string[];
          error?: string;
        } = {
          hierarchyReused: false,
          entitiesCreated: 0,
          localityCodes: [],
        };

        try {
          // Check if hierarchy exists on root
          let hierarchyLevels: string[] = [];
          try {
            const existing = await digitApi.boundaryHierarchySearch(root, 'ADMIN');
            if (existing.length > 0) {
              const hier = existing[0] as { boundaryHierarchy?: { boundaryType: string; parentBoundaryType?: string }[] };
              if (hier.boundaryHierarchy) {
                hierarchyLevels = buildOrderedLevels(hier.boundaryHierarchy);
                boundaryResult.hierarchyReused = true;
              }
            }
          } catch (_) {
            // No hierarchy on root
          }

          if (hierarchyLevels.length === 0) {
            hierarchyLevels = ['Country', 'State', 'District', 'City', 'Ward', 'Locality'];
          }

          // Create hierarchy on root if needed
          const levels = hierarchyLevels.map((type, i) => ({
            boundaryType: type,
            parentBoundaryType: i === 0 ? null : hierarchyLevels[i - 1],
            active: true,
          }));

          try {
            await digitApi.boundaryHierarchyCreate(root, 'ADMIN', levels);
          } catch (herr) {
            const msg = herr instanceof Error ? herr.message : String(herr);
            if (!isDuplicateError(msg)) {
              console.error(`[city_setup] hierarchy create on root "${root}" failed: ${msg}`);
            }
          }

          // Create hierarchy on city tenant too
          try {
            await digitApi.boundaryHierarchyCreate(tenantId, 'ADMIN', levels);
          } catch (herr) {
            const msg = herr instanceof Error ? herr.message : String(herr);
            if (!isDuplicateError(msg)) {
              console.error(`[city_setup] hierarchy create on city "${tenantId}" failed: ${msg}`);
            }
          }

          // Build boundary entities
          const locs = (localityCodes && localityCodes.length > 0)
            ? localityCodes
            : [`LOC_${cityCode}_1`];
          boundaryResult.localityCodes = locs;

          const countryCode = `COUNTRY_${cityCode}`;
          const stateCode = `STATE_${cityCode}`;
          const districtCode = `DISTRICT_${cityCode}`;
          const cityBndCode = `CITY_${cityCode}`;

          const boundaries: { code: string; type: string; parent?: string }[] = [
            { code: countryCode, type: 'Country' },
            { code: stateCode, type: 'State', parent: countryCode },
            { code: districtCode, type: 'District', parent: stateCode },
            { code: cityBndCode, type: 'City', parent: districtCode },
          ];

          // Create one Ward + Locality per locality code
          for (let i = 0; i < locs.length; i++) {
            const wardCode = `WARD_${cityCode}_${i + 1}`;
            boundaries.push(
              { code: wardCode, type: 'Ward', parent: cityBndCode },
              { code: locs[i], type: 'Locality', parent: wardCode },
            );
          }

          // Create boundary entities
          for (const b of boundaries) {
            try {
              await digitApi.boundaryCreate(tenantId, [{ code: b.code, tenantId }]);
              boundaryResult.entitiesCreated++;
            } catch (berr) {
              const msg = berr instanceof Error ? berr.message : String(berr);
              if (!isDuplicateError(msg)) {
                console.error(`[city_setup] boundary entity create "${b.code}" failed: ${msg}`);
              } else {
                boundaryResult.entitiesCreated++; // count skipped as "exists"
              }
            }
          }

          // Create relationships (top-down order is already correct)
          for (const b of boundaries) {
            try {
              await digitApi.boundaryRelationshipCreate(
                tenantId,
                b.code,
                'ADMIN',
                b.type,
                b.parent || null,
              );
            } catch (rerr) {
              const msg = rerr instanceof Error ? rerr.message : String(rerr);
              if (!isDuplicateError(msg)) {
                console.error(`[city_setup] boundary relationship "${b.code}" failed: ${msg}`);
              }
            }
          }
        } catch (err) {
          boundaryResult.error = err instanceof Error ? err.message : String(err);
        }
        steps.boundaries = boundaryResult;
      }

      // Step 6: Seed an HRMS admin employee linked to the ADMIN user.
      //
      // Why this step exists: tenant_bootstrap + steps 1–3 above produce a
      // tenant whose ADMIN user can log in and file complaints, but PGR's
      // Assign action requires an assignee with an `eg_hrms_employee` row
      // (tied to a department + designation + jurisdiction). Without it,
      // every assign-onward workflow step returns 400. Newman's full
      // complaints-demo suite fails 7/13 on a fresh tenant without this.
      //
      // We pick the first available department + designation from the root's
      // common-masters MDMS — those rows were just copied by tenant_bootstrap
      // so they're guaranteed to exist. Failures here are non-fatal: city
      // creation already succeeded, the operator can call employee_create
      // explicitly with a different department later.
      const employeeResult: { provisioned: boolean; code?: string; department?: string; designation?: string; error?: string } = {
        provisioned: false,
      };
      try {
        const auth = digitApi.getAuthInfo();
        const adminUserName = auth.user?.userName || process.env.CRS_USERNAME || 'ADMIN';

        const [depts, desigs] = await Promise.all([
          digitApi.mdmsV2SearchRaw(root, 'common-masters.Department', { limit: 100 }),
          digitApi.mdmsV2SearchRaw(root, 'common-masters.Designation', { limit: 100 }),
        ]);
        const deptCode = depts[0]?.uniqueIdentifier
          || (depts[0]?.data as Record<string, unknown> | undefined)?.code as string | undefined;
        const desigCode = desigs[0]?.uniqueIdentifier
          || (desigs[0]?.data as Record<string, unknown> | undefined)?.code as string | undefined;

        if (!deptCode || !desigCode) {
          employeeResult.error = `Cannot seed HRMS employee: department/designation missing on root "${root}". Re-run tenant_bootstrap.`;
        } else {
          // Look up the admin user on the city so we get the right mobile
          // number / uuid / email to attach the employee record to.
          const cityUsers = await digitApi.userSearch(tenantId, { userName: adminUserName, limit: 1 });
          const adminOnCity = cityUsers[0];

          // Check if an HRMS employee already exists for this user. The user
          // search returns the user; we then probe HRMS to avoid duplicate
          // create attempts on idempotent re-runs.
          let alreadyExists = false;
          try {
            const existingEmployees = await digitApi.employeeSearch(tenantId, {
              codes: [adminUserName],
              limit: 1,
            });
            if (existingEmployees.length > 0) alreadyExists = true;
          } catch { /* HRMS search may 404 on a fresh tenant; treat as not-found */ }

          if (alreadyExists) {
            employeeResult.provisioned = true;
            employeeResult.code = adminUserName;
            employeeResult.department = deptCode;
            employeeResult.designation = desigCode;
          } else {
            // Step 3 already provisioned the ADMIN user (dual-scoped on root +
            // city). HRMS's employee_create normally also creates a user; we
            // need to *link* to the existing one instead so we don't trip the
            // "User already exists" duplicate-check. Search for the live user
            // record (with uuid) and inline it onto the employee payload.
            const cityAdminRecord = adminOnCity
              ?? (await digitApi.userSearch(root, { userName: adminUserName, limit: 1 }))[0]
              ?? null;

            // Roles must be scoped to the root tenant (where ACCESSCONTROL-ROLES
            // lives). Includes everything the PGR workflow gates on.
            const pgrRoles = ['EMPLOYEE', 'GRO', 'DGRO', 'PGR_LME', 'PGR_VIEWER', 'CSR', 'SUPERUSER', 'CITIZEN'].map((c) => ({
              code: c, name: c, tenantId: root,
            }));

            // Build the user inline. When we have an existing user we pass
            // the uuid + id so HRMS recognises this as a link, not a create.
            const userPayload: Record<string, unknown> = {
              name: (cityAdminRecord?.name as string) || 'Administrator',
              userName: adminUserName,
              mobileNumber: (cityAdminRecord?.mobileNumber as string) || '9999999999',
              emailId: (cityAdminRecord?.emailId as string) || null,
              gender: (cityAdminRecord?.gender as string) || 'MALE',
              type: 'EMPLOYEE',
              active: true,
              roles: pgrRoles,
              tenantId: root,
            };
            if (cityAdminRecord?.uuid) userPayload.uuid = cityAdminRecord.uuid;
            if (cityAdminRecord?.id) userPayload.id = cityAdminRecord.id;
            // Only set password on a fresh user — sending it for an existing
            // user is what trips DuplicateUserName on some HRMS builds.
            if (!cityAdminRecord?.uuid) {
              userPayload.password = process.env.CRS_PASSWORD || defaultProvisioningPassword();
            }

            const now = Date.now();
            const employee: Record<string, unknown> = {
              tenantId,
              employeeType: 'PERMANENT',
              employeeStatus: 'EMPLOYED',
              dateOfAppointment: now,
              code: adminUserName,
              IsActive: true,
              user: userPayload,
              assignments: [{
                department: deptCode,
                designation: desigCode,
                fromDate: now,
                isCurrentAssignment: true,
                isHOD: false,
              }],
              jurisdictions: [{
                hierarchy: 'ADMIN',
                boundaryType: 'City',
                boundary: tenantId,
                tenantId,
                isActive: true,
              }],
            };

            const created = await digitApi.employeeCreate(tenantId, [employee]);
            if (created.length > 0) {
              const c = created[0];
              employeeResult.provisioned = true;
              employeeResult.code = c.code as string | undefined;
              employeeResult.department = deptCode;
              employeeResult.designation = desigCode;

              // HRMS doesn't reliably set the user password — reset via user-service so login works.
              const user = c.user as Record<string, unknown> | undefined;
              if (user?.uuid) {
                try {
                  const users = await digitApi.userSearch(root, { uuid: [user.uuid as string], limit: 1 });
                  if (users.length > 0) {
                    await digitApi.userUpdate({ ...users[0], password: process.env.CRS_PASSWORD || defaultProvisioningPassword() });
                  }
                } catch { /* non-fatal */ }
              }
            }
          }
        }
      } catch (err) {
        employeeResult.error = err instanceof Error ? err.message : String(err);
      }
      steps.adminEmployee = employeeResult;

      return JSON.stringify({
        success: true,
        cityTenant: tenantId,
        root,
        steps,
        nextSteps: [
          `Create more employees: employee_create with tenant_id="${tenantId}"`,
          `Verify setup: validate_complaint_types, validate_employees with tenant_id="${tenantId}"`,
          `Create complaints: pgr_create with tenant_id="${tenantId}"`,
        ],
      }, null, 2);
    },
  } satisfies ToolMetadata);

  // tenant_cleanup — soft-delete all MDMS data and deactivate users for a tenant
  registry.register({
    name: 'tenant_cleanup',
    group: 'mdms',
    category: 'mdms',
    access: 'admin',
    risk: 'write',
    description:
      'Clean up a tenant by soft-deleting MDMS records OWNED by that tenant (isActive=false) ' +
      'and deactivating users. Records inherited from parent tenants are left untouched — only ' +
      'records whose own record.tenantId equals the passed tenant_id are deactivated. ' +
      'Follows the dataloader pattern: MDMS records are deactivated via the v2 _update API, not hard-deleted. ' +
      'Schema definitions are left in place (harmless without data). ' +
      'Use this to tear down test tenants created by tenant_bootstrap or city_setup_from_xlsx. ' +
      'SAFETY: runs read-only and returns a preview unless confirm=<tenant_id> is passed; ' +
      'root/state tenants (no dot) additionally require allow_root_tenant=true.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tenant_id: {
          type: 'string',
          description: 'Tenant ID whose OWN records to deactivate (e.g. "ke.poc-mzpt"). Inherited records are left alone.',
        },
        deactivate_users: {
          type: 'boolean',
          description: 'Also deactivate users on this tenant (default: true)',
        },
        schemas: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional: only touch specific schema codes. If omitted, all schemas owned by tenant_id.',
        },
        reactivate: {
          type: 'boolean',
          description: 'Recovery mode: instead of deactivating, set isActive=true on the matching records. ' +
            'Use this to undo a prior cleanup. Default: false (deactivate).',
        },
        confirm: {
          type: 'string',
          description: 'REQUIRED to actually deactivate: must exactly equal tenant_id. ' +
            'Without it the tool runs read-only and returns a preview of what would be deactivated.',
        },
        allow_root_tenant: {
          type: 'boolean',
          description: 'REQUIRED when tenant_id is a state/root tenant with no dot (e.g. "pg" rather than "pg.citya"). ' +
            'A root-tenant sweep affects the whole hierarchy, so it must be opted into explicitly.',
        },
      },
      required: ['tenant_id'],
    },
    handler: async (args) => {
      validateTenantId(args.tenant_id, 'tenant_id');

      // ── Destructive-operation guards (H1) ──
      // A root tenant ("pg") owns the records the whole hierarchy inherits, so
      // sweeping one is a platform-wide event. Require an explicit opt-in
      // before we authenticate or look up a single record.
      if (!(args.tenant_id as string).includes('.') && args.allow_root_tenant !== true) {
        return JSON.stringify({
          success: false,
          error:
            `"${args.tenant_id}" is a state/root tenant. Deactivating its own records affects every ` +
            'child tenant that inherits them. Pass allow_root_tenant: true if that is genuinely intended.',
          code: 'ROOT_TENANT_REQUIRES_OPT_IN',
        }, null, 2);
      }

      await ensureAuthenticated();

      const tenantId = args.tenant_id as string;
      const deactivateUsers = (args.deactivate_users as boolean) ?? true;
      const schemaFilter = args.schemas as string[] | undefined;
      const reactivate = (args.reactivate as boolean) ?? false;
      const targetActive = reactivate; // true=undo, false=deactivate
      const verb = reactivate ? 'reactivate' : 'deactivate';

      const results = {
        mdms: { deleted: 0, skipped: 0, failed: 0, schemas: {} as Record<string, number> },
        users: { deactivated: 0, failed: 0 },
      };

      emitProgress({
        phase: 'cleanup:start',
        message: `Cleaning up tenant "${tenantId}"`,
        data: { tenant_id: tenantId, deactivate_users: deactivateUsers, schemas: schemaFilter ?? null },
        pct: 0,
      });

      // Step 1: Search all MDMS data for the tenant
      // Paginate through all records (MDMS search is capped at limit per call)
      const allRecords: Array<{
        id: string; tenantId: string; schemaCode: string;
        uniqueIdentifier: string; data: Record<string, unknown>;
        isActive: boolean; auditDetails?: Record<string, unknown>;
      }> = [];
      let offset = 0;
      const pageSize = 500;

      emitProgress({ phase: 'mdms:search:start', message: 'Listing MDMS records to deactivate', pct: 5 });
      while (true) {
        const schemaCode = schemaFilter && schemaFilter.length === 1 ? schemaFilter[0] : '';
        const data = await digitApi.mdmsV2SearchRaw(tenantId, schemaCode, { limit: pageSize, offset });

        if (data.length === 0) break;
        allRecords.push(...data.map((r) => ({
          id: r.id,
          tenantId: r.tenantId,
          schemaCode: r.schemaCode,
          uniqueIdentifier: r.uniqueIdentifier,
          data: r.data,
          isActive: r.isActive,
          auditDetails: r.auditDetails as Record<string, unknown> | undefined,
        })));
        emitProgress({
          phase: 'mdms:search:page',
          message: `Fetched ${allRecords.length} records so far`,
          data: { fetched: allRecords.length, offset },
        });
        if (data.length < pageSize) break;
        offset += pageSize;
      }

      // CRITICAL: MDMS v2 search at a city tenant returns records inherited
      // from parent tenants (with their actual home tenantId on the record).
      // We must NOT deactivate those — they don't belong to the tenant we're
      // cleaning up. Only touch records whose record.tenantId exactly matches
      // the cleanup target.
      const inheritedSkipped = allRecords.length - allRecords.filter((r) => r.tenantId === tenantId).length;
      const ownedRecords = allRecords.filter((r) => r.tenantId === tenantId);

      // Filter by schemas if multiple were specified
      const filteredRecords = schemaFilter && schemaFilter.length > 1
        ? ownedRecords.filter((r) => schemaFilter.includes(r.schemaCode))
        : ownedRecords;

      // ── Confirmation gate (H1) ──
      // Everything above this point is read-only. Deactivation is irreversible
      // in practice for a live tenant, so unless the caller echoes the tenant
      // id back to us we stop here and report what WOULD happen. `reactivate`
      // is exempt: restoring records is additive, not destructive.
      if (!reactivate && args.confirm !== tenantId) {
        const breakdown: Record<string, number> = {};
        for (const r of filteredRecords) {
          if (r.isActive) breakdown[r.schemaCode] = (breakdown[r.schemaCode] || 0) + 1;
        }
        const activeCount = filteredRecords.filter((r) => r.isActive).length;
        return JSON.stringify({
          // NOT `success: true`. Every other tool uses that to mean "the thing
          // you asked for happened", and automation branches on it — reporting
          // a no-op as success is how a cleanup silently stops running.
          success: false,
          dry_run: true,
          code: 'CONFIRMATION_REQUIRED',
          message: `Preview only — nothing was changed. ${activeCount} active MDMS record(s) would be deactivated on "${tenantId}".`,
          tenantId,
          wouldDeactivate: {
            mdmsRecords: activeCount,
            alreadyInactive: filteredRecords.length - activeCount,
            bySchema: breakdown,
            users: deactivateUsers ? 'all users on this tenant' : 'none (deactivate_users=false)',
          },
          inheritedRecordsSkipped: inheritedSkipped,
          toProceed: { confirm: tenantId },
          hint: `Re-run with confirm: "${tenantId}" to apply. This preview performed no writes.`,
        }, null, 2);
      }

      emitProgress({
        phase: `mdms:${verb}:start`,
        message: `${reactivate ? 'Reactivating' : 'Deactivating'} ${filteredRecords.length} MDMS records`,
        data: { total: filteredRecords.length },
        pct: 10,
      });

      // Step 2: Flip isActive on each candidate record.
      // - deactivate mode: skip already-inactive, flip active→inactive
      // - reactivate mode: skip already-active, flip inactive→active
      let processed = 0;
      const reportEvery = Math.max(25, Math.floor(filteredRecords.length / 20) || 25);
      for (const record of filteredRecords) {
        if (record.isActive === targetActive) {
          results.mdms.skipped++;
        } else {
          try {
            await digitApi.mdmsV2Update(
              record as Parameters<typeof digitApi.mdmsV2Update>[0],
              targetActive
            );
            results.mdms.deleted++;
            results.mdms.schemas[record.schemaCode] = (results.mdms.schemas[record.schemaCode] || 0) + 1;
          } catch (delErr) {
            console.error(`[tenant_cleanup] Failed to ${verb} ${record.schemaCode}/${record.uniqueIdentifier}: ${delErr instanceof Error ? delErr.message : String(delErr)}`);
            results.mdms.failed++;
          }
        }
        processed++;
        if (processed % reportEvery === 0 || processed === filteredRecords.length) {
          const span = filteredRecords.length || 1;
          emitProgress({
            phase: `mdms:${verb}:progress`,
            message: `${processed}/${filteredRecords.length} processed (changed=${results.mdms.deleted}, skipped=${results.mdms.skipped}, failed=${results.mdms.failed})`,
            data: { processed, total: filteredRecords.length, ...results.mdms },
            pct: 10 + Math.floor((processed / span) * 75),
          });
        }
      }

      // Step 3: Flip users on this tenant in the same direction.
      // egov-user's _search 500s if you don't narrow by user_type, so we
      // iterate the three known types and union the results, deduping by
      // uuid. Per-type errors are surfaced in the response instead of being
      // silently swallowed.
      if (deactivateUsers) {
        emitProgress({ phase: `users:${verb}:start`, message: `${reactivate ? 'Reactivating' : 'Deactivating'} users on "${tenantId}"`, pct: 88 });
        const seen = new Set<string>();
        const collected: Record<string, unknown>[] = [];
        const userSearchErrors: string[] = [];
        for (const userType of ['EMPLOYEE', 'CITIZEN', 'SYSTEM']) {
          try {
            const batch = await digitApi.userSearch(tenantId, { limit: 100, userType });
            for (const u of batch) {
              const uuid = (u.uuid as string | undefined) || `${u.userName}:${u.type}`;
              if (seen.has(uuid)) continue;
              seen.add(uuid);
              collected.push(u);
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[tenant_cleanup] User search ${userType} failed for "${tenantId}": ${msg}`);
            userSearchErrors.push(`${userType}: ${msg}`);
          }
        }
        for (const user of collected) {
          if ((user.active as boolean) === targetActive) continue;
          try {
            await digitApi.userUpdate({ ...user, active: targetActive });
            results.users.deactivated++;
          } catch (userErr) {
            console.error(`[tenant_cleanup] Failed to ${verb} user ${user.userName}: ${userErr instanceof Error ? userErr.message : String(userErr)}`);
            results.users.failed++;
          }
        }
        if (userSearchErrors.length) {
          (results.users as Record<string, unknown>).search_errors = userSearchErrors;
        }
      }

      emitProgress({
        phase: 'cleanup:done',
        message: `${reactivate ? 'Reactivation' : 'Cleanup'} complete: ${results.mdms.deleted} records ${verb}d, ${results.users.deactivated} users ${verb}d`,
        data: { mdms: results.mdms, users: results.users },
        pct: 100,
      });

      return JSON.stringify({
        success: results.mdms.failed === 0 && results.users.failed === 0,
        tenantId,
        summary: {
          mdms_records_owned: filteredRecords.length,
          mdms_inherited_left_alone: inheritedSkipped,
          mdms_deleted: results.mdms.deleted,
          mdms_already_inactive: results.mdms.skipped,
          mdms_failed: results.mdms.failed,
          users_deactivated: results.users.deactivated,
          users_failed: results.users.failed,
        },
        schemas_affected: results.mdms.schemas,
        note: 'Only records whose tenantId exactly matches were deactivated. ' +
          'Records inherited from parent tenants were left untouched. ' +
          'Schema definitions are left in place.',
      }, null, 2);
    },
  } satisfies ToolMetadata);

  // mdms_create — create MDMS record
  registry.register({
    name: 'mdms_create',
    group: 'mdms',
    category: 'mdms',
    access: 'admin',
    risk: 'write',
    description:
      'Create a new MDMS v2 record. Requires tenant ID, schema code, unique identifier, and the data object. Use mdms_search first to verify the record does not already exist.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tenant_id: {
          type: 'string',
          description: 'Tenant ID to create in',
        },
        schema_code: {
          type: 'string',
          description: 'MDMS schema code',
        },
        unique_identifier: {
          type: 'string',
          description: 'Unique identifier for the record (usually the "code" field)',
        },
        data: {
          type: 'object',
          description: 'The data payload for the record',
        },
        dry_run: {
          type: 'boolean',
          description: 'If true, validate inputs and check prerequisites without executing. Returns a preview of what would happen.',
        },
      },
      required: ['tenant_id', 'schema_code', 'unique_identifier', 'data'],
    },
    handler: async (args) => {
      validateTenantId(args.tenant_id, 'tenant_id');
      validateResourceId(args.schema_code as string, 'schema_code');
      validateResourceId(args.unique_identifier as string, 'unique_identifier');

      const tenantId = args.tenant_id as string;
      const schemaCode = args.schema_code as string;
      const uniqueIdentifier = args.unique_identifier as string;
      const data = args.data as Record<string, unknown>;
      const dryRun = args.dry_run === true;

      if (dryRun) {
        const issues: string[] = [];

        if (!digitApi.isAuthenticated()) {
          issues.push('Not authenticated. Call "configure" first.');
        }

        return JSON.stringify({
          success: true,
          dry_run: true,
          valid: issues.length === 0,
          issues,
          preview: {
            tenantId,
            schemaCode,
            uniqueIdentifier,
            data,
          },
        }, null, 2);
      }

      await ensureAuthenticated();

      try {
        // Check if a record with this identifier already exists (may be inactive)
        const existing = await digitApi.mdmsV2SearchRaw(tenantId, schemaCode, {
          uniqueIdentifiers: [uniqueIdentifier],
          limit: 1,
        });

        if (existing.length > 0 && existing[0].isActive) {
          return JSON.stringify({
            success: true,
            message: `Record already exists and is active: ${uniqueIdentifier}`,
            alreadyExisted: true,
            record: {
              id: existing[0].id,
              tenantId: existing[0].tenantId,
              schemaCode: existing[0].schemaCode,
              uniqueIdentifier: existing[0].uniqueIdentifier,
              data: existing[0].data,
              isActive: existing[0].isActive,
            },
          }, null, 2);
        }

        if (existing.length > 0 && !existing[0].isActive) {
          // Re-activate the inactive record instead of creating (MDMS _create returns phantom 200 for inactive dupes)
          const reactivated = await digitApi.mdmsV2Update(existing[0], true);
          return JSON.stringify({
            success: true,
            message: `Reactivated inactive record: ${uniqueIdentifier}`,
            reactivated: true,
            record: {
              id: reactivated.id,
              tenantId: reactivated.tenantId,
              schemaCode: reactivated.schemaCode,
              uniqueIdentifier: reactivated.uniqueIdentifier,
              data: reactivated.data,
              isActive: reactivated.isActive,
            },
          }, null, 2);
        }

        // No existing record — create new
        const result = await digitApi.mdmsV2Create(
          tenantId,
          schemaCode,
          uniqueIdentifier,
          args.data as Record<string, unknown>
        );

        return JSON.stringify(
          {
            success: true,
            message: `Created MDMS record: ${result.uniqueIdentifier}`,
            record: {
              id: result.id,
              tenantId: result.tenantId,
              schemaCode: result.schemaCode,
              uniqueIdentifier: result.uniqueIdentifier,
              data: result.data,
              isActive: result.isActive,
            },
          },
          null,
          2
        );
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        const stateRoot = tenantId.includes('.') ? tenantId.split('.')[0] : tenantId;

        let hint: string;
        if (msg.includes('Schema definition') && msg.includes('not found')) {
          hint = `Schema "${schemaCode}" is not registered for the "${stateRoot}" tenant root. ` +
            `FIX: Call tenant_bootstrap with target_tenant="${stateRoot}" to install the versioned platform baseline. ` +
            `Or call mdms_schema_create with tenant_id="${stateRoot}", code="${schemaCode}", copy_from_tenant="pg".`;
        } else if (isDuplicateError(msg)) {
          hint = `Record already exists. Use mdms_search to find it.`;
        } else {
          hint = `MDMS create failed. Verify the tenant "${stateRoot}" has all required schemas registered. ` +
            `Call tenant_bootstrap with target_tenant="${stateRoot}" if this is a new tenant root.`;
        }

        return JSON.stringify({ success: false, error: msg, hint }, null, 2);
      }
    },
  } satisfies ToolMetadata);

  // ──────────────────────────────────────────
  // mdms_update — generic single-record patch
  // ──────────────────────────────────────────
  // Wraps digitApi.mdmsV2Update with the search-for-audit-details handshake
  // the v2 _update endpoint requires. Pass exactly one of `data` (full
  // replacement of the record's data block) or `patch` (shallow merge over
  // the existing data fields). Use `is_active` to flip active/inactive
  // independently of either; omit to keep the current value.
  registry.register({
    name: 'mdms_update',
    group: 'mdms',
    category: 'mdms',
    access: 'admin',
    risk: 'write',
    description:
      'Update an existing MDMS v2 record. Fetches the current record (for id + auditDetails), ' +
      'applies the requested change, and submits to _update. Pass `data` for full data replacement, ' +
      '`patch` for shallow merge, and/or `is_active` to flip active state.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tenant_id: {
          type: 'string',
          description: 'Tenant ID the record lives on (must match record.tenantId exactly — inherited records cannot be updated from a child tenant).',
        },
        schema_code: { type: 'string', description: 'MDMS schema code, e.g. "common-masters.MobileNumberValidation".' },
        unique_identifier: { type: 'string', description: 'The record\'s uniqueIdentifier.' },
        data: { type: 'object', description: 'Optional. Full replacement for the record\'s `data` block. Mutually exclusive with `patch`.' },
        patch: { type: 'object', description: 'Optional. Top-level keys to merge into existing data. Mutually exclusive with `data`.' },
        is_active: { type: 'boolean', description: 'Optional. Set true/false to flip active state. Omit to keep current.' },
      },
      required: ['tenant_id', 'schema_code', 'unique_identifier'],
    },
    handler: async (args) => {
      validateTenantId(args.tenant_id, 'tenant_id');
      validateResourceId(args.schema_code as string, 'schema_code');
      validateResourceId(args.unique_identifier as string, 'unique_identifier');

      if (args.data && args.patch) {
        return JSON.stringify({ success: false, error: '`data` and `patch` are mutually exclusive — pass one or the other.' }, null, 2);
      }
      if (!args.data && !args.patch && args.is_active === undefined) {
        return JSON.stringify({ success: false, error: 'Nothing to update. Provide `data`, `patch`, or `is_active`.' }, null, 2);
      }

      await ensureAuthenticated();

      const tenantId = args.tenant_id as string;
      const schemaCode = args.schema_code as string;
      const uniqueIdentifier = args.unique_identifier as string;

      // Fetch existing record. Must search at the tenant the record actually
      // lives on — MDMS won't let you _update an inherited record under a
      // child tenant's scope.
      const existing = await digitApi.mdmsV2SearchRaw(tenantId, schemaCode, {
        uniqueIdentifiers: [uniqueIdentifier],
        limit: 1,
      });
      if (existing.length === 0) {
        return JSON.stringify({
          success: false,
          error: `Record not found: ${schemaCode}/${uniqueIdentifier} at tenant "${tenantId}".`,
          hint: 'mdms_update only operates on records owned by the given tenant. If the record was inherited from a parent tenant, call mdms_update on the parent.',
        }, null, 2);
      }
      const record = existing[0];

      const newData =
        args.data !== undefined
          ? (args.data as Record<string, unknown>)
          : args.patch !== undefined
            ? { ...record.data, ...(args.patch as Record<string, unknown>) }
            : record.data;

      const newActive = args.is_active === undefined ? record.isActive : (args.is_active as boolean);

      try {
        const updated = await digitApi.mdmsV2Update(
          { ...record, data: newData },
          newActive,
        );
        return JSON.stringify({
          success: true,
          message: `Updated ${schemaCode}/${uniqueIdentifier}`,
          record: {
            id: updated.id,
            tenantId: updated.tenantId,
            schemaCode: updated.schemaCode,
            uniqueIdentifier: updated.uniqueIdentifier,
            data: updated.data,
            isActive: updated.isActive,
          },
        }, null, 2);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return JSON.stringify({ success: false, error: msg }, null, 2);
      }
    },
  } satisfies ToolMetadata);

  // ──────────────────────────────────────────
  // mdms_repair_identity — bulk rewrite identity fields
  // ──────────────────────────────────────────
  // Maintenance tool for SQL-imported tenants whose records carry stale
  // identity fields (e.g. data.tenantId="pg" on records that now live at
  // "ke"). tenant_bootstrap's create-time identity rewrite doesn't cover
  // this case — it only applies when copying records from source → target.
  registry.register({
    name: 'mdms_repair_identity',
    group: 'mdms',
    category: 'mdms',
    access: 'admin',
    risk: 'write',
    description:
      'Bulk-rewrite an identity field across all records of a schema at one tenant. ' +
      'For each matching record, sets data.<field> to `to_value` and (optionally) reactivates. ' +
      'Use this when records carry a stale tenant id from a SQL-dump import that predates ' +
      'tenant_bootstrap\'s identity rewriting.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tenant_id: { type: 'string', description: 'Tenant the records live on (their record.tenantId).' },
        schema_code: { type: 'string', description: 'MDMS schema to scan.' },
        field: { type: 'string', description: 'Identity field inside data to rewrite (default: "tenantId").' },
        from_value: { type: 'string', description: 'Existing value to look for. If omitted, every record whose `field` ≠ `to_value` is repaired.' },
        to_value: { type: 'string', description: 'Value to write (e.g. the correct tenant id).' },
        reactivate: { type: 'boolean', description: 'Also flip isActive=true on repaired records. Default true.' },
        dry_run: { type: 'boolean', description: 'If true, list what would be changed without writing.' },
      },
      required: ['tenant_id', 'schema_code', 'to_value'],
    },
    handler: async (args) => {
      validateTenantId(args.tenant_id, 'tenant_id');
      validateResourceId(args.schema_code as string, 'schema_code');

      await ensureAuthenticated();

      const tenantId = args.tenant_id as string;
      const schemaCode = args.schema_code as string;
      const field = (args.field as string | undefined) || 'tenantId';
      const fromValue = args.from_value as string | undefined;
      const toValue = args.to_value as string;
      const reactivate = (args.reactivate as boolean | undefined) ?? true;
      const dryRun = args.dry_run === true;

      type MdmsRow = Awaited<ReturnType<typeof digitApi.mdmsV2SearchRaw>>[number];
      const records: MdmsRow[] = [];
      let offset = 0;
      const pageSize = 500;
      while (true) {
        const page = await digitApi.mdmsV2SearchRaw(tenantId, schemaCode, { limit: pageSize, offset });
        if (page.length === 0) break;
        // Only repair records actually owned at this tenant — inherited ones live on the parent.
        for (const r of page) {
          if (r.tenantId !== tenantId) continue;
          records.push(r);
        }
        if (page.length < pageSize) break;
        offset += pageSize;
      }

      const candidates = records.filter((r) => {
        const current = r.data?.[field];
        if (fromValue !== undefined) return current === fromValue;
        return current !== undefined && current !== toValue;
      });

      if (dryRun) {
        return JSON.stringify({
          success: true,
          dry_run: true,
          tenant_id: tenantId,
          schema_code: schemaCode,
          scanned: records.length,
          to_repair: candidates.length,
          sample: candidates.slice(0, 5).map((r) => ({
            uniqueIdentifier: r.uniqueIdentifier,
            current: r.data?.[field],
            isActive: r.isActive,
          })),
        }, null, 2);
      }

      let repaired = 0;
      let failed = 0;
      const failures: string[] = [];
      for (const r of candidates) {
        const newData = { ...r.data, [field]: toValue };
        const targetActive = reactivate ? true : r.isActive;
        try {
          await digitApi.mdmsV2Update({ ...r, data: newData }, targetActive);
          repaired++;
        } catch (err) {
          failed++;
          if (failures.length < 10) {
            failures.push(`${r.uniqueIdentifier}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }

      return JSON.stringify({
        success: failed === 0,
        tenant_id: tenantId,
        schema_code: schemaCode,
        scanned: records.length,
        repaired,
        failed,
        failures,
      }, null, 2);
    },
  } satisfies ToolMetadata);

  // ──────────────────────────────────────────
  // boundary_entity_search — list entities by tenant + codes
  // ──────────────────────────────────────────
  // Thin wrapper around boundary-service /boundary/_search, independent of
  // egov-bndry-mgmnt (which 404s on tenants without bulk-mgmt history).
  // Used by tests/verifiers that need to assert entity presence + scoping.
  registry.register({
    name: 'boundary_entity_search',
    group: 'boundary',
    category: 'boundary-mgmt',
    risk: 'read',
    description:
      'Search boundary entities at a tenant. Direct call to boundary-service /boundary/_search, ' +
      'independent of egov-bndry-mgmnt. Returns the raw entity rows (id, tenantId, code, geometry, auditDetails).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tenant_id: { type: 'string', description: 'Tenant ID to search at.' },
        codes: { type: 'array', items: { type: 'string' }, description: 'Optional. Boundary entity codes to filter.' },
      },
      required: ['tenant_id'],
    },
    handler: async (args) => {
      validateTenantId(args.tenant_id, 'tenant_id');
      await ensureAuthenticated();
      const tenantId = args.tenant_id as string;
      const codes = (args.codes as string[] | undefined) ?? [];
      const entities = await digitApi.boundarySearch(tenantId, undefined, { codes });
      return JSON.stringify({
        success: true,
        tenantId,
        count: entities.length,
        entities,
      }, null, 2);
    },
  } satisfies ToolMetadata);

  // ──────────────────────────────────────────
  // boundary_entity_exists — primitive existence probe
  // ──────────────────────────────────────────
  // Per-code existence check. Cheap predicate for verify-before-write
  // flows in city_setup_from_xlsx and similar — avoids the race that
  // boundary-relationships/_create exposes when entity-batches are still
  // in Kafka.
  registry.register({
    name: 'boundary_entity_exists',
    group: 'boundary',
    category: 'boundary-mgmt',
    risk: 'read',
    description:
      'Return {exists: boolean} for a single boundary entity code at a tenant. ' +
      'Used as a verify-before-write probe to dodge the boundary-service Kafka/cache race.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tenant_id: { type: 'string' },
        code: { type: 'string' },
      },
      required: ['tenant_id', 'code'],
    },
    handler: async (args) => {
      validateTenantId(args.tenant_id, 'tenant_id');
      validateResourceId(args.code as string, 'code');
      await ensureAuthenticated();
      const tenantId = args.tenant_id as string;
      const code = args.code as string;
      try {
        const entities = await digitApi.boundarySearch(tenantId, undefined, { codes: [code] });
        const hit = (entities as Record<string, unknown>[]).find((e) => e.code === code);
        return JSON.stringify({
          success: true,
          tenantId,
          code,
          exists: Boolean(hit),
          entity: hit ?? null,
        }, null, 2);
      } catch (err) {
        return JSON.stringify({
          success: false,
          tenantId,
          code,
          exists: false,
          error: err instanceof Error ? err.message : String(err),
        }, null, 2);
      }
    },
  } satisfies ToolMetadata);

  // ──────────────────────────────────────────
  // validate_boundary_hierarchy — assert level sequence + scoping
  // ──────────────────────────────────────────
  // Consolidates the boundary-hierarchy assertion that test suites and
  // verifiers were rolling by hand: "the hierarchy named X at tenant Y
  // has these N levels in order, owned by Y (not inherited)."
  registry.register({
    name: 'validate_boundary_hierarchy',
    group: 'boundary',
    category: 'boundary-mgmt',
    risk: 'read',
    description:
      'Assert that a boundary hierarchy with the given `hierarchy_type` exists at `tenant_id` ' +
      'with the expected level sequence (and is owned by that tenant, not inherited). ' +
      'Returns a structured diff: missing levels, extra levels, mis-ordered levels, owner mismatch.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tenant_id: { type: 'string', description: 'Tenant ID to look up the hierarchy at.' },
        hierarchy_type: { type: 'string', description: 'Expected hierarchyType code, e.g. "ADMIN".' },
        expected_levels: {
          type: 'array',
          items: { type: 'string' },
          description: 'Expected boundary-type level names in topo order (root first).',
        },
      },
      required: ['tenant_id', 'hierarchy_type', 'expected_levels'],
    },
    handler: async (args) => {
      validateTenantId(args.tenant_id, 'tenant_id');
      await ensureAuthenticated();
      const tenantId = args.tenant_id as string;
      const hierarchyType = args.hierarchy_type as string;
      const expectedLevels = args.expected_levels as string[];

      const hierarchies = await digitApi.boundaryHierarchySearch(tenantId, hierarchyType);
      if (hierarchies.length === 0) {
        return JSON.stringify({
          success: true,
          valid: false,
          tenantId,
          hierarchy_type: hierarchyType,
          reason: `No hierarchy named "${hierarchyType}" found at tenant "${tenantId}".`,
        }, null, 2);
      }

      // Pick the one whose tenantId matches exactly (defensive against
      // future cases where search returns inherited matches).
      const owned = (hierarchies as Record<string, unknown>[]).find((h) => h.tenantId === tenantId);
      const h = (owned ?? hierarchies[0]) as Record<string, unknown>;
      const ownerMatches = h.tenantId === tenantId;
      const levels = (h.boundaryHierarchy as Array<{ boundaryType: string }> | undefined) ?? [];
      const actualLevels = levels.map((l) => l.boundaryType);

      const missing = expectedLevels.filter((l) => !actualLevels.includes(l));
      const extra = actualLevels.filter((l) => !expectedLevels.includes(l));
      const orderMatches = JSON.stringify(actualLevels) === JSON.stringify(expectedLevels);
      const valid = ownerMatches && missing.length === 0 && extra.length === 0 && orderMatches;

      return JSON.stringify({
        success: true,
        valid,
        tenantId,
        hierarchy_type: hierarchyType,
        owner_actual: h.tenantId,
        owner_matches: ownerMatches,
        expected_levels: expectedLevels,
        actual_levels: actualLevels,
        missing,
        extra,
        order_matches: orderMatches,
      }, null, 2);
    },
  } satisfies ToolMetadata);

  // ──────────────────────────────────────────
  // tenant_destroy — true inverse of city_setup_from_xlsx
  // ──────────────────────────────────────────
  // tenant_cleanup correctly leaves inherited records alone, but
  // city_setup_from_xlsx writes some city-relevant records (depts, desigs,
  // complaint types, the tenant.tenants registration itself) AT THE ROOT
  // — so a city-level cleanup can't reach them. tenant_destroy adds a
  // best-effort second pass: given the city's tenant_id and (optionally)
  // explicit codes to remove at root, it deactivates those root-level
  // records too, then runs the standard city-level cleanup.
  registry.register({
    name: 'tenant_destroy',
    group: 'mdms',
    category: 'mdms',
    access: 'admin',
    risk: 'write',
    description:
      'Tear down a city tenant that was created with city_setup_from_xlsx. ' +
      'Runs the standard city-level cleanup (deactivates city-owned records + users) ' +
      'AND deactivates the named root-level records (depts/desigs/complaint types/tenant.tenants entry) ' +
      'that city_setup_from_xlsx writes outside the city scope.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tenant_id: { type: 'string', description: 'The city tenant_id to destroy, e.g. "ke.maputopoc".' },
        department_codes: { type: 'array', items: { type: 'string' }, description: 'Department codes (at root) to deactivate. From the masters XLSX.' },
        designation_codes: { type: 'array', items: { type: 'string' }, description: 'Designation codes (at root) to deactivate.' },
        complaint_type_codes: { type: 'array', items: { type: 'string' }, description: 'Complaint type (RAINMAKER-PGR.ComplaintHierarchy leaf) codes (at root) to deactivate.' },
        remove_tenant_registration: { type: 'boolean', description: 'Also deactivate the tenant.tenants record for this city at the root. Default true.' },
        dry_run: { type: 'boolean' },
      },
      required: ['tenant_id'],
    },
    handler: async (args) => {
      validateTenantId(args.tenant_id, 'tenant_id');
      await ensureAuthenticated();
      const cityTenant = args.tenant_id as string;
      const rootTenant = cityTenant.includes('.') ? cityTenant.split('.')[0] : cityTenant;
      if (cityTenant === rootTenant) {
        return JSON.stringify({
          success: false,
          error: `tenant_id "${cityTenant}" looks like a root tenant. tenant_destroy is for cities; refuse to operate on roots.`,
        }, null, 2);
      }
      const cityCode = cityTenant.split('.').slice(1).join('.');
      const deptCodes = (args.department_codes as string[] | undefined) ?? [];
      const desigCodes = (args.designation_codes as string[] | undefined) ?? [];
      const ctCodes = (args.complaint_type_codes as string[] | undefined) ?? [];
      const removeRegistration = (args.remove_tenant_registration as boolean | undefined) ?? true;
      const dryRun = args.dry_run === true;

      const rootRecordsToDeactivate: Array<{ schemaCode: string; uniqueIdentifier: string }> = [];
      for (const code of deptCodes) {
        rootRecordsToDeactivate.push({ schemaCode: 'common-masters.Department', uniqueIdentifier: code });
      }
      for (const code of desigCodes) {
        rootRecordsToDeactivate.push({ schemaCode: 'common-masters.Designation', uniqueIdentifier: code });
      }
      for (const code of ctCodes) {
        // Complaint types are LEAF rows of the single RAINMAKER-PGR.ComplaintHierarchy
        // adjacency-list master. The leaf row's uniqueIdentifier (code) IS the serviceCode.
        rootRecordsToDeactivate.push({ schemaCode: 'RAINMAKER-PGR.ComplaintHierarchy', uniqueIdentifier: code });
      }
      if (removeRegistration) {
        rootRecordsToDeactivate.push({ schemaCode: 'tenant.tenants', uniqueIdentifier: cityCode });
      }

      if (dryRun) {
        return JSON.stringify({
          success: true,
          dry_run: true,
          city_tenant: cityTenant,
          root_tenant: rootTenant,
          city_cleanup: 'would call tenant_cleanup at city',
          root_records_to_deactivate: rootRecordsToDeactivate,
        }, null, 2);
      }

      const rootResults = { deactivated: 0, missing: 0, failed: 0, errors: [] as string[] };
      for (const r of rootRecordsToDeactivate) {
        try {
          const found = await digitApi.mdmsV2SearchRaw(rootTenant, r.schemaCode, {
            uniqueIdentifiers: [r.uniqueIdentifier],
            limit: 1,
          });
          if (found.length === 0 || found[0].tenantId !== rootTenant) {
            rootResults.missing++;
            continue;
          }
          if (!found[0].isActive) {
            rootResults.deactivated++; // already done
            continue;
          }
          await digitApi.mdmsV2Update(found[0], false);
          rootResults.deactivated++;
        } catch (err) {
          rootResults.failed++;
          if (rootResults.errors.length < 10) {
            rootResults.errors.push(`${r.schemaCode}/${r.uniqueIdentifier}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      }

      // City-side cleanup: deactivate any MDMS records owned at the city
      // (e.g. the boundary hierarchy definition). The existing
      // tenant_cleanup tool already does the safe city-only filter, but
      // its handler isn't exposed as a callable from another handler — so
      // we inline the equivalent paginated search + filter.
      type MdmsRowAlias = Awaited<ReturnType<typeof digitApi.mdmsV2SearchRaw>>[number];
      const cityRecords: MdmsRowAlias[] = [];
      let cityOffset = 0;
      while (true) {
        const page = await digitApi.mdmsV2SearchRaw(cityTenant, '', { limit: 500, offset: cityOffset });
        if (page.length === 0) break;
        for (const rec of page) {
          if (rec.tenantId === cityTenant) cityRecords.push(rec);
        }
        if (page.length < 500) break;
        cityOffset += 500;
      }

      const cityResults = { deactivated: 0, failed: 0 };
      for (const rec of cityRecords) {
        if (!rec.isActive) continue;
        try {
          await digitApi.mdmsV2Update(rec, false);
          cityResults.deactivated++;
        } catch {
          cityResults.failed++;
        }
      }

      return JSON.stringify({
        success: rootResults.failed === 0 && cityResults.failed === 0,
        city_tenant: cityTenant,
        root_tenant: rootTenant,
        root: rootResults,
        city: cityResults,
        note: 'tenant_destroy did NOT touch users (use tenant_cleanup for that) ' +
          'and did NOT delete boundary entities (boundary-service lacks a delete API). ' +
          'Boundary hierarchy + relationships are also left in place; recreating with the same hierarchyType is idempotent.',
      }, null, 2);
    },
  } satisfies ToolMetadata);

  // ──────────────────────────────────────────
  // city_setup_from_xlsx — xlsx-based tenant setup
  // ──────────────────────────────────────────
  registry.register({
    name: 'city_setup_from_xlsx',
    group: 'mdms',
    category: 'mdms',
    access: 'admin',
    risk: 'write',
    description:
      'Set up a city tenant from xlsx files in CCRS dataloader format. ' +
      'Processes up to 4 phases in order: Tenant info, Boundaries, Common Masters (departments, ' +
      'designations, complaint types), and Employees. Each file is optional — provide only the ' +
      'phases you need. Files can be local paths or DIGIT filestore IDs (UUID format).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tenant_id: {
          type: 'string',
          description: 'Target city tenant ID (e.g. "pg.newcity"). Must contain a dot.',
        },
        tenant_file: {
          type: 'string',
          description:
            'Local path or fileStoreId for Tenant & Branding xlsx. ' +
            'Expected sheets: "Tenant Info" (required), "Tenant Branding Details" (optional).',
        },
        boundary_file: {
          type: 'string',
          description:
            'Local path or fileStoreId for Boundary xlsx. ' +
            'Uploaded to filestore and processed via boundary management service.',
        },
        boundary_geojson_file: {
          type: 'string',
          description:
            'OPTIONAL sidecar: local path or fileStoreId for a GeoJSON FeatureCollection that supplies ' +
            'real Polygon / MultiPolygon outlines for boundary entities (so the citizen UI can render them ' +
            'on the OSM map). Each feature is matched to a boundary by `properties.code` (preferred) or by ' +
            'normalized `properties.name` (fallback: lowercase, strip diacritics, replace non-alphanumerics ' +
            'with underscore, strip "Distrito Municipal de " prefix). Falls back to per-row lat/long, then ' +
            'to digit-api Point[0,0] default.',
        },
        masters_file: {
          type: 'string',
          description:
            'Local path or fileStoreId for Common & Complaint Masters xlsx. ' +
            'Expected sheets: "Department And Designation Master", "Complaint Type Master".',
        },
        employee_file: {
          type: 'string',
          description:
            'Local path or fileStoreId for Employee Master xlsx. ' +
            'Expected sheet: "Employee Master".',
        },
      },
      required: ['tenant_id'],
    },
    handler: async (args) => {
      await ensureAuthenticated();

      const tenantId = args.tenant_id as string;
      const tenantFile = args.tenant_file as string | undefined;
      const boundaryFile = args.boundary_file as string | undefined;
      const boundaryGeojsonFile = args.boundary_geojson_file as string | undefined;
      const mastersFile = args.masters_file as string | undefined;
      const employeeFile = args.employee_file as string | undefined;

      // Validate tenant_id format
      if (!tenantId.includes('.')) {
        return JSON.stringify({
          success: false,
          error: `tenant_id "${tenantId}" must contain a dot (e.g. "pg.newcity"). ` +
            'Use tenant_bootstrap for state-level root tenants.',
        }, null, 2);
      }

      // At least one file must be provided
      if (!tenantFile && !boundaryFile && !mastersFile && !employeeFile) {
        return JSON.stringify({
          success: false,
          error: 'At least one file parameter must be provided (tenant_file, boundary_file, masters_file, or employee_file).',
        }, null, 2);
      }

      // GeoJSON sidecar only makes sense alongside a boundary file
      if (boundaryGeojsonFile && !boundaryFile) {
        return JSON.stringify({
          success: false,
          error: 'boundary_geojson_file requires boundary_file (the sidecar only attaches geometry to rows defined in the XLSX).',
        }, null, 2);
      }

      try {
        const result = await loadFromXlsx({
          tenant_id: tenantId,
          tenant_file: tenantFile,
          boundary_file: boundaryFile,
          boundary_geojson_file: boundaryGeojsonFile,
          masters_file: mastersFile,
          employee_file: employeeFile,
        });
        return JSON.stringify(result, null, 2);
      } catch (error) {
        return JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : String(error),
          hint: 'If files are local paths, ensure they exist and are readable. ' +
            'If fileStoreIds, ensure the files were uploaded to DIGIT filestore first.',
        }, null, 2);
      }
    },
  } satisfies ToolMetadata);
}

// Auto-login helper using environment variables
