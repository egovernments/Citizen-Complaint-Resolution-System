/**
 * ServiceDef (complaint type) lookup, sourced from MDMS.
 *
 * Reads `RAINMAKER-PGR.ComplaintHierarchy` from MDMS v1 — a single adjacency
 * list holding interior nodes AND leaf complaint types. The legacy
 * `RAINMAKER-PGR.ServiceDefs` master is gone; this helper keeps only the LEAF
 * rows and maps each to the legacy ServiceDef shape, so the public API and the
 * `ServiceDef` interface stay stable for downstream specs. v1 returns the full
 * tenant set (250+ rows on a real Kenya deployment) whereas v2 often returns a
 * curated subset. v1 is the canonical source for PGR.
 *
 * A row is a LEAF iff it carries `department` or `slaHours` (interior nodes omit
 * both). A leaf's `code` IS the serviceCode stored on a complaint, verbatim.
 *
 * Public API (keep stable across ports — see memory feedback_test_data_from_deployment):
 *   getServiceDefs(tenant, opts)        -> Promise<ServiceDef[]>
 *   pickRandomServiceCode(tenant, opts) -> Promise<ServiceDef>
 *   pickServiceDefInDepartments(tenant, departments, opts) -> Promise<ServiceDef>
 *   complaintTypePath(tenant, serviceCode, opts) -> Promise<{ code, name }[]>
 *
 * Random picking is the default for `pickRandomServiceCode` — same
 * rationale as the boundary helper. Pinning to one serviceCode hides
 * SLA-mapping, workflow-rule, and localization gaps that only fire on
 * specific complaint types.
 */
import { getDigitToken } from '../utils/auth';
import { requiredEnv } from '../utils/identity';

export interface ServiceDef {
  serviceCode: string;
  name?: string;
  menuPath?: string;
  department?: string;
  slaHours?: number;
  keywords?: string;
  active?: boolean;
}

/** Raw RAINMAKER-PGR.ComplaintHierarchy row (interior node or leaf). */
interface ComplaintHierarchyRow {
  code: string;
  name?: string;
  parentCode?: string;
  department?: string;
  slaHours?: number;
  keywords?: string;
  active?: boolean;
}

/**
 * Keep only the leaf rows of a ComplaintHierarchy and map each to the legacy
 * ServiceDef shape. menuPath/menuPathName grouping derives from the tree:
 * menuPath = leaf.parentCode; menuPathName = parent node's name.
 */
function hierarchyToServiceDefs(rows: ComplaintHierarchyRow[]): ServiceDef[] {
  const isLeaf = (r: ComplaintHierarchyRow) =>
    r != null && (r.department !== undefined || r.slaHours !== undefined);
  return rows.filter(isLeaf).map((r) => ({
    serviceCode: r.code,
    name: r.name,
    menuPath: r.parentCode,
    department: r.department,
    slaHours: r.slaHours,
    keywords: r.keywords,
    active: r.active,
  }));
}

export interface ServiceDefLookupOptions {
  baseURL?: string;
  adminUser?: string;
  adminPassword?: string;
  activeOnly?: boolean;
}

/** The raw RAINMAKER-PGR.ComplaintHierarchy rows (interior nodes and leaves) for `tenant`. */
async function getComplaintHierarchy(
  tenant: string,
  opts: ServiceDefLookupOptions = {},
): Promise<ComplaintHierarchyRow[]> {
  const baseURL = opts.baseURL ?? requiredEnv('BASE_URL');
  const adminUser = opts.adminUser ?? requiredEnv('DIGIT_USERNAME');
  const adminPassword = opts.adminPassword ?? requiredEnv('DIGIT_PASSWORD');

  const token = await getDigitToken({
    baseURL,
    tenant,
    username: adminUser,
    password: adminPassword,
  });

  const resp = await fetch(`${baseURL}/egov-mdms-service/v1/_search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      RequestInfo: { apiId: 'Rainmaker', authToken: token.access_token },
      MdmsCriteria: {
        tenantId: tenant,
        moduleDetails: [
          { moduleName: 'RAINMAKER-PGR', masterDetails: [{ name: 'ComplaintHierarchy' }] },
        ],
      },
    }),
  });
  if (!resp.ok) {
    throw new Error(`ComplaintHierarchy fetch failed (${resp.status}): ${await resp.text()}`);
  }
  const json = (await resp.json()) as {
    MdmsRes?: { 'RAINMAKER-PGR'?: { ComplaintHierarchy?: ComplaintHierarchyRow[] } };
  };
  return json.MdmsRes?.['RAINMAKER-PGR']?.ComplaintHierarchy ?? [];
}

/**
 * Fetch ServiceDefs for `tenant` from MDMS v1. Filters to active rows by
 * default. Falls through unfiltered if `activeOnly: false`.
 */
export async function getServiceDefs(
  tenant: string,
  opts: ServiceDefLookupOptions = {},
): Promise<ServiceDef[]> {
  const all = hierarchyToServiceDefs(await getComplaintHierarchy(tenant, opts));
  return (opts.activeOnly ?? true) ? all.filter((s) => s.active !== false) : all;
}

/**
 * A random active complaint type in one of `departments`. pgr-services refuses
 * an assignee outside the type's department (INVALID_ASSIGNMENT), and the
 * employee Assign dialog lists only that department's employees, so a spec
 * that assigns to a persona files its complaint under the persona's department.
 */
export async function pickServiceDefInDepartments(
  tenant: string,
  departments: string[],
  opts: ServiceDefLookupOptions = {},
): Promise<ServiceDef> {
  const types = (await getServiceDefs(tenant, opts)).filter((d) => d.department && departments.includes(d.department));
  if (types.length === 0) {
    throw new Error(`No active complaint type on ${tenant} belongs to department ${departments.join(', ') || '(none)'}`);
  }
  return types[Math.floor(Math.random() * types.length)];
}

/** The hierarchy rows from the top level down to the leaf `serviceCode`, as the citizen wizard shows them. */
export async function complaintTypePath(
  tenant: string,
  serviceCode: string,
  opts: ServiceDefLookupOptions = {},
): Promise<Array<{ code: string; name: string }>> {
  const rows = await getComplaintHierarchy(tenant, opts);
  const byCode = new Map(rows.map((r) => [r.code, r]));
  const path: Array<{ code: string; name: string }> = [];
  for (let row = byCode.get(serviceCode); row; row = row.parentCode ? byCode.get(row.parentCode) : undefined) {
    path.unshift({ code: row.code, name: row.name ?? row.code });
  }
  if (path.length === 0) throw new Error(`Complaint type ${serviceCode} is not in ${tenant}'s ComplaintHierarchy`);
  return path;
}

/**
 * Pick a random ServiceDef for the tenant. Throws if none found — same
 * principle as the boundary helper: a missing master is a real ops
 * finding, not something to paper over with a fallback.
 */
export async function pickRandomServiceCode(
  tenant: string,
  opts: ServiceDefLookupOptions = {},
): Promise<ServiceDef> {
  const defs = await getServiceDefs(tenant, opts);
  if (defs.length === 0) {
    throw new Error(
      `No ServiceDefs found for tenant=${tenant} (RAINMAKER-PGR.ComplaintHierarchy has no leaf rows or is unseeded)`,
    );
  }
  return defs[Math.floor(Math.random() * defs.length)];
}
