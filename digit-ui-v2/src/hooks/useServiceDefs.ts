/**
 * Fetch the PGR ServiceDefs catalogue (complaint types) from MDMS.
 *
 * The legacy citizen UI walks a two-level hierarchy: top-level service
 * (e.g. "Public Toilet") with sub-services as its `menuPath` children
 * (e.g. "Damaged", "Cleaning needed"). MDMS stores them flat with a
 * `menuPath` like `Public Toilet.Damaged` — we re-tree by splitting.
 *
 * Cached by react-query at 5 min stale time; the catalogue rarely
 * changes during a citizen session.
 */
import { useQuery } from '@tanstack/react-query';
import { apiClient, getApiBaseUrl } from '@/api';

const STATE_TENANT = (import.meta.env.VITE_CITIZEN_STATE_TENANT as string) || 'ke';

export interface ServiceDef {
  serviceCode: string;
  name: string;
  menuPath?: string;
  department?: string;
  active?: boolean;
}

export interface ServiceDefNode {
  serviceCode: string;
  name: string;
  children: ServiceDefNode[];
}

interface MdmsResponse {
  MdmsRes?: {
    'RAINMAKER-PGR'?: { ServiceDefs?: ServiceDef[] };
  };
}

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
            masterDetails: [{ name: 'ServiceDefs', filter: '[?(@.active == true)]' }],
          },
        ],
      },
    }),
  });
  if (!res.ok) throw new Error(`MDMS ServiceDefs fetch failed: HTTP ${res.status}`);
  const json = (await res.json()) as MdmsResponse;
  return json.MdmsRes?.['RAINMAKER-PGR']?.ServiceDefs ?? [];
}

function toTree(defs: ServiceDef[]): ServiceDefNode[] {
  // naipepea's PGR ServiceDefs use `menuPath` as a CATEGORY (single token like
  // "Administration"); every record has a real `serviceCode` of its own (e.g.
  // "DocumentProcessingDelay") that the PGR backend wants on submit. So:
  //
  //   menuPath  →  category (the parent node, NOT submittable itself)
  //   serviceCode + name  →  leaf the citizen actually picks
  //
  // Some deployments use the legacy "Parent.Child" menuPath; we treat both
  // shapes uniformly: split on '.', the first segment becomes the category
  // and we accumulate every record's serviceCode as a leaf under it.
  //
  // Category nodes carry a synthetic serviceCode (`__cat:<name>`) so the
  // wizard's "type" step can validate that the citizen picked something,
  // but the synthetic value never reaches the PGR _create payload — the
  // wizard requires a leaf serviceCode before letting the citizen advance.
  const categories = new Map<string, ServiceDefNode>();

  for (const d of defs) {
    const path = (d.menuPath || d.name || '').split('.').filter(Boolean);
    if (path.length === 0 || !d.serviceCode) continue;

    const categoryName = path[0];
    const humanName = path.length > 1 ? path.slice(1).join(' / ') : (d.name || d.serviceCode);

    let cat = categories.get(categoryName);
    if (!cat) {
      cat = {
        serviceCode: `__cat:${categoryName}`,
        name: categoryName,
        children: [],
      };
      categories.set(categoryName, cat);
    }
    cat.children.push({
      serviceCode: d.serviceCode,
      name: humanName,
      children: [],
    });
  }

  // Sort categories alphabetically; sort leaves within each by name.
  return Array.from(categories.values())
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => ({ ...c, children: c.children.sort((a, b) => a.name.localeCompare(b.name)) }));
}

export function useServiceDefs(): { tree: ServiceDefNode[]; isLoading: boolean; error: unknown } {
  const { data, isLoading, error } = useQuery({
    queryKey: ['pgr-service-defs', STATE_TENANT],
    queryFn: fetchServiceDefs,
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
  });

  const tree = data ? toTree(data) : [];
  return { tree, isLoading, error };
}
