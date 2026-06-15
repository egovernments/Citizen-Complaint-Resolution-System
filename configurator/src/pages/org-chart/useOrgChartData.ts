import { useQuery } from '@tanstack/react-query';
import { hrmsService } from '@/api/services/hrms';
import { apiClient } from '@/api/client';
import { ENDPOINTS } from '@/api/config';
import { buildOrgGraph } from './buildOrgGraph';
import { layoutGraph } from './layoutGraph';
import type { OrgGraph, OrgNodeData, OrgFlowNode, OrgFlowEdge } from './types';

const CAP = 1000;

interface UserSearchResponse {
  user?: Array<{ uuid?: string; name?: string; userName?: string }>;
}

/** One batched /user/_search to put real names on dangling manager UUIDs. */
async function enrichUnresolved(tenantId: string, uuids: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (uuids.length === 0) return names;
  try {
    const resp = (await apiClient.post(ENDPOINTS.USER_SEARCH, {
      RequestInfo: apiClient.buildRequestInfo({ action: '_search' }),
      tenantId,
      uuid: uuids,
    })) as unknown as UserSearchResponse;
    for (const u of resp.user ?? []) {
      const label = u.name
        ? `${u.name}${u.userName ? ` (${u.userName})` : ''}`
        : u.userName;
      if (u.uuid && label) names.set(u.uuid, label);
    }
  } catch (err) {
    console.warn('org-chart: unresolved-manager enrichment failed', err);
  }
  return names;
}

export interface OrgChartData {
  graph: OrgGraph;
  canvasNodes: OrgFlowNode[];
  canvasEdges: OrgFlowEdge[];
  orphanNodes: OrgNodeData[];
  truncated: boolean;
}

export function useOrgChartData(tenantId: string | undefined) {
  return useQuery<OrgChartData>({
    queryKey: ['org-chart', tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const employees = await hrmsService.searchEmployees(tenantId!, { limit: CAP });
      const truncated = employees.length >= CAP;

      const graph = buildOrgGraph(employees);

      const names = await enrichUnresolved(tenantId!, graph.unresolvedManagerIds);
      if (names.size) {
        for (const n of graph.nodes) {
          if (n.kind === 'unresolved' && names.has(n.id)) n.name = names.get(n.id)!;
        }
      }

      const orphanSet = new Set(graph.orphanIds);
      const connected = graph.nodes.filter((n) => !orphanSet.has(n.id));
      const { nodes: canvasNodes, edges: canvasEdges } = layoutGraph(connected, graph.edges);
      const orphanNodes = graph.nodes.filter((n) => orphanSet.has(n.id));

      return { graph, canvasNodes, canvasEdges, orphanNodes, truncated };
    },
  });
}
