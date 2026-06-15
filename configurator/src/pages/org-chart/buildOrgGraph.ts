import type { Employee, EmployeeAssignment } from '@/api/types';
import type { OrgGraph, OrgNodeData, OrgEdge } from './types';

/** Pick the current assignment, falling back to the most recent by fromDate. */
function currentAssignment(emp: Employee): EmployeeAssignment | undefined {
  const assigns = emp.assignments ?? [];
  if (assigns.length === 0) return undefined;
  const current = assigns.find((a) => a.isCurrentAssignment);
  if (current) return current;
  return [...assigns].sort((a, b) => (b.fromDate ?? 0) - (a.fromDate ?? 0))[0];
}

export function buildOrgGraph(employees: Employee[]): OrgGraph {
  const byUuid = new Map<string, Employee>();
  for (const e of employees) {
    if (e.uuid) byUuid.set(e.uuid, e);
  }

  // 1. Collect raw edges + classify unresolved / self-ref.
  const rawEdges: OrgEdge[] = [];
  const unresolved = new Set<string>();
  for (const e of employees) {
    if (!e.uuid) continue;
    const mgr = currentAssignment(e)?.reportingTo;
    if (!mgr || mgr === e.uuid) continue;        // missing or self-reference
    if (!byUuid.has(mgr)) unresolved.add(mgr);
    rawEdges.push({ source: mgr, target: e.uuid });
  }

  // 2. Break cycles: add an edge only if it doesn't close a cycle in the DAG so far.
  const adj = new Map<string, string[]>();
  const reaches = (from: string, to: string): boolean => {
    const stack = [from];
    const seen = new Set<string>();
    while (stack.length) {
      const n = stack.pop()!;
      if (n === to) return true;
      if (seen.has(n)) continue;
      seen.add(n);
      for (const m of adj.get(n) ?? []) stack.push(m);
    }
    return false;
  };
  const edges: OrgEdge[] = [];
  const cycleEdges: OrgEdge[] = [];
  for (const edge of rawEdges) {
    // edge source->target closes a cycle if target already reaches source.
    if (reaches(edge.target, edge.source)) {
      cycleEdges.push(edge);
    } else {
      edges.push(edge);
      (adj.get(edge.source) ?? adj.set(edge.source, []).get(edge.source)!).push(edge.target);
    }
  }

  // 3. Connectivity (count both layout and cycle edges so cycle members aren't orphaned).
  const hasOut = new Set<string>();
  const hasIn = new Set<string>();
  const cycleNodeIds = new Set<string>();
  for (const e of [...edges, ...cycleEdges]) {
    hasOut.add(e.source);
    hasIn.add(e.target);
  }
  for (const e of cycleEdges) {
    cycleNodeIds.add(e.source);
    cycleNodeIds.add(e.target);
  }

  // 4. Build employee nodes.
  const nodes: OrgNodeData[] = [];
  const orphanIds: string[] = [];
  for (const e of employees) {
    if (!e.uuid) continue;
    const assign = currentAssignment(e);
    const isManager = hasOut.has(e.uuid);
    const hasManager = hasIn.has(e.uuid);
    let kind: OrgNodeData['kind'];
    if (!isManager && !hasManager) {
      kind = 'orphan';
      orphanIds.push(e.uuid);
    } else {
      kind = isManager ? 'manager' : 'member';
    }
    nodes.push({
      id: e.uuid,
      name: e.user?.name || e.code,
      code: e.code,
      designation: assign?.designation,
      department: assign?.department,
      kind,
      inactive: e.user?.active === false,
      inCycle: cycleNodeIds.has(e.uuid),
      clickable: true,
    });
  }

  // 5. Synthetic nodes for unresolved managers.
  for (const uuid of unresolved) {
    nodes.push({
      id: uuid,
      name: uuid,                     // enriched later by the data hook
      code: undefined,
      designation: undefined,
      department: undefined,
      kind: 'unresolved',
      inactive: false,
      inCycle: cycleNodeIds.has(uuid),
      clickable: false,
    });
  }

  return {
    nodes,
    edges,
    orphanIds,
    unresolvedManagerIds: [...unresolved],
    cycleEdges,
    stats: {
      total: byUuid.size,
      withManager: hasIn.size,
      orphans: orphanIds.length,
      unresolved: unresolved.size,
      cycles: cycleEdges.length,
    },
  };
}
