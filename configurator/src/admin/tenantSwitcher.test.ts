import { describe, it, expect, beforeEach } from 'vitest';
import { homeTenant, subtreeOptions, tenantLabel } from './tenantSwitcher';

// cfgreview F04 (#1551): the header names the working tenant and switches within the admin's subtree.
describe('tenant switcher', () => {
  const rows = [
    { code: 'ke', name: 'Kenya' },
    { code: 'ke.bomet', name: 'Bomet County' },
    { code: 'ke.bomet.health', name: 'Health' },
    { code: 'ke.kilima', name: 'Kilima' },
    { code: 'ke.bometx', name: 'Not a child of ke.bomet' },
  ];

  it('offers the home tenant and every tenant below it, in tree order, with depth', () => {
    expect(subtreeOptions(rows, 'ke.bomet')).toEqual([
      { code: 'ke.bomet', name: 'Bomet County', depth: 0 },
      { code: 'ke.bomet.health', name: 'Health', depth: 1 },
    ]);
    expect(subtreeOptions(rows, 'ke').map((o) => o.code)).toEqual(['ke', 'ke.bomet', 'ke.bomet.health', 'ke.bometx', 'ke.kilima']);
  });

  it('keeps the home tenant even when its row is not readable', () => {
    expect(subtreeOptions([], 'ke.bomet')).toEqual([{ code: 'ke.bomet', name: 'ke.bomet', depth: 0 }]);
  });

  it('labels a tenant by name, else by code', () => {
    const o = subtreeOptions(rows, 'ke');
    expect(tenantLabel(o, 'ke.bomet')).toBe('Bomet County');
    expect(tenantLabel(o, 'ke.unknown')).toBe('ke.unknown');
  });

  describe('home tenant', () => {
    beforeEach(() => localStorage.clear());
    it('is remembered, so switching to a child does not shrink the list', () => {
      expect(homeTenant('u1', 'ke')).toBe('ke');
      expect(homeTenant('u1', 'ke.bomet')).toBe('ke');
    });
    it('is replaced when the current tenant is not under it (another login)', () => {
      expect(homeTenant('u1', 'ke.bomet')).toBe('ke.bomet');
      expect(homeTenant('u1', 'ke.kilima')).toBe('ke.kilima');
    });
  });
});
