import { describe, it, expect } from 'vitest';
import { layoutGraph } from './layoutGraph';
import type { OrgNodeData } from './types';

function node(id: string): OrgNodeData {
  return { id, name: id, kind: 'member', inactive: false, inCycle: false, clickable: true };
}

describe('layoutGraph', () => {
  it('assigns a position to every node and an edge id', () => {
    const { nodes, edges } = layoutGraph(
      [node('a'), node('b')],
      [{ source: 'a', target: 'b' }],
    );
    expect(nodes).toHaveLength(2);
    for (const n of nodes) {
      expect(typeof n.position.x).toBe('number');
      expect(typeof n.position.y).toBe('number');
      expect(n.type).toBe('employee');
    }
    expect(edges[0].id).toBe('a->b');
  });

  it('positions a child below its parent (top-down)', () => {
    const { nodes } = layoutGraph(
      [node('a'), node('b')],
      [{ source: 'a', target: 'b' }],
    );
    const a = nodes.find((n) => n.id === 'a')!;
    const b = nodes.find((n) => n.id === 'b')!;
    expect(b.position.y).toBeGreaterThan(a.position.y);
  });

  it('does not throw on disconnected nodes', () => {
    expect(() => layoutGraph([node('a'), node('b')], [])).not.toThrow();
  });
});
