/**
 * Boundary lookup, sourced from the live deployment.
 *
 * Boundaries don't live in MDMS. This helper reads boundary-service's
 * relationship tree (`includeChildren`), the same source PGR validates a
 * locality against; develop deployments have no egov-location.
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
import { requiredEnv } from '../utils/identity';

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
  const baseURL = opts.baseURL ?? requiredEnv('BASE_URL');
  const hierarchyType = opts.hierarchyType ?? 'ADMIN';
  const adminUser = opts.adminUser ?? requiredEnv('DIGIT_USERNAME');
  const adminPassword = opts.adminPassword ?? requiredEnv('DIGIT_PASSWORD');

  const token = await getDigitToken({
    baseURL,
    tenant,
    username: adminUser,
    password: adminPassword,
  });

  const url =
    `${baseURL}/boundary-service/boundary-relationships/_search` +
    `?tenantId=${encodeURIComponent(tenant)}` +
    `&hierarchyType=${encodeURIComponent(hierarchyType)}&includeChildren=true`;

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
  // boundary-service nodes carry no name; the code doubles as one.
  const named = (n: Boundary): Boundary => ({ ...n, name: n.name ?? n.code, children: (n.children ?? []).map(named) });
  return (json.TenantBoundary?.[0]?.boundary ?? []).map(named);
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
