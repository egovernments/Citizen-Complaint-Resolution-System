/**
 * Boundary lookup, sourced from the live deployment.
 *
 * Boundaries don't live in MDMS — they're owned by egov-location (v1) and
 * boundary-service (v2). This helper uses the v1 tree endpoint because
 * (a) it returns the parent-child nesting in one call, (b) it's stable
 * across DIGIT deployments going back several versions, and (c) the
 * children:[] marker makes leaf detection trivial.
 *
 * Public API (keep stable across ports — see memory feedback_test_data_from_deployment):
 *   getBoundaryTree(tenant, opts)      -> Promise<Boundary[]>
 *   collectLeafBoundaries(tree, type?) -> Boundary[]
 *   pickRandomLeafBoundary(tenant, opts) -> Promise<Boundary>
 *
 * Random selection is the default mode of `pickRandomLeafBoundary` — tests
 * should NOT pin to a known-good boundary code. Variation across runs is
 * how we catch boundaries that work in isolation but break when
 * something else (a workflow rule, an SLA mapping, a localization key)
 * is only configured for one specific path.
 */
import { getDigitToken } from '../utils/auth';

export interface Boundary {
  code: string;
  name: string;
  label?: string;
  boundaryType?: string;
  id?: string;
  localname?: string;
  children?: Boundary[];
}

export interface BoundaryLookupOptions {
  baseURL?: string;
  hierarchyType?: string;
  adminUser?: string;
  adminPassword?: string;
  authTenant?: string;
}

/**
 * Fetch the full boundary tree for `tenant` from egov-location.
 * Hierarchy defaults to ADMIN (the standard administrative hierarchy
 * used by PGR for complaint locality).
 */
export async function getBoundaryTree(
  tenant: string,
  opts: BoundaryLookupOptions = {},
): Promise<Boundary[]> {
  const baseURL = opts.baseURL ?? process.env.BASE_URL ?? 'http://localhost:18080';
  const hierarchyType = opts.hierarchyType ?? 'ADMIN';
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

  const url =
    `${baseURL}/egov-location/boundarys/_search` +
    `?tenantId=${encodeURIComponent(tenant)}` +
    `&hierarchyTypeCode=${encodeURIComponent(hierarchyType)}`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      RequestInfo: { apiId: 'Rainmaker', authToken: token.access_token },
    }),
  });
  if (!resp.ok) {
    throw new Error(`Boundary fetch failed (${resp.status}): ${await resp.text()}`);
  }
  const json = (await resp.json()) as {
    TenantBoundary?: Array<{ boundary?: Boundary[] }>;
  };
  return json.TenantBoundary?.[0]?.boundary ?? [];
}

/**
 * Recursively collect leaf boundaries (`children: []` or no `children`)
 * from a tree. Optional `boundaryType` filter restricts results to leaves
 * of a specific level (e.g., only `Ward` leaves).
 */
export function collectLeafBoundaries(
  tree: Boundary[],
  boundaryType?: string,
): Boundary[] {
  const out: Boundary[] = [];
  function walk(node: Boundary): void {
    const kids = node.children ?? [];
    if (kids.length === 0) {
      if (!boundaryType || node.boundaryType === boundaryType) out.push(node);
      return;
    }
    for (const k of kids) walk(k);
  }
  for (const root of tree) walk(root);
  return out;
}

/**
 * Pick a random leaf boundary from the tenant's tree. Defaults to ADMIN
 * hierarchy. Throws if no leaves are found — surfacing a real
 * deployment gap rather than silently returning a stub. Caller is
 * responsible for logging which boundary was picked so flaky runs are
 * reproducible.
 */
export async function pickRandomLeafBoundary(
  tenant: string,
  opts: BoundaryLookupOptions & { boundaryType?: string } = {},
): Promise<Boundary> {
  const tree = await getBoundaryTree(tenant, opts);
  const leaves = collectLeafBoundaries(tree, opts.boundaryType);
  if (leaves.length === 0) {
    throw new Error(
      `No leaf boundaries found for tenant=${tenant} ` +
        `hierarchyType=${opts.hierarchyType ?? 'ADMIN'}` +
        (opts.boundaryType ? ` boundaryType=${opts.boundaryType}` : ''),
    );
  }
  return leaves[Math.floor(Math.random() * leaves.length)];
}
