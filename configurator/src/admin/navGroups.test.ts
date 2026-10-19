import { describe, it, expect } from 'vitest';
import { getGenericMdmsResources, getResourceConfig } from '@/providers/bridge';
import { navGroups, getAdvancedResourceIds } from './navGroups';

// The rule Advanced must follow, checked against the real menu and registry
// rather than a list of ids, so it holds for whatever is added to either.
describe('Advanced resources', () => {
  const sidebarIds = new Set(navGroups.flatMap((group) => group.items.map((item) => item.id)));
  const advanced = new Set(getAdvancedResourceIds());

  it('lists no resource that already has a sidebar entry', () => {
    expect([...advanced].filter((id) => sidebarIds.has(id))).toEqual([]);
  });

  it('lists every generic MDMS resource that has no sidebar entry and is not unlisted', () => {
    for (const id of Object.keys(getGenericMdmsResources())) {
      const expected = !sidebarIds.has(id) && !getResourceConfig(id)?.unlisted;
      expect(advanced.has(id), id).toBe(expected);
    }
  });

  it('lists only generic MDMS resources', () => {
    const generic = getGenericMdmsResources();
    expect([...advanced].filter((id) => !generic[id])).toEqual([]);
  });
});
