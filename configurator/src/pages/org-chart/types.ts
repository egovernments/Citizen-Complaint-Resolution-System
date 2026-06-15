import type { Node, Edge } from '@xyflow/react';

export type OrgNodeKind = 'manager' | 'member' | 'orphan' | 'unresolved';

/** Index signature required so this satisfies @xyflow/react's Node<T> data constraint. */
export interface OrgNodeData {
  id: string;            // employee uuid (or manager uuid for an unresolved node)
  name: string;          // display name (user.name, or enriched name / raw uuid for unresolved)
  code?: string;         // employee code (undefined for unresolved nodes)
  designation?: string;
  department?: string;
  kind: OrgNodeKind;
  inactive: boolean;     // user.active === false
  inCycle: boolean;      // participates in a reporting cycle
  clickable: boolean;    // false for unresolved (no employee page to open)
  [key: string]: unknown;
}

export interface OrgEdge {
  source: string;        // manager uuid
  target: string;        // report uuid
}

export interface OrgGraphStats {
  total: number;
  withManager: number;
  orphans: number;
  unresolved: number;
  cycles: number;
}

export interface OrgGraph {
  nodes: OrgNodeData[];           // ALL nodes incl. orphans and unresolved
  edges: OrgEdge[];               // layout edges (cycle-free)
  orphanIds: string[];
  unresolvedManagerIds: string[];
  cycleEdges: OrgEdge[];          // back-edges removed to keep a DAG
  stats: OrgGraphStats;
}

export type OrgFlowNode = Node<OrgNodeData>;
export type OrgFlowEdge = Edge;
