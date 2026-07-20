/**
 * Fetch the PGR complaint catalogue (complaint types) from MDMS.
 *
 * TARGET MODEL (2-master complaint hierarchy):
 *   The catalogue now lives in a single adjacency-list master,
 *   RAINMAKER-PGR.ComplaintHierarchy, holding BOTH interior nodes and leaf
 *   complaint types. A row is:
 *     { hierarchyType, levelCode, code, parentCode, name, order, active, path }
 *   LEAF rows (the actual complaint types a citizen picks) ALSO carry
 *   department / departments[] / slaHours / keywords. A leaf row's `code` IS
 *   the serviceCode stored on a complaint.
 *
 * ADAPTER PATTERN: we fetch ComplaintHierarchy, keep only LEAF rows, and map
 * each leaf back to the legacy ServiceDefs shape so downstream code (the
 * wizard, list/show labels) stays unchanged. The old masters
 * (ServiceDefs / ClassificationNode / menuPath) are gone — grouping and labels
 * now derive from the tree:
 *     group key   = leaf.parentCode
 *     group label = the parent ComplaintHierarchy node's `name`
 *
 * LEAF DETECTION: a row is a leaf iff it has `department` or `slaHours`
 * present (interior nodes omit them).
 *
 * Cached by react-query at 5 min stale time; the catalogue rarely changes
 * during a citizen session.
 */
import { useQuery } from '@tanstack/react-query';
import { apiClient, getApiBaseUrl } from '@/api';

const STATE_TENANT = (import.meta.env.VITE_CITIZEN_STATE_TENANT as string) || 'ke';

/** A raw row from RAINMAKER-PGR.ComplaintHierarchy (adjacency list). */
interface HierarchyRow {
  hierarchyType?: string;
  levelCode?: string;
  code: string;
  parentCode?: string;
  name?: string;
  order?: number;
  active?: boolean;
  path?: string;
  // Leaf-only fields:
  department?: string;
  departments?: string[];
  slaHours?: number;
  keywords?: string;
}

/**
 * Legacy ServiceDefs shape — preserved so downstream code keeps working.
 * `menuPath` / `menuPathName` are now DERIVED from the tree (parentCode and the
 * parent node's name) rather than read from a master field.
 */
export interface ServiceDef {
  serviceCode: string;
  name: string;
  menuPath?: string;
  menuPathName?: string;
  parentCode?: string;
  department?: string;
  departments?: string[];
  slaHours?: number;
  keywords?: string;
  order?: number;
  active?: boolean;
}

export interface ServiceDefNode {
  serviceCode: string;
  name: string;
  children: ServiceDefNode[];
}

interface MdmsResponse {
  MdmsRes?: {
    'RAINMAKER-PGR'?: { ComplaintHierarchy?: HierarchyRow[] };
  };
}

/** A row is a leaf (a submittable complaint type) iff it carries SLA/department. */
function isLeaf(row: HierarchyRow): boolean {
  return row.department != null || row.slaHours != null;
}

/**
 * Fetch ComplaintHierarchy, then keep LEAF rows mapped to the legacy
 * ServiceDef shape. `menuPath` = parentCode; `menuPathName` = the name of the
 * parent ComplaintHierarchy node (the group label).
 */
