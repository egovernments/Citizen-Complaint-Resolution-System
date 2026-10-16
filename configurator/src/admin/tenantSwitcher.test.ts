import { describe, it, expect, beforeEach } from 'vitest';
import { adminHome, homeTenant, optionText, subtreeOptions, tenantLabel } from './tenantSwitcher';

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

  it('marks the depth with em-dashes, not spaces a native select would collapse', () => {
    expect(optionText({ code: 'ke.bomet.health', name: 'Health', depth: 2 })).toBe('— — Health (ke.bomet.health)');
    expect(optionText({ code: 'ke', name: 'Kenya', depth: 0 })).toBe('Kenya (ke)');
  });

  describe('admin home from identity memberships', () => {
    it('is the highest tenant where the user is ACCOUNT_ADMIN / SUPERUSER', () => {
      expect(adminHome([
        { tenantId: 'ke.bomet', roles: ['ACCOUNT_ADMIN'] },
        { tenantId: 'ke', roles: ['SUPERUSER', 'GRO'] },
        { tenantId: 'ke.kilima', roles: ['GRO'] },
      ])).toBe('ke');
    });
    it('falls back to the highest tenant they may enter, and to null without memberships', () => {
      expect(adminHome([{ tenantId: 'ke.bomet.health', roles: ['GRO'] }, { tenantId: 'ke.bomet', roles: ['PGR_LME'] }])).toBe('ke.bomet');
      expect(adminHome([{ tenantId: 'ke', roles: ['ACCOUNT_ADMIN'], code: 'DIGIT_ACCOUNT_INACTIVE' }])).toBeNull();
      expect(adminHome([])).toBeNull();
    });
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
