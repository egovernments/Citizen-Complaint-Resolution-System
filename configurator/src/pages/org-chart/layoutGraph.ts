import * as dagre from 'dagre';
import type { OrgNodeData, OrgEdge, OrgFlowNode, OrgFlowEdge } from './types';

const NODE_W = 240;
const NODE_H = 96;

export function layoutGraph(
  nodes: OrgNodeData[],
  edges: OrgEdge[],
): { nodes: OrgFlowNode[]; edges: OrgFlowEdge[] } {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'TB', nodesep: 40, ranksep: 80 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const n of nodes) g.setNode(n.id, { width: NODE_W, height: NODE_H });
  for (const e of edges) {
    // Only lay out edges whose endpoints are present in this node set.
    if (g.hasNode(e.source) && g.hasNode(e.target)) g.setEdge(e.source, e.target);
  }

  dagre.layout(g);

  const flowNodes: OrgFlowNode[] = nodes.map((n) => {
    const pos = g.node(n.id);
    return {
      id: n.id,
      type: 'employee',
      position: { x: (pos?.x ?? 0) - NODE_W / 2, y: (pos?.y ?? 0) - NODE_H / 2 },
      data: n,
    };
  });

  const flowEdges: OrgFlowEdge[] = edges
    .filter((e) => g.hasNode(e.source) && g.hasNode(e.target))
    .map((e) => ({
      id: `${e.source}->${e.target}`,
      source: e.source,
      target: e.target,
      type: 'smoothstep',
    }));

  return { nodes: flowNodes, edges: flowEdges };
}