async function fetchServiceDefs(): Promise<ServiceDef[]> {
  const { token } = apiClient.getAuth();
  const res = await fetch(`${getApiBaseUrl()}/egov-mdms-service/v1/_search?tenantId=${STATE_TENANT}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      RequestInfo: { apiId: 'citizen-ui', authToken: token ?? '' },
      MdmsCriteria: {
        tenantId: STATE_TENANT,
        moduleDetails: [
          {
            moduleName: 'RAINMAKER-PGR',
            // No active-filter here: we need the interior nodes too (to resolve
            // each leaf's parent name). Inactive rows are dropped below.
            masterDetails: [{ name: 'ComplaintHierarchy' }],
          },
        ],
      },
    }),
  });
  if (!res.ok) throw new Error(`MDMS ComplaintHierarchy fetch failed: HTTP ${res.status}`);
  const json = (await res.json()) as MdmsResponse;
  const rows = json.MdmsRes?.['RAINMAKER-PGR']?.ComplaintHierarchy ?? [];

  // code → node, for resolving each leaf's parent name (the group label).
  const byCode = new Map<string, HierarchyRow>();
  for (const r of rows) {
    if (r.code) byCode.set(r.code, r);
  }

  // Set of codes that ARE a parent of some active row (i.e. have children).
  const hasChildren = new Set<string>();
  for (const r of rows) {
    if (r.parentCode && r.active !== false) hasChildren.add(r.parentCode);
  }

  // A row is SELECTABLE by a citizen if it is a leaf (carries department/SLA)
  // OR it is a terminal node — nothing else lists it as a parent. The terminal
  // case covers a branch that stops before the declared leaf level (e.g. 3
  // levels declared but this SECTOR has no SUB_TYPE): the citizen picks the
  // SECTOR itself and its real code becomes the serviceCode (a real
  // ComplaintHierarchy row, so pgr-services accepts it — no INVALID_SERVICECODE).
  const isSelectable = (r: HierarchyRow) => isLeaf(r) || !hasChildren.has(r.code);

  return rows
    .filter((r) => isSelectable(r) && r.active !== false && r.code)
    .map((r) => {
      const parent = r.parentCode ? byCode.get(r.parentCode) : undefined;
      return {
        serviceCode: r.code,
        name: r.name || r.code,
        parentCode: r.parentCode,
        menuPath: r.parentCode,
        menuPathName: parent?.name ?? r.parentCode,
        department: r.department,
        departments: r.departments,
        slaHours: r.slaHours,
        keywords: r.keywords,
        order: r.order,
        active: r.active,
      } satisfies ServiceDef;
    });
}

/**
 * Build the citizen-facing two-level pick tree from the adjacency list:
 *   group node  = the leaf's parent (keyed by parentCode, labelled by the
 *                 parent node's name = menuPathName)
 *   leaf        = the complaint type the citizen actually picks (serviceCode)
 *
 * Group nodes carry a synthetic serviceCode (`__cat:<parentCode>`) so the
 * wizard's "type" step can validate a selection; the synthetic value never
 * reaches the PGR _create payload — the wizard requires a leaf serviceCode
 * before letting the citizen advance.
 */
function toTree(defs: ServiceDef[]): ServiceDefNode[] {
  const groups = new Map<string, ServiceDefNode>();

  for (const d of defs) {
    if (!d.serviceCode) continue;

    // Group by parentCode; label by the parent node's name. Leaves with no
    // parent fall back to a single "Other" bucket so they remain pickable.
    const groupKey = d.parentCode || '__root';
    const groupName = d.menuPathName || d.parentCode || 'Other';

    let group = groups.get(groupKey);
    if (!group) {
      group = {
        serviceCode: `__cat:${groupKey}`,
        name: groupName,
        children: [],
      };
      groups.set(groupKey, group);
    }
    group.children.push({
      serviceCode: d.serviceCode,
      name: d.name,
      children: [],
    });
  }

  // Sort groups alphabetically; sort leaves within each by name.
  return Array.from(groups.values())
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((g) => ({ ...g, children: g.children.sort((a, b) => a.name.localeCompare(b.name)) }));
}

export function useServiceDefs(): { tree: ServiceDefNode[]; isLoading: boolean; error: unknown } {
  const { data, isLoading, error } = useQuery({
    queryKey: ['pgr-complaint-hierarchy', STATE_TENANT],
    queryFn: fetchServiceDefs,
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
  });

  const tree = data ? toTree(data) : [];
  return { tree, isLoading, error };
}
