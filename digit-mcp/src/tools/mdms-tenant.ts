import type { ToolMetadata, MdmsRecord } from '../types/index.js';
import { MDMS_SCHEMAS } from '../types/index.js';
import type { ToolRegistry } from './registry.js';
import { digitApi } from '../services/digit-api.js';
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
const SCHEMAS_EMPTY_IS_A_PROBLEM = new Set([
  'dss.KpiDefinition',
  'dss.DashboardPack',
  'INBOX.InboxQueryConfiguration',
  'ACCESSCONTROL-ROLEACTIONS.roleactions',
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
    risk: 'read',
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
      },
    },
    handler: async (args) => {
      const baseUrl = args.base_url as string | undefined;
      const envKey = (args.environment as string) || process.env.CRS_ENVIRONMENT || 'self-hosted';

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
      const username = (args.username as string) || process.env.CRS_USERNAME;
      const password = (args.password as string) || process.env.CRS_PASSWORD;
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
              `Default password is "eGov@123".`,
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
      // the user lacks roles for the target root. Auto-add them so that direct API login
      // (e.g. from a frontend) also works for the target tenant.
      let rolesProvisioned: string[] | null = null;
      if (explicitRoot && usedLoginTenant !== explicitRoot && usedLoginTenant !== explicitTenantId) {
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

            const standardRoles = ['CITIZEN', 'EMPLOYEE', 'CSR', 'GRO', 'PGR_LME', 'DGRO', 'SUPERUSER'];
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

  // tenant_bootstrap — copy ALL schemas + essential data from an existing tenant root to a new one
  registry.register({
    name: 'tenant_bootstrap',
    group: 'mdms',
    category: 'mdms',
    risk: 'write',
    description:
      'Bootstrap a new state-level tenant root by copying ALL schemas and essential MDMS data from an existing tenant (e.g. "pg"). ' +
      'This is REQUIRED before creating employees, PGR complaints, or any service under a new tenant root. ' +
      'Copies: all schema definitions, IdFormat records, Department records, Designation records, StateInfo, and InboxQueryConfiguration. ' +
      'Also provisions an ADMIN user on the new tenant and copies workflow definitions (PGR, etc.) from source. ' +
      'After bootstrap, use city_setup to create city-level tenants. ' +
      'Call this ONCE when you create a new tenant root (e.g. "tenant", "ke") before doing anything else under it.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        target_tenant: {
          type: 'string',
          description: 'The new tenant root to bootstrap (e.g. "tenant", "ke")',
        },
        source_tenant: {
          type: 'string',
          description: 'Existing tenant root to copy from (default: "pg")',
        },
        mobile_regex: {
          type: 'string',
          description:
            'Mobile-number regex stored as mobileNumberRegex in the synthesized ' +
            'common-masters.MobileNumberValidation record. Inherited from the source tenant\'s ' +
            'MobileNumberValidation when omitted. Default "^[6-9][0-9]{9}$" (India 10-digit). ' +
            'Kenya: "^[17][0-9]{8}$". Mozambique: "^8[0-9]{8}$".',
        },
        mobile_length: {
          type: 'integer',
          description:
            'Mobile-number length used to generate a conforming ADMIN mobile number when ' +
            'admin_mobile is not supplied. Default 10 (India). Kenya/Mozambique: 9. ' +
            'Ignored when user_validation is supplied.',
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
            'Serviceable postal codes, seeded as `pincode` on every active tenant.tenants record ' +
            'under the target root. The citizen UI vetoes complaint submission when a typed postal ' +
            'code falls outside a configured allowlist (CS_COMMON_PINCODE_NOT_SERVICABLE), so only ' +
            'set this with real local postal codes for the deployment\'s country. Omit for no ' +
            'allowlist — every postal code is then serviceable. Never seed an empty array: mdms-v2 ' +
            'rejects pincode: [] on update; absence is the off state.',
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
      },
        user_only: {
          type: 'boolean',
          description:
            'When true, skip all MDMS copy steps and only re-create the ADMIN user on ' +
            'target_tenant. Called after post-bootstrap changes STATE_LEVEL_TENANT_ID ' +
            'from pg to the real state root so the user is stored with the correct enc key.',
        },
      required: ['target_tenant'],
    },
    handler: async (args) => {
      validateTenantId(args.target_tenant, 'target_tenant');
      if (args.source_tenant) validateTenantId(args.source_tenant, 'source_tenant');

      const target = args.target_tenant as string;
      const source = (args.source_tenant as string) || 'pg';

      // Register the target with egov-enc-service BEFORE anything below needs
      // to encrypt/decrypt for it (Step 4's ADMIN user creation, in particular).
      // egov-enc-service only knows tenants discovered via an MDMS search
      // scoped to its own STATE_LEVEL_TENANT_ID — a brand-new root is invisible
      // to it otherwise, and encrypt/decrypt throws "Tenant Id not found".
      // Non-fatal: if enc-service is unreachable, let the rest of bootstrap
      // proceed and surface the real error at whichever step needs it.
      try {
        await digitApi.generateEncKey(target);
      } catch (e) {
        console.error(`[tenant_bootstrap] enc-service key generation failed for "${target}": ${e instanceof Error ? e.message : String(e)}`);
      }

      if (args.user_only) {
        const mobileRegex = (args.mobile_regex as string) || '^[6-9][0-9]{9}$';
        const stateTenantForEviction = target.includes('.') ? target.split('.')[0] : target;
        await evictValidationCache(stateTenantForEviction);

        let userProvisioned: { username: string; tenantId: string; roles: string[] } | null = null;
        let userProvisionError: string | null = null;
        try {
          const currentUsername = process.env.CRS_USERNAME || 'ADMIN';
          const currentPassword = process.env.CRS_PASSWORD || 'eGov@123';
          const mobileNumber = deriveValidMobile(
            mobileRegex,
            Number(args.mobile_length) || 10,
            (args.admin_mobile as string) || undefined,
          );
          const standardRoles = [
            { code: 'EMPLOYEE', name: 'Employee' },
            { code: 'CITIZEN', name: 'Citizen' },
            { code: 'CSR', name: 'CSR' },
            { code: 'GRO', name: 'Grievance Routing Officer' },
            { code: 'PGR_LME', name: 'PGR Last Mile Employee' },
            { code: 'DGRO', name: 'Department GRO' },
            { code: 'SUPERUSER', name: 'Super User' },
            { code: 'INTERNAL_MICROSERVICE_ROLE', name: 'Internal Microservice Role' },
          ].map((r) => ({ ...r, tenantId: target }));
          const newUser = {
            name: 'Admin',
            mobileNumber,
            userName: currentUsername,
            password: currentPassword,
            type: 'EMPLOYEE',
            active: true,
            roles: standardRoles,
            tenantId: target,
          };
          // user_only is only ever called after a full bootstrap already created
          // this user (see the ansible "post-bootstrap — re-provision ADMIN"
          // tasks) — it always exists here, so update in place to re-encrypt
          // password/mobileNumber under whichever enc key is currently active,
          // rather than attempting userCreate and string-matching the resulting
          // error to detect the duplicate it will always be.
          const existing = await digitApi.userSearch(target, { userName: currentUsername, limit: 1 });
          if (existing[0]) {
            await digitApi.userUpdate({ ...existing[0], ...newUser });
          } else {
            await digitApi.userCreate(newUser, target);
          }
          userProvisioned = { username: currentUsername, tenantId: target, roles: standardRoles.map((r) => r.code) };
        } catch (error) {
          userProvisionError = error instanceof Error ? error.message : String(error);
        }
        return JSON.stringify({
          success: true,
          user_only: true,
          admin_user_provisioned: !!userProvisioned,
          admin_user_provisioned_details: userProvisioned,
          admin_user_provision_error: userProvisionError || undefined,
        }, null, 2);
      }

      await ensureAuthenticated();
      if (!args.mobile_regex || !args.mobile_prefix) {
        // When regex or prefix are not explicit (e.g. the bootstrap wizard only
        // sends target_tenant + source_tenant), inherit from the SOURCE tenant's
        // common-masters.MobileNumberValidation so the derived ADMIN mobile and
        // the seeded rule match what the target will enforce.
        try {
          const mnv = await digitApi.mdmsV2SearchRaw(source, 'common-masters.MobileNumberValidation', { limit: 50 });
          const defaultRecord = (mnv || []).find((r: any) => r?.data?.default === true) || (mnv || [])[0];
          if (defaultRecord?.data) {
            if (!args.mobile_regex && (defaultRecord.data as any).mobileNumberRegex) {
              (args as any).mobile_regex = (defaultRecord.data as any).mobileNumberRegex;
            }
            if (!args.mobile_prefix && (defaultRecord.data as any).countryCode) {
              (args as any).mobile_prefix = (defaultRecord.data as any).countryCode;
            }
          }
        } catch (e) {
          /* no MobileNumberValidation at source -> fall through to the generic default */
        }
      }
      const mobileRegex = (args.mobile_regex as string) || '^[6-9][0-9]{9}$';

      const results: {
        schemas: { copied: string[]; skipped: string[]; failed: string[] };
        data: { copied: string[]; skipped: string[]; failed: string[] };
        warnings: string[];
      } = {
        schemas: { copied: [], skipped: [], failed: [] },
        data: { copied: [], skipped: [], failed: [] },
        warnings: [],
      };

      emitProgress({ phase: 'bootstrap:start', message: `Bootstrapping ${target} from ${source}`, data: { source, target }, pct: 0 });

      // Step 1: Copy ALL schemas from source to target
      //
      // Some source schemas are missing a non-empty `x-unique` array — typically
      // legacy schemas seeded outside the mdms-v2 schema-create API (e.g. the
      // PGR `Workflow.BusinessServiceMasterConfig` shipped in the dump has no
      // `x-unique`). mdms-v2 rejects writes of these with
      //   "Unique attribute list cannot be empty"
      // which is a 400 SCHEMA_VALIDATION error, NOT a duplicate. Surface it as
      // a skip-with-reason rather than blindly attempting a write that we know
      // will fail; the operator gets a clean signal in `results.schemas.skipped`
      // (with the empty-x-unique reason) instead of a noisy `failed` entry that
      // looks like a bootstrap regression.
      emitProgress({ phase: 'schemas:start', message: 'Copying MDMS schema definitions', pct: 5 });
      const sourceSchemas = await digitApi.mdmsSchemaSearch(source);
      for (const schema of sourceSchemas) {
        const code = schema.code as string;
        const definition = schema.definition as Record<string, unknown>;
        const description = (schema.description as string) || code;
        const xUnique = (definition as { 'x-unique'?: unknown })['x-unique'];
        if (!Array.isArray(xUnique) || xUnique.length === 0) {
          results.schemas.skipped.push(`${code} (source lacks x-unique — mdms-v2 would reject)`);
          continue;
        }
        try {
          await digitApi.mdmsSchemaCreate(target, code, description, definition);
          results.schemas.copied.push(code);
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          if (isDuplicateError(msg)) {
            results.schemas.skipped.push(code);
          } else {
            results.schemas.failed.push(`${code}: ${msg}`);
          }
        }
      }

      emitProgress({
        phase: 'schemas:done',
        message: `Schemas copied (${results.schemas.copied.length} new, ${results.schemas.skipped.length} existing, ${results.schemas.failed.length} failed)`,
        data: {
          copied: results.schemas.copied.length,
          skipped: results.schemas.skipped.length,
          failed: results.schemas.failed.length,
        },
        pct: 25,
      });

      // Step 2: Create the tenant.tenants self-record.
      //
      // The `tenant.tenants` schema definition only lives at the tenant's
      // ROOT scope (e.g. `mz`) — there is no `tenant.tenants` schema at
      // `mz.maputo`. A write whose tenantId is the city would return
      // SCHEMA_DEFINITION_NOT_FOUND_ERR (silently swallowed into
      // results.data.failed, surfaced to operators only as a missing
      // dropdown entry in the employee UI later on).
      //
      // For root target (no dot): write at root scope, bare-code uid.
      // For city target (dotted): write at root scope, uid `Tenant.<city>`
      // — matches the convention used by city_setup elsewhere in this file.
      // Services like idgen resolve city codes via v1 MDMS using the tenant
      // prefix as root, so the row must live under root either way.
      const isCityTarget = target.includes('.');
      const tenantsScope = isCityTarget ? target.split('.')[0] : target;
      const tenantsUid = isCityTarget ? `Tenant.${target}` : target;
      // The tenant.tenants schema requires these top-level keys: code,
      // name, domainUrl, type, imageId, emailId, OfficeTimings, city,
      // address, contactNumber — and city requires name, districtName,
      // districtTenantCode, ulbGrade, code. A payload missing any one
      // gets rejected with a schema-validation 400 that doesn't match
      // the DUPLICATE/unique catch pattern below, so the write lands
      // silently in results.data.failed and the employee login dropdown
      // ends up with no entry for the new tenant.
      const tenantsPayload: Record<string, unknown> = {
        code: target,
        name: target,
        type: isCityTarget ? 'CITY' : 'State',
        domainUrl: 'https://www.digit.org',
        imageId: null,
        emailId: `${target}@example.com`,
        address: `${target} address`,
        contactNumber: '0000000000',
        OfficeTimings: { 'Mon - Fri': '9.00 AM - 6.00 PM' },
        description: isCityTarget ? `City tenant: ${target}` : `State tenant root: ${target}`,
        tenantId: target,
        city: {
          code: target.toUpperCase(),
          name: target,
          districtCode: tenantsScope.toUpperCase(),
          districtName: tenantsScope,
          districtTenantCode: target,
          ulbGrade: isCityTarget ? 'Municipal Corporation' : 'State',
        },
      };
      if (isCityTarget) {
        tenantsPayload.parent = tenantsScope;
      }
      try {
        await digitApi.mdmsV2Create(tenantsScope, 'tenant.tenants', tenantsUid, tenantsPayload);
        results.data.copied.push(`tenant.tenants/${target} (self-record)`);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (isDuplicateError(msg)) {
          results.data.skipped.push(`tenant.tenants/${target} (self-record)`);
        } else {
          results.data.failed.push(`tenant.tenants/${target}: ${msg}`);
        }
      }

      // Step 3: Copy essential MDMS data records.
      //
      // Order matters: ACCESSCONTROL-ACTIONS-TEST.actions-test must land before
      // ACCESSCONTROL-ROLEACTIONS.roleactions (the latter x-refs action ids in
      // the former), and ACCESSCONTROL-ROLES.roles must land before user
      // provisioning in Step 4 (user-service validates role codes against MDMS).
      //
      // What's NOT on this list: anything genuinely tenant-scoped (boundary
      // localities, locality-overrides). Schema definitions for those are
      // copied in Step 1 but their data is owned by the city setup flow.
      const essentialSchemas = [
        // ── access control: actions → roles → role↔action mappings ──
        // Without roleactions on the new tenant, digit-ui's startup MDMS read
        // returns empty and the employee landing renders blank. The earlier
        // "shared via access-control service" rationale was wrong — the UI
        // reads role→action mappings directly from MDMS at the target tenant.
        'ACCESSCONTROL-ACTIONS-TEST.actions-test',
        'ACCESSCONTROL-ROLES.roles',
        // ── tenant module discovery ──
        // citymodule rows tell the UI which modules (PGR/HRMS/etc.) are
        // available on the tenant; without them the citizen menu is empty.
        'tenant.citymodule',
        // ── ID generators ──
        'common-masters.IdFormat',
        // ── HRMS reference data ──
        'common-masters.Department',
        'common-masters.Designation',
        'common-masters.GenderType',
        'egov-hrms.EmployeeStatus',
        'egov-hrms.EmployeeType',
        'egov-hrms.DeactivationReason',
        'egov-hrms.Degree',
        'egov-hrms.EmploymentTest',
        'egov-hrms.Specalization',
        // ── DataSecurity ──
        // Required by services that embed egov-enc-service (inbox, PGR, user).
        // Without these, encryption policy @PostConstruct init fails and the
        // service won't start.
        'DataSecurity.DecryptionABAC',
        'DataSecurity.EncryptionPolicy',
        'DataSecurity.SecurityPolicy',
        'DataSecurity.MaskingPatterns',
        // ── branding + UI shell ──
        'common-masters.StateInfo',
        'common-masters.uiHomePage',
        'common-masters.wfSlaConfig',
        'common-masters.CronJobAPIConfig',
        'common-masters.ThemeConfig',
        // ── PGR ──
        // ComplaintHierarchy (complaint types + grouping nodes) is intentionally
        // excluded: it is tenant-specific and must be loaded by the operator via
        // Phase 3 of the configurator. Copying it from the source (pg.citest)
        // would pollute the target with unrelated demo/test complaint types.
        'RAINMAKER-PGR.UIConstants',
        // ── workflow (definition is copied separately in Step 6 below;
        //    these are the MDMS-side companion configs) ──
        'Workflow.BusinessService',
        'Workflow.BusinessServiceConfig',
        'Workflow.BusinessServiceMasterConfig',
        'Workflow.AutoEscalation',
        'Workflow.AutoEscalationStatesToIgnore',
        // ── inbox ──
        'INBOX.InboxQueryConfiguration',
        // ── dashboard analytics catalog ──
        // KPI defs and packs are platform-level definitions (queries + viz +
        // role visibility) with no tenant identity inside — without them a new
        // root gets a working dashboard shell but an empty catalog ("no tiles
        // in the catalog pack for this role"). Complaint-type–specific data
        // (ServiceDefs/ComplaintHierarchy) stays operator-owned; these are not.
        'dss.KpiDefinition',
        'dss.DashboardPack',
        // Per-tenant dashboard config: nav/route role gate (allowedRoles,
        // #1258) + number display mask (numberFormat, #1213). Nothing else
        // seeds this master on a new root — without it both features silently
        // fall back to built-in behavior.
        'dss.DashboardConfig',
        'ACCESSCONTROL-ROLEACTIONS.roleactions',
      ];

      // The MDMS schema definition + data writes go through Kafka and there's
      // a window (~0.5–3s) after schema create where data create returns
      // SCHEMA_DEFINITION_NOT_FOUND_ERR even though the schema was just copied
      // in Step 1. Retry a small number of times before declaring the record
      // a failure. The dataloader had this fix; the MCP didn't.
      async function mdmsCreateWithSchemaWait(
        tenant: string,
        schemaCode: string,
        uniqueIdentifier: string,
        data: Record<string, unknown>,
      ): Promise<void> {
        const maxAttempts = 4;
        let lastErr: unknown;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          try {
            await digitApi.mdmsV2Create(tenant, schemaCode, uniqueIdentifier, data);
            return;
          } catch (err) {
            lastErr = err;
            const msg = err instanceof Error ? err.message : String(err);
            const isSchemaRace =
              msg.includes('SCHEMA_DEFINITION_NOT_FOUND_ERR') ||
              msg.includes('Schema definition against which data is being created is not found') ||
              // Schema was just created via Kafka — uniqueIdentifier computation fails transiently
              // until the schema definition propagates. Retry with backoff.
              msg.includes('Values defined against unique fields cannot be empty');
            if (!isSchemaRace || attempt === maxAttempts - 1) throw err;
            await new Promise((res) => setTimeout(res, 500 * (1 << attempt))); // 500ms, 1s, 2s
          }
        }
        throw lastErr;
      }

      // ────────────────────────────────────────────────────────────────
      // Identity-rewrite map for record copy.
      //
      // Some MDMS records carry the source tenant's identity inside their
      // payload (e.g. common-masters.StateInfo's `code` field IS the tenant
      // code). Copying these verbatim leaves the new tenant labelled as
      // the source — the digit-ui banner then renders TENANT_TENANTS_PG
      // even though stateTenantId is "subhashini".
      //
      // For each schema below, when the listed field equals `source`
      // (or starts with `source + "."`), rewrite it to point at `target`
      // (or `target + ".<suffix>"` for the dotted-prefix case). We only
      // rewrite values that actually mention the source — a record like
      // ACCESSCONTROL-ROLES with `tenantId: "pg"` IS pg-scoped and
      // should be retagged for the new root, but a SecurityPolicy with
      // a tenantId of `*` shouldn't be touched.
      const identityFieldsBySchema: Record<string, string[]> = {
        'common-masters.StateInfo':            ['code', 'tenantId'],
        'common-masters.uiHomePage':           ['tenantId'],
        'common-masters.wfSlaConfig':          ['tenantId'],
        'common-masters.CronJobAPIConfig':     ['tenantId'],
        'common-masters.IdFormat':             ['tenantId'],
        'common-masters.Department':           ['tenantId'],
        'common-masters.Designation':          ['tenantId'],
        'common-masters.GenderType':           ['tenantId'],
        'tenant.citymodule':                   ['tenantId'],
        'ACCESSCONTROL-ROLES.roles':           ['tenantId'],
        'ACCESSCONTROL-ACTIONS-TEST.actions-test': ['tenantId'],
        'ACCESSCONTROL-ROLEACTIONS.roleactions':   ['tenantId'],
        'egov-hrms.EmployeeStatus':            ['tenantId'],
        'egov-hrms.EmployeeType':              ['tenantId'],
        'egov-hrms.DeactivationReason':        ['tenantId'],
        'egov-hrms.Degree':                    ['tenantId'],
        'egov-hrms.EmploymentTest':            ['tenantId'],
        'egov-hrms.Specalization':             ['tenantId'],
        'RAINMAKER-PGR.ComplaintHierarchy':    ['tenantId'],
        'RAINMAKER-PGR.ComplaintHierarchyDefinition': ['tenantId'],
        'RAINMAKER-PGR.UIConstants':           ['tenantId'],
        'DataSecurity.DecryptionABAC':         ['tenantId'],
        'DataSecurity.EncryptionPolicy':       ['tenantId'],
        'DataSecurity.SecurityPolicy':         ['tenantId'],
        'DataSecurity.MaskingPatterns':        ['tenantId'],
        'INBOX.InboxQueryConfiguration':       ['tenantId'],
        'Workflow.BusinessService':            ['tenantId'],
        'Workflow.BusinessServiceConfig':      ['tenantId'],
        'Workflow.BusinessServiceMasterConfig':['tenantId'],
        'Workflow.AutoEscalation':             ['tenantId'],
        'Workflow.AutoEscalationStatesToIgnore':['tenantId'],
      };

      function rewriteIdentityFields(
        schemaCode: string,
        data: Record<string, unknown>,
        src: string,
        tgt: string,
      ): Record<string, unknown> {
        const fields = identityFieldsBySchema[schemaCode];
        const out: Record<string, unknown> = { ...data };
        if (fields && fields.length > 0) {
          for (const field of fields) {
            const v = out[field];
            if (typeof v !== 'string') continue;
            if (v === src) {
              out[field] = tgt;
            } else if (v.startsWith(src + '.')) {
              // dotted-prefix: keep the suffix, swap the prefix
              out[field] = tgt + v.substring(src.length);
            }
          }
        }
        // Schema-specific deep rewrites for fields that aren't top-level
        // tenant identifiers. tenant.citymodule's payload carries a
        // tenants:[{code: <tenant-code>}, …] array — leaving it verbatim
        // means the employee UI dropdown for the new tenant still lists
        // the source tenant's cities (the actual root cause of "maputo
        // doesn't appear in the dropdown after deploy").
        if (schemaCode === 'tenant.citymodule' && Array.isArray(out.tenants)) {
          out.tenants = (out.tenants as Array<Record<string, unknown>>).map((entry) => {
            const code = entry?.code;
            if (typeof code !== 'string') return entry;
            if (code === src) return { ...entry, code: tgt };
            if (code.startsWith(src + '.')) {
              return { ...entry, code: tgt + code.substring(src.length) };
            }
            return entry;
          });
        }
        return out;
      }

      // For a city-tier target, skip tenant.citymodule from the per-schema
      // copy pass — it's a root-level master (writes to a city scope land
      // in a "wrong" partition that reads inherit-from-root anyway, AND
      // the deep-rewrite would produce nonsensical entries like
      // mz.maputo.citya). Handled by the post-copy RMW append at root
      // below, which is the only operation that actually makes the new
      // city show up in the employee UI dropdown.
      const schemasForCopy = isCityTarget
        ? essentialSchemas.filter((s) => s !== 'tenant.citymodule')
        : essentialSchemas;

      emitProgress({ phase: 'data:start', message: `Copying essential MDMS data across ${schemasForCopy.length} schemas`, pct: 35 });

      for (let i = 0; i < schemasForCopy.length; i++) {
        const schemaCode = schemasForCopy[i];
        emitProgress({
          phase: 'data:schema',
          message: `Copying ${schemaCode}`,
          data: { schema: schemaCode, index: i + 1, total: schemasForCopy.length },
          pct: 35 + Math.floor((i / schemasForCopy.length) * 40),
        });
        try {
          // Fetch source records and existing target records for this schema.
          // Filter targetRecords to exact-tenant rows — MDMS v2 search is
          // hierarchical and may return parent-tenant records (e.g. pg's
          // ThemeConfig when querying mz). Without the filter, the bootstrap
          // falsely sees the record as already present and skips copying it,
          // leaving the target tenant without its own copy.
          const sourceRecords = await digitApi.mdmsV2SearchRaw(source, schemaCode, { limit: 500 });
          const targetRecords = await digitApi.mdmsV2SearchRaw(target, schemaCode, { limit: 500 });
          const targetByUid = new Map(
            targetRecords
              .filter((r) => (r as { tenantId?: string }).tenantId === target)
              .map((r) => [r.uniqueIdentifier, r]),
          );

          // An empty source is not the same as "nothing to do". For schemas
          // whose whole purpose is to carry platform-level definitions, a
          // source root with no rows means the target gets a working shell
          // with an empty catalog — which is indistinguishable from success in
          // the copied/skipped/failed counters. This is exactly how `mz` was
          // bootstrapped to a dashboard with zero KPIs. Say so out loud.
          if (sourceRecords.length === 0 && SCHEMAS_EMPTY_IS_A_PROBLEM.has(schemaCode)) {
            const warning =
              `Source tenant "${source}" has no ${schemaCode} records — nothing was copied to ` +
              `"${target}". The dashboard will render an empty catalog. Seed it from the repo ` +
              `files with local-setup/scripts/enable-dashboard.sh (DASHBOARD_TENANT=${target}).`;
            results.warnings.push(warning);
            console.warn(`[tenant_bootstrap] ${warning}`);
            emitProgress({ phase: 'data:warning', message: warning, data: { schema: schemaCode } });
          }

          for (const record of sourceRecords) {
            const existing = targetByUid.get(record.uniqueIdentifier);
            try {
              // A record whose payload is a JSON Schema document is the result
              // of POSTing a schema body to /v2/_create/<schema> instead of
              // /schema/v1/_create. It is not data, it occupies the uid a real
              // record needs, and copying it propagates the corruption to every
              // tenant bootstrapped from this source. Found live on `mz`.
              if (isSchemaDocument(record.data as Record<string, unknown>)) {
                const warning =
                  `Skipped ${schemaCode}/${record.uniqueIdentifier} at source "${source}": the ` +
                  `record payload is a JSON Schema document, not data. Deactivate it at the ` +
                  `source (mdms-v2 _update with isActive:false) — it also shadows the real record there.`;
                results.warnings.push(warning);
                console.warn(`[tenant_bootstrap] ${warning}`);
                results.data.skipped.push(`${schemaCode}/${record.uniqueIdentifier} (schema-as-data, not copied)`);
                continue;
              }
              if (existing && existing.isActive) {
                // Already active — skip. Note this is also true when the
                // TARGET holds a schema-as-data row under the same uid: the
                // copy cannot repair it, which is why the warning above points
                // at the enablement script rather than suggesting a re-run.
                results.data.skipped.push(`${schemaCode}/${record.uniqueIdentifier}`);
              } else if (existing && !existing.isActive) {
                // Inactive (from cleanup) — re-activate via update.
                // Identity fields don't need rewriting here — the existing
                // record was already created at this tenant, so it carries
                // the right identity.
                await digitApi.mdmsV2Update(existing, true);
                results.data.copied.push(`${schemaCode}/${record.uniqueIdentifier} (reactivated)`);
              } else {
                // Doesn't exist — create (with schema-persistence retry).
                // Rewrite identity fields so the new tenant doesn't ship
                // labelled with the source's tenant code.
                const rewritten = rewriteIdentityFields(
                  schemaCode,
                  record.data as Record<string, unknown>,
                  source,
                  target,
                );
                await mdmsCreateWithSchemaWait(target, schemaCode, record.uniqueIdentifier, rewritten);
                results.data.copied.push(`${schemaCode}/${record.uniqueIdentifier}`);
              }
            } catch (error) {
              const msg = error instanceof Error ? error.message : String(error);
              // Benign on re-runs: MDMS-v2 returns "Duplicate record" when an
              // x-unique key collides with an existing row whose uid hash
              // didn't match targetByUid (different serialization, etc.).
              // Treat all duplicate flavors as skipped — `Duplicate record`
              // (capital D, two words) is not caught by includes('DUPLICATE').
              if (isDuplicateError(msg)) {
                results.data.skipped.push(`${schemaCode}/${record.uniqueIdentifier}`);
              } else {
                results.data.failed.push(`${schemaCode}/${record.uniqueIdentifier}: ${msg}`);
              }
            }
          }
        } catch (schemaErr) {
          // Schema might not have data in source — that's OK
          console.error(`[tenant_bootstrap] Schema "${schemaCode}" data copy skipped: ${schemaErr instanceof Error ? schemaErr.message : String(schemaErr)}`);
        }
      }

      emitProgress({
        phase: 'data:done',
        message: `Data copied (${results.data.copied.length} new, ${results.data.skipped.length} existing, ${results.data.failed.length} failed)`,
        data: {
          copied: results.data.copied.length,
          skipped: results.data.skipped.length,
          failed: results.data.failed.length,
        },
        pct: 75,
      });

      // ── Step 3a: register city target in root tenant.citymodule ──
      // mdms-v2 has no array-append primitive, so read-modify-write each
      // citymodule row at the root scope and append {code: target} to its
      // tenants[] (skip if already present — idempotent). Without this
      // the employee UI module dropdowns stay empty for the new city
      // even though auth and HRMS Employee provisioning both succeeded.
      if (isCityTarget) {
        emitProgress({
          phase: 'citymodule:start',
          message: `Registering "${target}" in root tenant.citymodule`,
          pct: 76,
        });
        let appendedTo = 0;
        let alreadyIn = 0;
        try {
          const cityModuleRecords = await digitApi.mdmsV2SearchRaw(
            tenantsScope,
            'tenant.citymodule',
            { limit: 100 },
          );
          for (const rec of cityModuleRecords) {
            const data = rec.data as Record<string, unknown>;
            const tenants = Array.isArray(data.tenants)
              ? (data.tenants as Array<Record<string, unknown>>)
              : [];
            if (tenants.some((t) => t?.code === target)) {
              alreadyIn++;
              continue;
            }
            try {
              await digitApi.mdmsV2UpdateData(rec, {
                ...data,
                tenants: [...tenants, { code: target }],
              });
              appendedTo++;
              results.data.copied.push(
                `tenant.citymodule/${rec.uniqueIdentifier} (appended ${target})`,
              );
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              results.data.failed.push(
                `tenant.citymodule/${rec.uniqueIdentifier} (append ${target}): ${msg}`,
              );
            }
          }
          emitProgress({
            phase: 'citymodule:done',
            message: `citymodule: appended "${target}" to ${appendedTo} module(s) (${alreadyIn} already present)`,
            data: { appended: appendedTo, alreadyIn, scope: tenantsScope },
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(
            `[tenant_bootstrap] citymodule RMW at root "${tenantsScope}" failed: ${msg}`,
          );
          results.data.failed.push(`tenant.citymodule (root ${tenantsScope}): ${msg}`);
        }
      }

      // ── Step 3b: INSERT country-specific common-masters.MobileNumberValidation ──
      // Schema is seeded by default-data-handler at pg and copied to new root tenants
      // via TenantConsumer. MCP INSERTs the target-country record identified by
      // countryCode (the x-unique key). `mobile_regex`/`mobile_prefix` are a
      // back-compat shorthand; `user_validation` is the fully declarative form.
      const mobileCountryCode = (args.mobile_prefix as string) || '+91';
      const validationRules: Array<{ countryCode: string; mobileNumberRegex: string; default?: boolean }> =
        Array.isArray(args.user_validation) && (args.user_validation as unknown[]).length > 0
          ? (args.user_validation as typeof validationRules)
          : [{
              countryCode: mobileCountryCode,
              mobileNumberRegex: mobileRegex,
              default: true,
            }];
      emitProgress({ phase: 'mobilevalidation:start', message: `Synthesizing ${validationRules.length} MobileNumberValidation rule(s)`, pct: 76 });
      let uvNewlySeeded = false;
      try {
        // data-handler seeds the schema at pg and TenantConsumer copies it to the
        // target root tenant. MCP may start before data-handler finishes — poll until
        // the schema is visible before attempting the INSERT.
        {
          const schemaWaitMs = 3000;
          const schemaMaxAttempts = 20; // up to 60 s
          let schemaReady = false;
          for (let i = 0; i < schemaMaxAttempts; i++) {
            const schemas = await digitApi.mdmsSchemaSearch(target, ['common-masters.MobileNumberValidation']).catch(() => []);
            if (schemas && schemas.length > 0) { schemaReady = true; break; }
            emitProgress({ phase: 'mobilevalidation:wait', message: `Waiting for common-masters.MobileNumberValidation schema at "${target}" (attempt ${i + 1}/${schemaMaxAttempts})…` });
            await new Promise(res => setTimeout(res, schemaWaitMs));
          }
          if (!schemaReady) {
            throw new Error(`common-masters.MobileNumberValidation schema not found at "${target}" after ${schemaMaxAttempts * schemaWaitMs / 1000}s — default-data-handler may not have seeded it yet`);
          }
        }
        // mdms-v2 search is HIERARCHICAL — filter to exact-tenant rows only,
        // keyed by countryCode (the x-unique field).
        const existingUVraw = await digitApi.mdmsV2SearchRaw(target, 'common-masters.MobileNumberValidation', { limit: 50 });
        const getExistingByCountryCode = (countryCode: string) => existingUVraw.find(
          (r) => (r as { tenantId?: string }).tenantId === target
            && (r as { data?: { countryCode?: string } }).data?.countryCode === countryCode,
        );
        for (const rule of validationRules) {
          if (getExistingByCountryCode(rule.countryCode)) {
            results.data.skipped.push(`common-masters.MobileNumberValidation/${rule.countryCode}`);
            continue;
          }
          try {
            await mdmsCreateWithSchemaWait(target, 'common-masters.MobileNumberValidation', rule.countryCode, {
              countryCode: rule.countryCode,
              mobileNumberRegex: rule.mobileNumberRegex,
              default: rule.default ?? true,
            });
          } catch (e) {
            const m = e instanceof Error ? e.message : String(e);
            if (isDuplicateError(m)) {
              results.data.skipped.push(`common-masters.MobileNumberValidation/${rule.countryCode} (already exists)`);
              continue;
            }
            throw e;
          }
          results.data.copied.push(`common-masters.MobileNumberValidation/${rule.countryCode} (inserted, pattern=${rule.mobileNumberRegex})`);
          uvNewlySeeded = true;
        }
      } catch (e) {
        results.data.failed.push(`common-masters.MobileNumberValidation: ${e instanceof Error ? e.message : String(e)}`);
      }

      // Poll until the inserted record is readable before Step 4 creates the ADMIN user.
      if (uvNewlySeeded) {
        const pollIntervalMs = 2000;
        const maxAttempts = 15; // up to 30 s
        let uvReady = false;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          try {
            const uvRows = await digitApi.mdmsV2SearchRaw(target, 'common-masters.MobileNumberValidation', { limit: 10 });
            const allCorrect = validationRules.every(rule =>
              uvRows.some(r =>
                (r as { tenantId?: string }).tenantId === target &&
                (r as { data?: { countryCode?: string } }).data?.countryCode === rule.countryCode &&
                (r as { data?: { mobileNumberRegex?: string } }).data?.mobileNumberRegex === rule.mobileNumberRegex,
              ),
            );
            if (allCorrect) { uvReady = true; break; }
          } catch { /* ignore transient read errors, keep polling */ }
          await new Promise(res => setTimeout(res, pollIntervalMs));
        }
        if (!uvReady) {
          console.warn(`[tenant_bootstrap] MobileNumberValidation not yet readable on "${target}" after ${maxAttempts * pollIntervalMs / 1000}s — proceeding anyway`);
        }
      }

      // ── Step 3c: bridge ACCESSCONTROL-ACTIONS.actions from -TEST ─────────
      // egov-accesscontrol reads ACCESSCONTROL-ACTIONS.actions, but pg/statea
      // ship only ACCESSCONTROL-ACTIONS-TEST.actions-test. Clone the schema
      // def under the non-TEST code and copy every row PRESERVING data.id so
      // roleactions.actionid cross-refs still resolve. Without this the
      // employee UI renders blank (no actions → no menu).
      emitProgress({ phase: 'actions_bridge:start', message: 'Bridging ACCESSCONTROL-ACTIONS.actions ← actions-test', pct: 78 });
      try {
        const haveActions = await digitApi.mdmsSchemaSearch(target, ['ACCESSCONTROL-ACTIONS.actions']).catch(() => []);
        if (!haveActions || haveActions.length === 0) {
          const testSchema = (await digitApi.mdmsSchemaSearch(target, ['ACCESSCONTROL-ACTIONS-TEST.actions-test']).catch(() => []))[0];
          if (testSchema) {
            await digitApi.mdmsSchemaCreate(target, 'ACCESSCONTROL-ACTIONS.actions',
              (testSchema.description as string) || 'AccessControl actions (bridged from actions-test)',
              testSchema.definition as Record<string, unknown>).catch((e: unknown) => {
                const m = e instanceof Error ? e.message : String(e);
                if (!isDuplicateError(m)) throw e;
              });
          }
        }
        const testRows = await digitApi.mdmsV2SearchRaw(target, 'ACCESSCONTROL-ACTIONS-TEST.actions-test', { limit: 500 });
        const haveRows = await digitApi.mdmsV2SearchRaw(target, 'ACCESSCONTROL-ACTIONS.actions', { limit: 500 });
        const haveUid = new Set(haveRows.map((r) => r.uniqueIdentifier));
        let bridged = 0;
        for (const r of testRows) {
          if (haveUid.has(r.uniqueIdentifier)) continue;
          try {
            await mdmsCreateWithSchemaWait(target, 'ACCESSCONTROL-ACTIONS.actions',
              r.uniqueIdentifier as string, r.data as Record<string, unknown>);
            bridged++;
          } catch (e) {
            const m = e instanceof Error ? e.message : String(e);
            if (!isDuplicateError(m)) {
              results.data.failed.push(`ACCESSCONTROL-ACTIONS.actions/${r.uniqueIdentifier}: ${m}`);
            }
          }
        }
        if (bridged > 0) results.data.copied.push(`ACCESSCONTROL-ACTIONS.actions (bridged ${bridged} rows from -TEST)`);
      } catch (e) {
        results.data.failed.push(`ACCESSCONTROL-ACTIONS.actions bridge: ${e instanceof Error ? e.message : String(e)}`);
      }

      // Evict egov-user's Redis cache before creating the ADMIN user.
      // egov-user derives the state-level tenant by splitting the city tenantId
      // on '.' (e.g. "mz.maputo" → "mz") and caches under "validation:mz".
      // We must evict that state-level key — evicting "validation:mz.maputo"
      // has no effect since egov-user never writes that key.
      const stateTenantForEviction = target.includes('.') ? target.split('.')[0] : target;
      await evictValidationCache(stateTenantForEviction);

      emitProgress({ phase: 'admin:start', message: 'Provisioning ADMIN user on the new tenant', pct: 80 });

      // Step 4: Provision ADMIN user on target tenant
      // DIGIT auth scopes user lookup by tenantId — a user created under "pg" can't be found
      // when a frontend tries tenantId=<target>. We create a matching ADMIN user on the target
      // so that direct API login works.
      let userProvisioned: { username: string; tenantId: string; roles: string[] } | null = null;
      let userProvisionError: string | null = null;
      try {
        const auth = digitApi.getAuthInfo();
        const currentUsername = auth.user?.userName || process.env.CRS_USERNAME || 'ADMIN';
        const currentPassword = process.env.CRS_PASSWORD || 'eGov@123';

        // Get full user details from source tenant
        const sourceTenantForSearch = auth.user?.tenantId || source;
        const existingUsers = await digitApi.userSearch(sourceTenantForSearch, {
          userName: currentUsername,
          limit: 1,
        });

        const sourceUser = existingUsers[0];
        const userName = (sourceUser?.userName as string) || currentUsername;
        const name = (sourceUser?.name as string) || 'Admin';
        // Must satisfy the TARGET tenant's mobile rule, not the source country's.
        // Prefer an explicit admin_mobile, else the source mobile if it happens
        // to validate, else generate a conforming one from mobile_regex.
        const mobileNumber = deriveValidMobile(
          mobileRegex,
          Number(args.mobile_length) || 10,
          (args.admin_mobile as string) || (sourceUser?.mobileNumber as string),
        );

        // Standard roles needed for full platform operations on the new tenant
        const standardRoles = [
          { code: 'EMPLOYEE', name: 'Employee' },
          { code: 'CITIZEN', name: 'Citizen' },
          { code: 'CSR', name: 'CSR' },
          { code: 'GRO', name: 'Grievance Routing Officer' },
          { code: 'PGR_LME', name: 'PGR Last Mile Employee' },
          { code: 'DGRO', name: 'Department GRO' },
          { code: 'SUPERUSER', name: 'Super User' },
          // INTERNAL_MICROSERVICE_ROLE — required by services that do inter-service user lookups
          // (e.g. inbox's ElasticSearchService.initializeSystemuser() searches for a user with this
          // role on the state tenant). Without it, inbox crashes: "Service returned null while fetching user".
          { code: 'INTERNAL_MICROSERVICE_ROLE', name: 'Internal Microservice Role' },
        ].map((r) => ({ ...r, tenantId: target }));

        // Check if user already exists on the target tenant
        let alreadyExists = false;
        try {
          const targetUsers = await digitApi.userSearch(target, { userName: userName, limit: 1 });
          if (targetUsers.length > 0) {
            alreadyExists = true;
            // User exists — ensure they have all standard roles for this target
            const existingRoles = (targetUsers[0].roles || []) as Array<{ code: string; tenantId: string }>;
            const existingCodes = new Set(
              existingRoles.filter((r) => r.tenantId === target).map((r) => r.code),
            );
            const missingRoles = standardRoles.filter((r) => !existingCodes.has(r.code));
            if (missingRoles.length > 0) {
              await digitApi.userUpdate({
                ...targetUsers[0],
                roles: [...existingRoles, ...missingRoles],
              });
              userProvisioned = {
                username: userName,
                tenantId: target,
                roles: missingRoles.map((r) => r.code),
              };
            } else {
              userProvisioned = {
                username: userName,
                tenantId: target,
                roles: [],
              };
            }
          }
        } catch (userSearchErr) {
          console.error(`[tenant_bootstrap] User search on "${target}" failed, proceeding to create: ${userSearchErr instanceof Error ? userSearchErr.message : String(userSearchErr)}`);
        }

        if (!alreadyExists) {
          // Create user on the target tenant
          const newUser = {
            name,
            mobileNumber,
            userName,
            password: currentPassword,
            type: 'EMPLOYEE',
            active: true,
            emailId: (sourceUser?.emailId as string) || null,
            gender: (sourceUser?.gender as string) || null,
            roles: standardRoles,
            tenantId: target,
          };

          await digitApi.userCreate(newUser, target);
          userProvisioned = {
            username: userName,
            tenantId: target,
            roles: standardRoles.map((r) => r.code),
          };
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        userProvisionError = msg;
      }

      emitProgress({
        phase: 'admin:done',
        message: userProvisioned ? 'ADMIN user ready' : 'ADMIN user not provisioned',
        data: { provisioned: !!userProvisioned, error: userProvisionError || undefined },
        pct: 90,
      });

      // Step 5: Copy workflow definitions
      emitProgress({ phase: 'workflow:start', message: 'Copying PGR / business-service workflow definitions', pct: 92 });
      let workflowResults = { created: [] as string[], skipped: [] as string[], failed: [] as string[] };
      try {
        workflowResults = await copyWorkflowDefinitions(source, target);
      } catch (err) {
        workflowResults.failed.push(`workflow copy error: ${err instanceof Error ? err.message : String(err)}`);
      }

      // ────────────────────────────────────────────────────────────────
      // Step 6: Copy ALL localization messages from source → target.
      //
      // Without this, every label the SPA renders via Digit.Utils.t()
      // falls back to its raw key — banners show TENANT_TENANTS_PG,
      // privacy footer shows ES_BY_CLICKING / ES_PRIVACY_POLICY, the
      // city dropdown labels show TENANT_TENANTS_<UPPER(CODE)>, etc.
      //
      // Locales come from source's StateInfo.languages — typically
      // en_IN plus whichever regional ones the source tenant ships.
      // Falls back to ['en_IN'] if StateInfo is missing.
      //
      // No module filter: we pull everything. PGR alone is ~1.5K
      // messages, common-masters ~2K, plus DSS/inbox/workflow rows.
      // For a rich source tenant this can reach ~20K messages and
      // take 30–60 s — that's the price of a usable UI on day 1.
      // ────────────────────────────────────────────────────────────────
      emitProgress({ phase: 'localizations:start', message: 'Copying localization messages (this can take a while for the full set)', pct: 95 });

      const localizationResults: { locale: string; copied: number; failed: number; error?: string }[] = [];
      const UPSERT_BATCH = 500;

      // Discover locales — read source's StateInfo, pull `.languages[].value`.
      // We query SOURCE so the unmodified StateInfo is available even though
      // Step 3 has already rewritten it on TARGET.
      let locales: string[] = ['en_IN'];
      try {
        const stateInfoRows = await digitApi.mdmsV2SearchRaw(source, 'common-masters.StateInfo', { limit: 5 });
        const langs = (stateInfoRows[0]?.data as { languages?: { value?: string }[] } | undefined)?.languages || [];
        const discovered = langs.map((l) => l.value).filter((v): v is string => typeof v === 'string' && v.length > 0);
        if (discovered.length > 0) locales = Array.from(new Set(discovered));
      } catch {
        // StateInfo missing on source — keep en_IN default.
      }

      // Source tenants to scan for localization seed. Most DIGIT dumps
      // concentrate the bulk of messages on the "rich" seed tenant
      // (commonly `statea`/`statea.g`) while the chosen source root (often
      // `pg`) carries only a thin StateInfo + branding subset. Union across
      // the known rich roots so a `target=newroot source=pg` bootstrap
      // still gets the full ~8K en_IN message set, not the 121 that live
      // on `pg` alone. Deduplicate by code (first writer wins).
      const localeSourceTenants = Array.from(
        new Set([source, 'statea', 'statea.g', 'pg', 'pg.citest', 'ke', 'ke.nairobi']),
      );

      for (const locale of locales) {
        emitProgress({
          phase: 'localizations:locale',
          message: `Pulling ${locale} messages (union of ${localeSourceTenants.length} source tenants)`,
          data: { locale, sources: localeSourceTenants },
        });
        try {
          // Union messages across all candidate source tenants. First
          // (module, code) wins, so the explicit `source` arg always
          // takes precedence. Key includes module because the DB unique
          // constraint is (tenantid, locale, module, code) — the same
          // `code` can legitimately exist under multiple modules (e.g.
          // COMMON_MASTERS_* under rainmaker-common AND rainmaker-workbench).
          // Keying on code alone silently dropped one of the variants
          // AND caused the surviving variant to trip the DB constraint
          // when the dropped one was already present from a prior run.
          const byKey = new Map<string, { code: string; message: string; module: string }>();
          let perTenantRaw = 0;
          for (const sourceTenant of localeSourceTenants) {
            try {
              const msgs = await digitApi.localizationSearch(sourceTenant, locale);
              perTenantRaw += msgs.length;
              for (const m of msgs) {
                const rec = m as Record<string, unknown>;
                if (typeof rec.code !== 'string') continue;
                const code = rec.code.trim();
                if (!code) continue;
                // Complaint-type localization (SERVICEDEFS.* / SERVICEDEFS_*) is
                // intentionally excluded — mirrors the MDMS ComplaintHierarchy
                // data exclusion above. (The localization key prefix stays
                // SERVICEDEFS.* — that is the message-code convention the
                // citizen UI reads, independent of the MDMS master name.)
                // These keys are tenant-specific and must be
                // seeded by Phase 3 of the configurator. Copying them from
                // source tenants (e.g. statea has SERVICEDEFS.GARBAGE) causes
                // a duplicate-constraint 400 when Phase 3 later tries to insert
                // the same codes, silently blocking the whole upsert batch.
                if (code.startsWith('SERVICEDEFS')) continue;
                const message = rec.message as string;
                if (typeof message !== 'string') continue;
                const module = (typeof rec.module === 'string' ? rec.module : 'rainmaker-common').trim();
                const key = `${module}::${code}`;
                if (byKey.has(key)) continue;
                byKey.set(key, { code, message, module });
              }
            } catch {
              // Tenant may not have this locale — that's expected. Skip.
            }
          }
          // Static floor: the dashboard's repo-shipped message packs. Fresh
          // installs have no source tenant carrying rainmaker-dashboard yet
          // (the module was introduced with the dashboard localization work),
          // so without this a from-scratch bootstrap renders raw DASHBOARD_*
          // keys. Applied per locale for every locale that has a pack
          // (en_IN, pt_PT, ...). Live-tenant copies win (first-writer-wins,
          // same as above).
          const dashboardPack = DASHBOARD_L10N_PACKS[locale];
          if (dashboardPack) {
            for (const m of dashboardPack) {
              const key = `${m.module}::${m.code}`;
              if (!byKey.has(key)) byKey.set(key, m);
            }
          }
          const messages = Array.from(byKey.values());

          if (messages.length === 0) {
            localizationResults.push({ locale, copied: 0, failed: 0 });
            continue;
          }
          emitProgress({
            phase: 'localizations:locale_union',
            message: `${locale}: union of ${localeSourceTenants.length} sources → ${messages.length} unique codes (${perTenantRaw} raw rows)`,
            data: { locale, unique: messages.length, raw: perTenantRaw },
          });

          let copied = 0;
          let failed = 0;
          for (let off = 0; off < messages.length; off += UPSERT_BATCH) {
            const batch = messages.slice(off, off + UPSERT_BATCH);
            try {
              await digitApi.localizationUpsert(target, locale, batch);
              copied += batch.length;
              emitProgress({
                phase: 'localizations:batch',
                message: `${locale}: upserted ${copied}/${messages.length}`,
                data: { locale, copied, total: messages.length },
              });
            } catch (batchErr) {
              const bm = batchErr instanceof Error ? batchErr.message : String(batchErr);
              // Duplicates aren't real failures — egov-localization treats
              // these as no-ops on re-runs. Other errors are surfaced.
              // Include `unique` because the actual 400 body for a Postgres
              // unique_message_entry violation does not contain the word
              // DUPLICATE — only the constraint name does. Matches the
              // pattern other catch blocks in this file already use.
              if (/DUPLICATE|already exists|DuplicateMessageIdentity|unique/i.test(bm)) {
                copied += batch.length;
              } else {
                // Whole-batch 400 from a single poison row would otherwise
                // mark 499 good rows as failed. Fall back to per-row upsert
                // so `failed` reflects actual write failures, not blast
                // radius. Slower (N requests instead of 1) but only when a
                // batch poisons.
                console.error(`[tenant_bootstrap] localization upsert ${locale} batch ${off} failed (${bm.slice(0, 200)}); retrying per-row`);
                for (const m of batch) {
                  try {
                    await digitApi.localizationUpsert(target, locale, [m]);
                    copied++;
                  } catch (rowErr) {
                    const rm = rowErr instanceof Error ? rowErr.message : String(rowErr);
                    if (/DUPLICATE|already exists|DuplicateMessageIdentity|unique/i.test(rm)) {
                      copied++;
                    } else {
                      failed++;
                      console.error(`[tenant_bootstrap] localization upsert ${locale} row ${m.module}::${m.code}: ${rm.slice(0, 200)}`);
                    }
                  }
                }
              }
            }
          }
          localizationResults.push({ locale, copied, failed });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          localizationResults.push({ locale, copied: 0, failed: 0, error: msg.slice(0, 200) });
        }
      }

      const localizationsCopied = localizationResults.reduce((a, r) => a + r.copied, 0);
      const localizationsFailed = localizationResults.reduce((a, r) => a + r.failed, 0);

      // Push TENANT_TENANTS_<CODE> to both the city tenant and its root so the
      // city-selection dropdown resolves regardless of whether stateTenantId is
      // the city ("mz.maputo") or the root ("mz"). No source tenant carries this
      // key — it is target-specific — so the copy loop never writes it.
      // Mirrors configurator Phase 1's buildTenantLocalizations call.
      try {
        const lastSegment = target.split('.').pop() || target;
        const displayName = lastSegment.charAt(0).toUpperCase() + lastSegment.slice(1).toLowerCase();
        const tenantKey = `TENANT_TENANTS_${target.toUpperCase().replace(/\./g, '_')}`;
        const tenantMsg = { code: tenantKey, message: displayName, module: 'rainmaker-common' };
        // Push to city tenant (mz.maputo) AND root tenant (mz)
        const pushTargets = [target];
        if (target.includes('.')) pushTargets.push(target.split('.')[0]);
        for (const tid of pushTargets) {
          for (const locale of locales) {
            try { await digitApi.localizationUpsert(tid, locale, [tenantMsg]); } catch { /* duplicate on re-run */ }
          }
        }
      } catch {
        console.warn('[tenant_bootstrap] tenant name localization push failed (non-fatal)');
      }

      // Bust the localization service's Redis cache so the next _search
      // re-reads from DB instead of serving the stale empty entry cached
      // before bootstrap ran. Non-fatal — a miss here is retried on the
      // next SPA load; don't block bootstrap success on it.
      try {
        await digitApi.localizationCacheBust();
      } catch {
        console.warn('[tenant_bootstrap] localization cache-bust failed (non-fatal)');
      }

      emitProgress({
        phase: 'localizations:done',
        message: `Localization copy: ${localizationsCopied} messages across ${locales.length} locale(s), ${localizationsFailed} failed`,
        data: { copied: localizationsCopied, failed: localizationsFailed, locales: locales.length },
        pct: 99,
      });

      // ────────────────────────────────────────────────────────────────
      // Apply the operator-configured pincode allowlist to every active
      // tenant.tenants record under the root scope. Records come from
      // multiple writers (the self-record above, default-data-handler's
      // tenant-create consumer, city_setup) — RMW whatever exists now.
      // When the arg is omitted nothing is touched: the UI treats an
      // absent allowlist as "all postal codes serviceable", and the
      // alternative — seeding pincode: [] — is rejected by mdms-v2 on
      // update ("expected type: JSONArray, found: JSONObject").
      // ────────────────────────────────────────────────────────────────
      const pincodeAllowlist = normalizePincodeAllowlist(args.pincode_allowlist);
      if (pincodeAllowlist) {
        emitProgress({ phase: 'pincode:start', message: `Seeding pincode allowlist (${pincodeAllowlist.length} codes) on tenant.tenants`, pct: 97 });
        try {
          const tenantRecords = await digitApi.mdmsV2SearchRaw(tenantsScope, 'tenant.tenants', { limit: 100 });
          for (const rec of tenantRecords) {
            if (rec.isActive === false) continue;
            if ((rec as { tenantId?: string }).tenantId !== tenantsScope) continue;
            const existing = (rec.data as Record<string, unknown> | undefined)?.pincode;
            if (Array.isArray(existing)
              && existing.length === pincodeAllowlist.length
              && existing.every((p, i) => String(p) === String(pincodeAllowlist[i]))) {
              results.data.skipped.push(`tenant.tenants/${rec.uniqueIdentifier} (pincode allowlist)`);
              continue;
            }
            try {
              await digitApi.mdmsV2UpdateData(rec, {
                ...(rec.data as Record<string, unknown>),
                pincode: pincodeAllowlist,
              });
              results.data.copied.push(`tenant.tenants/${rec.uniqueIdentifier} (pincode allowlist)`);
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              results.data.failed.push(`tenant.tenants/${rec.uniqueIdentifier} (pincode allowlist): ${msg}`);
            }
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          results.data.failed.push(`tenant.tenants (pincode allowlist search): ${msg}`);
        }
      }

      // success now factors in workflow + localization failures too —
      // schema/data-only success used to mask broken UI labels.
      const overallSuccess =
        results.schemas.failed.length === 0 &&
        results.data.failed.length === 0 &&
        workflowResults.failed.length === 0 &&
        localizationsFailed === 0;

      // ────────────────────────────────────────────────────────────────
      // Step 7: Seed an HRMS Employee record for ADMIN.
      //
      // ADMIN can already log in (Step 4 created the eg_user row), but PGR's
      // Assign action requires the assignee to also have an `eg_hrms_employee`
      // row with a department + designation + jurisdiction. Without this,
      // Newman complaints-demo on a freshly-bootstrapped tenant fails 7/13:
      //   "The Department of the user with uuid: [<admin-uuid>] is not found"
      //
      // Pick the first available department + designation from `target`'s
      // common-masters MDMS (just copied in Step 2). Non-fatal: bootstrap
      // success doesn't depend on it; operator can manually create later.
      // ────────────────────────────────────────────────────────────────
      emitProgress({ phase: 'employee:start', message: 'Seeding HRMS Employee for ADMIN', pct: 99 });
      const adminEmployee: { provisioned: boolean; code?: string; department?: string; designation?: string; error?: string } = {
        provisioned: false,
      };
      if (userProvisioned) {
        try {
          const adminUserName = userProvisioned.username;
          // Roles must be tagged with the STATE root (where
          // ACCESSCONTROL-ROLES MDMS lives), not the leaf city — HRMS
          // rejects "Invalid role" if roles are scoped to a city tenant.
          const targetRoot = target.includes('.') ? target.split('.')[0] : target;

          // MDMS v2 inheritance from root → city is unreliable on freshly
          // bootstrapped tenants — search on city sometimes returns only
          // city-scoped rows and misses root depts. Query BOTH and union
          // by code so ADMIN's assignments cover every PGR dept.
          const [cityDepts, rootDepts, cityDesigs, rootDesigs] = await Promise.all([
            digitApi.mdmsV2SearchRaw(target, 'common-masters.Department', { limit: 100 }).catch(() => []),
            target !== targetRoot
              ? digitApi.mdmsV2SearchRaw(targetRoot, 'common-masters.Department', { limit: 100 }).catch(() => [])
              : Promise.resolve([] as Record<string, unknown>[]),
            digitApi.mdmsV2SearchRaw(target, 'common-masters.Designation', { limit: 100 }).catch(() => []),
            target !== targetRoot
              ? digitApi.mdmsV2SearchRaw(targetRoot, 'common-masters.Designation', { limit: 100 }).catch(() => [])
              : Promise.resolve([] as Record<string, unknown>[]),
          ]);

          // City must have its own MDMS row for every dept it wants to
          // assign — HRMS rejects "Invalid department" if the dept code
          // isn't in the city's local Department schema. Backfill any
          // root-only depts/desigs into the city before building the
          // employee.
          let deptNewlySeeded = false;
          if (target !== targetRoot) {
            const cityDeptCodes = new Set<string>();
            for (const d of cityDepts) {
              const c = ((d.uniqueIdentifier as string | undefined)
                || ((d.data as Record<string, unknown> | undefined)?.code as string | undefined));
              if (c) cityDeptCodes.add(c);
            }
            for (const d of rootDepts) {
              const code = ((d.uniqueIdentifier as string | undefined)
                || ((d.data as Record<string, unknown> | undefined)?.code as string | undefined));
              if (!code || cityDeptCodes.has(code)) continue;
              try {
                const created = await digitApi.mdmsV2Create(target, 'common-masters.Department',
                  code, (d.data as Record<string, unknown>) || { code });
                (cityDepts as Record<string, unknown>[]).push(created as unknown as Record<string, unknown>);
                cityDeptCodes.add(code);
                deptNewlySeeded = true;
              } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                if (!isDuplicateError(msg)) {
                  console.error(`[tenant_bootstrap] city Department backfill ${code}: ${msg.slice(0, 200)}`);
                }
              }
            }
            const cityDesigCodes = new Set<string>();
            for (const d of cityDesigs) {
              const c = ((d.uniqueIdentifier as string | undefined)
                || ((d.data as Record<string, unknown> | undefined)?.code as string | undefined));
              if (c) cityDesigCodes.add(c);
            }
            for (const d of rootDesigs) {
              const code = ((d.uniqueIdentifier as string | undefined)
                || ((d.data as Record<string, unknown> | undefined)?.code as string | undefined));
              if (!code || cityDesigCodes.has(code)) continue;
              try {
                const created = await digitApi.mdmsV2Create(target, 'common-masters.Designation',
                  code, (d.data as Record<string, unknown>) || { code });
                (cityDesigs as Record<string, unknown>[]).push(created as unknown as Record<string, unknown>);
                cityDesigCodes.add(code);
              } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                if (!isDuplicateError(msg)) {
                  console.error(`[tenant_bootstrap] city Designation backfill ${code}: ${msg.slice(0, 200)}`);
                }
              }
            }

            // Same Kafka-persister lag as UserValidation: mdmsV2Create publishes
            // to Kafka and returns before the persister writes to Postgres.
            // egov-hrms validates department/designation codes against MDMS at
            // employeeCreate time — if the backfilled rows aren't visible yet it
            // rejects with ERR_HRMS_INVALID_DEPARTMENT. Poll until at least one
            // city-scoped Department row is readable before calling employeeCreate.
            if (deptNewlySeeded) {
              const pollIntervalMs = 2000;
              const maxAttempts = 15; // up to 30 s
              let deptReady = false;
              for (let attempt = 0; attempt < maxAttempts; attempt++) {
                try {
                  const deptRows = await digitApi.mdmsV2SearchRaw(target, 'common-masters.Department', { limit: 5 });
                  if (deptRows.some(r => (r as { tenantId?: string }).tenantId === target)) {
                    deptReady = true;
                    break;
                  }
                } catch { /* ignore transient read errors, keep polling */ }
                await new Promise(res => setTimeout(res, pollIntervalMs));
              }
              if (!deptReady) {
                console.warn(`[tenant_bootstrap] Department not yet readable on "${target}" after ${maxAttempts * pollIntervalMs / 1000}s — proceeding anyway`);
              }
            }
          }

          // For HRMS Employee on a city we want ONLY the city-scoped
          // depts/desigs (post-backfill includes everything from root).
          // For root bootstrap target===targetRoot so this is a no-op.
          const depts = target === targetRoot ? [...cityDepts, ...rootDepts] : cityDepts;
          const desigs = target === targetRoot ? [...cityDesigs, ...rootDesigs] : cityDesigs;
          const deptCode = ((depts[0]?.uniqueIdentifier as string | undefined)
            || ((depts[0]?.data as Record<string, unknown> | undefined)?.code as string | undefined)) as string | undefined;
          const desigCode = ((desigs[0]?.uniqueIdentifier as string | undefined)
            || ((desigs[0]?.data as Record<string, unknown> | undefined)?.code as string | undefined)) as string | undefined;

          if (!deptCode || !desigCode) {
            adminEmployee.error = `Cannot seed HRMS Employee: no department/designation found on "${target}". Re-check Step 2.`;
          } else {
            // Check if an HRMS Employee already exists for ADMIN on the target.
            let alreadyExists = false;
            try {
              const existing = await digitApi.employeeSearch(target, { codes: [adminUserName], limit: 1 });
              if (existing.length > 0) alreadyExists = true;
            } catch { /* HRMS may 404 on fresh tenant; treat as not-found */ }

            if (alreadyExists) {
              adminEmployee.provisioned = true;
              adminEmployee.code = adminUserName;
              adminEmployee.department = deptCode;
              adminEmployee.designation = desigCode;
            } else {
              // Look up the live user record so we can link (uuid + id) instead
              // of triggering an HRMS-side user create (which would 409 on the
              // already-existing eg_user from Step 4).
              const targetUsers = await digitApi.userSearch(target, { userName: adminUserName, limit: 1 });
              const adminRecord = targetUsers[0];

              // HRMS validator filters out CITIZEN from MDMS roles before
              // checking each employee role
              // (HRMSConstants.HRMS_MDMS_AC_ROLES_FILTER = `[?(@.code != "CITIZEN")].code`).
              // Including CITIZEN here trips ERR_HRMS_INVALID_ROLE.
              const pgrRoles = ['EMPLOYEE', 'GRO', 'DGRO', 'PGR_LME', 'PGR_VIEWER', 'CSR', 'SUPERUSER'].map((c) => ({
                code: c, name: c, tenantId: targetRoot,
              }));
              const userPayload: Record<string, unknown> = {
                name: (adminRecord?.name as string) || 'Administrator',
                userName: adminUserName,
                // Same target-tenant mobile rule applies to the HRMS user payload.
                mobileNumber: deriveValidMobile(
                  mobileRegex,
                  Number(args.mobile_length) || 10,
                  (args.admin_mobile as string) || (adminRecord?.mobileNumber as string),
                ),
                emailId: (adminRecord?.emailId as string) || null,
                gender: (adminRecord?.gender as string) || 'MALE',
                type: 'EMPLOYEE',
                active: true,
                roles: pgrRoles,
                tenantId: targetRoot,
              };
              if (adminRecord?.uuid) userPayload.uuid = adminRecord.uuid;
              if (adminRecord?.id) userPayload.id = adminRecord.id;
              if (!adminRecord?.uuid) {
                userPayload.password = process.env.CRS_PASSWORD || 'eGov@123';
              }

              // PGR's validateDepartment checks that the assignee's HRMS
              // Employee has an assignment in the complaint's required
              // department (RAINMAKER-PGR.ComplaintHierarchy leaf .department). On a
              // tenant with one employee (ADMIN), every complaint targeting
              // a different department would fail with INVALID_ASSIGNMENT.
              // Give ADMIN one assignment per available department so it
              // qualifies as assignee for every complaint type. Dedup —
              // city + root depts often overlap (DEPT_5 etc.).
              const allDeptCodes = Array.from(new Set(
                depts
                  .map((d) => (d.uniqueIdentifier as string) || (d.data as Record<string, unknown> | undefined)?.code as string | undefined)
                  .filter((c): c is string => typeof c === 'string' && c.length > 0),
              ));
              const deptList = allDeptCodes.length > 0 ? allDeptCodes : [deptCode];

              const now = Date.now();
              const dayMs = 86_400_000;
              // HRMS rules:
              //   - non-overlapping assignment windows
              //   - every non-current assignment needs a toDate < current.fromDate
              //   - every assignment fromDate >= dateOfAppointment
              // Stagger N historical assignments into the past, then a
              // current one starting now. Anchor dateOfAppointment to the
              // earliest assignment so HRMS doesn't reject either edge.
              const dateOfAppointment = now - deptList.length * dayMs;
              const employee: Record<string, unknown> = {
                tenantId: target,
                employeeType: 'PERMANENT',
                employeeStatus: 'EMPLOYED',
                dateOfAppointment,
                code: adminUserName,
                IsActive: true,
                user: userPayload,
                assignments: deptList.map((dept, idx) => {
                  if (idx === 0) {
                    return {
                      department: dept,
                      designation: desigCode,
                      fromDate: now,
                      isCurrentAssignment: true,
                      isHOD: false,
                    };
                  }
                  // Historical: each occupies a 1-day window in the past,
                  // ending strictly before `now`.
                  const fromDate = now - (idx + 1) * dayMs;
                  const toDate = now - idx * dayMs;
                  return {
                    department: dept,
                    designation: desigCode,
                    fromDate,
                    toDate,
                    isCurrentAssignment: false,
                    isHOD: false,
                  };
                }),
                jurisdictions: [{
                  hierarchy: 'ADMIN',
                  boundaryType: 'City',
                  boundary: target,
                  tenantId: target,
                  isActive: true,
                }],
              };

              const created = await digitApi.employeeCreate(target, [employee]);
              if (created.length > 0) {
                const c = created[0];
                adminEmployee.provisioned = true;
                adminEmployee.code = (c.code as string | undefined) || adminUserName;
                adminEmployee.department = deptList.join(',');
                adminEmployee.designation = desigCode;

                // HRMS doesn't reliably persist the user password — reset via user-service.
                const u = c.user as Record<string, unknown> | undefined;
                if (u?.uuid) {
                  try {
                    const users = await digitApi.userSearch(target, { uuid: [u.uuid as string], limit: 1 });
                    if (users.length > 0) {
                      await digitApi.userUpdate({ ...users[0], password: process.env.CRS_PASSWORD || 'eGov@123' });
                    }
                  } catch { /* non-fatal */ }
                }
              }
            }
          }
        } catch (err) {
          adminEmployee.error = err instanceof Error ? err.message : String(err);
        }
      } else {
        adminEmployee.error = 'Skipped: ADMIN user provisioning failed earlier in this bootstrap';
      }
      emitProgress({
        phase: 'employee:done',
        message: adminEmployee.provisioned
          ? `ADMIN HRMS Employee seeded (dept=${adminEmployee.department}, desig=${adminEmployee.designation})`
          : `HRMS Employee not seeded: ${adminEmployee.error}`,
        data: adminEmployee,
        pct: 100,
      });

      emitProgress({
        phase: 'bootstrap:done',
        message: overallSuccess ? 'Tenant bootstrap complete' : 'Tenant bootstrap completed with failures (see results.*.failed)',
        data: {
          success: overallSuccess,
          summary: {
            schemas_copied: results.schemas.copied.length,
            schemas_failed: results.schemas.failed.length,
            data_copied: results.data.copied.length,
            data_failed: results.data.failed.length,
            workflows_created: workflowResults.created.length,
            workflows_failed: workflowResults.failed.length,
            localizations_copied: localizationsCopied,
            localizations_failed: localizationsFailed,
            admin_user_provisioned: !!userProvisioned,
            admin_employee_provisioned: adminEmployee.provisioned,
          },
        },
        pct: 100,
      });

      return JSON.stringify({
        success: overallSuccess,
        source,
        target,
        summary: {
          schemas_copied: results.schemas.copied.length,
          schemas_skipped: results.schemas.skipped.length,
          schemas_failed: results.schemas.failed.length,
          data_copied: results.data.copied.length,
          data_skipped: results.data.skipped.length,
          data_failed: results.data.failed.length,
          workflows_created: workflowResults.created.length,
          workflows_skipped: workflowResults.skipped.length,
          workflows_failed: workflowResults.failed.length,
          localizations_copied: localizationsCopied,
          localizations_failed: localizationsFailed,
          locales_seen: locales.length,
          // admin_user_provisioned = eg_user row exists on target (Step 4
          // above). admin_employee_provisioned = eg_hrms_employee row
          // (Step 7). Operators sometimes mistake the employee flag for
          // proof of login readiness — it's not; the user flag is what
          // gates auth.
          admin_user_provisioned: !!userProvisioned,
          admin_employee_provisioned: adminEmployee.provisioned,
          warnings: results.warnings.length,
        },
        // Surfaced at the top level on purpose. These are cases the copy
        // cannot fix and that no counter reflects — an empty source master, a
        // corrupt source record. Buried in `results` they read as success.
        ...(results.warnings.length > 0 && { warnings: results.warnings }),
        localizations: localizationResults,
        adminEmployee,
        ...(userProvisioned && {
          adminUser: {
            provisioned: true,
            ...userProvisioned,
            note: userProvisioned.roles.length > 0
              ? `ADMIN user "${userProvisioned.username}" provisioned on "${target}" with roles: ${userProvisioned.roles.join(', ')}. Direct login with tenantId="${target}" now works.`
              : `ADMIN user "${userProvisioned.username}" already exists on "${target}" with all required roles.`,
          },
        }),
        ...(userProvisionError && {
          adminUser: {
            provisioned: false,
            error: userProvisionError,
            hint: 'User provisioning failed. You can manually create an ADMIN user with user_create tool.',
          },
        }),
        results: {
          ...results,
          workflow: workflowResults,
        },
        nextSteps: [
          `Create a city tenant: use city_setup with tenant_id="${target}.yourcity" and a city name`,
          'NOTE: DIGIT Java services (PGR, HRMS, inbox) use STATE_LEVEL_TENANT_ID from their config. ' +
          'A new root tenant requires restarting these services. For testing, create cities under "pg" instead.',
        ],
      }, null, 2);
    },
  } satisfies ToolMetadata);

  // city_setup — set up a city-level tenant with everything needed for PGR
  registry.register({
    name: 'city_setup',
    group: 'mdms',
    category: 'mdms',
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
        const currentPassword = process.env.CRS_PASSWORD || 'eGov@123';

        const standardRoles = ['EMPLOYEE', 'CITIZEN', 'CSR', 'GRO', 'PGR_LME', 'DGRO', 'SUPERUSER', 'INTERNAL_MICROSERVICE_ROLE'];

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
              userPayload.password = process.env.CRS_PASSWORD || 'eGov@123';
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
                    await digitApi.userUpdate({ ...users[0], password: process.env.CRS_PASSWORD || 'eGov@123' });
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
    risk: 'write',
    description:
      'Clean up a tenant by soft-deleting MDMS records OWNED by that tenant (isActive=false) ' +
      'and deactivating users. Records inherited from parent tenants are left untouched — only ' +
      'records whose own record.tenantId equals the passed tenant_id are deactivated. ' +
      'Follows the dataloader pattern: MDMS records are deactivated via the v2 _update API, not hard-deleted. ' +
      'Schema definitions are left in place (harmless without data). ' +
      'Use this to tear down test tenants created by tenant_bootstrap or city_setup_from_xlsx.',
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
      },
      required: ['tenant_id'],
    },
    handler: async (args) => {
      validateTenantId(args.tenant_id, 'tenant_id');

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
            `FIX: Call tenant_bootstrap with target_tenant="${stateRoot}" to copy all schemas and data from pg. ` +
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
async function ensureAuthenticated(): Promise<void> {
  if (digitApi.isAuthenticated()) return;

  const username = process.env.CRS_USERNAME;
  const password = process.env.CRS_PASSWORD;
  const tenantId = process.env.CRS_TENANT_ID || digitApi.getEnvironmentInfo().stateTenantId;

  if (!username || !password) {
    throw new Error(
      'Not authenticated. Call the "configure" tool first with your username and password, or set CRS_USERNAME/CRS_PASSWORD env vars.'
    );
  }

  await digitApi.login(username, password, tenantId);
}
