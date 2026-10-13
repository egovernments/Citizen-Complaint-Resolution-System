import { describe, it, expect } from 'vitest';
import { groupAdvanced, isPlatformOnly } from './advancedGroups';

// cfgreview F21 (#1567): Advanced is grouped by area with a line each; platform masters are offered at the state only.
describe('groupAdvanced', () => {
  const names = ['theme-config', 'pgr-escalation', 'security-policy', 'degrees', 'something-new'];
  it('groups by area in a fixed order, each with a description, unknown ones under Other', () => {
    const g = groupAdvanced(names, true);
    expect(g.map((x) => x.id)).toEqual(['complaints', 'people', 'look', 'platform', 'other']);
    expect(g[0].items[0]).toEqual({ name: 'pgr-escalation', description: expect.stringMatching(/escalated/) });
    expect(g.every((x) => x.id === 'other' || x.items.every((i) => i.description))).toBe(true);
  });
  it('leaves the Platform group out below the state', () => {
    expect(groupAdvanced(names, false).map((x) => x.id)).toEqual(['complaints', 'people', 'look', 'other']);
    expect(isPlatformOnly('security-policy')).toBe(true);
    expect(isPlatformOnly('theme-config')).toBe(false);
  });
});
