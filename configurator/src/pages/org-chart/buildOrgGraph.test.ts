import { describe, it, expect } from 'vitest';
import { buildOrgGraph } from './buildOrgGraph';
import type { Employee } from '@/api/types';

function emp(uuid: string, reportingTo?: string, over: Partial<Employee> = {}): Employee {
  return {
    code: uuid.toUpperCase(),
    tenantId: 'ke',
    uuid,
    employeeStatus: 'EMPLOYED',
    employeeType: 'PERMANENT',
    jurisdictions: [],
    user: { userName: uuid, name: `Name ${uuid}`, mobileNumber: '0', roles: [], active: true },
    assignments: [
      { designation: 'CLERK', department: 'HEALTH', fromDate: 100, isCurrentAssignment: true, reportingTo },
    ],
    ...over,
  };
}

describe('buildOrgGraph', () => {
  it('builds manager->report edges from reportingTo', () => {
    const g = buildOrgGraph([emp('a'), emp('b', 'a')]);
    expect(g.edges).toEqual([{ source: 'a', target: 'b' }]);
    expect(g.nodes.find((n) => n.id === 'a')!.kind).toBe('manager');
    expect(g.nodes.find((n) => n.id === 'b')!.kind).toBe('member');
  });

  it('classifies employees with no manager and no reports as orphans', () => {
    const g = buildOrgGraph([emp('a'), emp('b', 'a'), emp('lonely')]);
    expect(g.orphanIds).toEqual(['lonely']);
    expect(g.nodes.find((n) => n.id === 'lonely')!.kind).toBe('orphan');
  });

  it('records unresolved managers and creates a synthetic unresolved node', () => {
    const g = buildOrgGraph([emp('b', 'ghost')]);
    expect(g.unresolvedManagerIds).toEqual(['ghost']);
    const ghost = g.nodes.find((n) => n.id === 'ghost')!;
    expect(ghost.kind).toBe('unresolved');
    expect(ghost.clickable).toBe(false);
    expect(g.edges).toEqual([{ source: 'ghost', target: 'b' }]);
  });

  it('ignores self-references', () => {
    const g = buildOrgGraph([emp('a', 'a')]);
    expect(g.edges).toEqual([]);
    expect(g.orphanIds).toEqual(['a']);
  });

  it('breaks cycles: keeps the first edge, moves the back-edge to cycleEdges', () => {
    const g = buildOrgGraph([emp('a', 'b'), emp('b', 'a')]);
    expect(g.edges.length).toBe(1);
    expect(g.cycleEdges.length).toBe(1);
    expect(g.stats.cycles).toBe(1);
    expect(g.nodes.find((n) => n.id === 'a')!.inCycle).toBe(true);
    expect(g.nodes.find((n) => n.id === 'b')!.inCycle).toBe(true);
  });

  it('uses the current assignment for reportingTo, not historical ones', () => {
    const e = emp('b', undefined, {
      assignments: [
        { designation: 'OLD', department: 'X', fromDate: 50, toDate: 90, isCurrentAssignment: false, reportingTo: 'historical' },
        { designation: 'NEW', department: 'Y', fromDate: 100, isCurrentAssignment: true, reportingTo: 'a' },
      ],
    });
    const g = buildOrgGraph([emp('a'), e]);
    expect(g.edges).toEqual([{ source: 'a', target: 'b' }]);
  });

  it('falls back to the most recent assignment when none is marked current', () => {
    const e = emp('b', undefined, {
      assignments: [
        { designation: 'OLD', department: 'X', fromDate: 50, isCurrentAssignment: false, reportingTo: 'old-mgr' },
        { designation: 'NEW', department: 'Y', fromDate: 200, isCurrentAssignment: false, reportingTo: 'a' },
      ],
    });
    const g = buildOrgGraph([emp('a'), e]);
    expect(g.edges).toEqual([{ source: 'a', target: 'b' }]);
  });

  it('computes stats', () => {
    const g = buildOrgGraph([emp('a'), emp('b', 'a'), emp('c', 'ghost'), emp('lonely')]);
    expect(g.stats).toEqual({ total: 4, withManager: 2, orphans: 1, unresolved: 1, cycles: 0 });
  });

  it('marks inactive employees', () => {
    const e = emp('a', undefined, { user: { userName: 'a', name: 'A', mobileNumber: '0', roles: [], active: false } });
    const g = buildOrgGraph([e]);
    expect(g.nodes.find((n) => n.id === 'a')!.inactive).toBe(true);
  });

  it('flags ALL members of a 3-node cycle as inCycle', () => {
    const g = buildOrgGraph([emp('a', 'b'), emp('b', 'c'), emp('c', 'a')]);
    expect(g.cycleEdges.length).toBe(1);
    expect(g.stats.cycles).toBe(1);
    for (const id of ['a', 'b', 'c']) {
      expect(g.nodes.find((n) => n.id === id)!.inCycle).toBe(true);
    }
  });

  it('classifies an intermediate node (has a manager AND reports) as manager', () => {
    // a -> b -> c  (b reports to a, c reports to b)
    const g = buildOrgGraph([emp('a'), emp('b', 'a'), emp('c', 'b')]);
    expect(g.nodes.find((n) => n.id === 'b')!.kind).toBe('manager');
  });
});
