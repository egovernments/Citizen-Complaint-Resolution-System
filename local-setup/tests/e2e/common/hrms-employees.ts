/**
 * Employee lookup, sourced from HRMS.
 *
 * Returns employees on a given tenant, optionally filtered by required
 * role code. The HRMS server-side role-query param doesn't reliably
 * narrow (returns empty across tested deployments), so this helper
 * fetches the tenant set and filters client-side by inspecting
 * `user.roles[*].code`.
 *
 * Public API:
 *   getEmployees(tenant, opts)                    -> Promise<HrmsEmployee[]>
 *   pickRandomEmployeeWithRole(tenant, role, opts) -> Promise<HrmsEmployee>
 *
 * Random pick across qualifying employees — same rationale as the
 * boundary and servicedef helpers: vary the assignee across runs so
 * role-specific quirks (e.g. employee-without-current-assignment) get
 * exercised over time instead of always landing on the same person.
 */
import { getDigitToken } from '../utils/auth';

export interface HrmsEmployee {
  id?: number;
  code?: string;
  user: {
    uuid: string;
    name?: string;
    userName?: string;
    mobileNumber?: string;
    tenantId?: string;
    roles?: Array<{ code: string; tenantId?: string }>;
  };
  assignments?: Array<Record<string, unknown>>;
  jurisdictions?: Array<Record<string, unknown>>;
}

export interface EmployeeLookupOptions {
  baseURL?: string;
  adminUser?: string;
  adminPassword?: string;
  authTenant?: string;
}

/**
 * Fetch all employees for `tenant` from HRMS (no server-side role
 * filter — that's not reliable across deployments).
 */
export async function getEmployees(
  tenant: string,
  opts: EmployeeLookupOptions = {},
): Promise<HrmsEmployee[]> {
  const baseURL = opts.baseURL ?? process.env.BASE_URL ?? 'http://localhost:18080';
  const authTenant = opts.authTenant ?? tenant;
  const adminUser =
    opts.adminUser ?? process.env.ADMIN_USER ?? process.env.DIGIT_EMPLOYEE_USER ?? 'ADMIN';
  const adminPassword =
    opts.adminPassword ??
    process.env.ADMIN_PASSWORD ??
    process.env.DIGIT_EMPLOYEE_PASSWORD ??
    'eGov@123';

  const token = await getDigitToken({
    baseURL,
    tenant: authTenant,
    username: adminUser,
    password: adminPassword,
    userType: 'EMPLOYEE',
  });

  const resp = await fetch(
    `${baseURL}/egov-hrms/employees/_search?tenantId=${encodeURIComponent(tenant)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        RequestInfo: { apiId: 'Rainmaker', authToken: token.access_token },
      }),
    },
  );
  if (!resp.ok) {
    throw new Error(`HRMS fetch failed (${resp.status}): ${await resp.text()}`);
  }
  const json = (await resp.json()) as { Employees?: HrmsEmployee[] };
  return json.Employees ?? [];
}

/**
 * Pick a random employee on `tenant` whose user.roles includes
 * `roleCode`. Throws if none found — a real ops finding that the
 * deployment doesn't have anyone in the role.
 *
 * For PGR ASSIGN, roleCode is typically 'PGR_LME'. For Resolve, the
 * caller may want to pre-filter to the same uuid as the previous
 * assignee.
 */
export async function pickRandomEmployeeWithRole(
  tenant: string,
  roleCode: string,
  opts: EmployeeLookupOptions = {},
): Promise<HrmsEmployee> {
  const all = await getEmployees(tenant, opts);
  const matching = all.filter((e) =>
    (e.user?.roles ?? []).some((r) => r.code === roleCode),
  );
  if (matching.length === 0) {
    throw new Error(
      `No HRMS employee on tenant=${tenant} carries role=${roleCode} ` +
        `(deployment gap — assign cannot proceed)`,
    );
  }
  return matching[Math.floor(Math.random() * matching.length)];
}
