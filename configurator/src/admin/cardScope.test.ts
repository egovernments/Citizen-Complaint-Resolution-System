import { describe, it, expect } from 'vitest';
import { cardScope, isCountyScopedSchema, tenantSubtree } from './cardScope';

// cfgreview F03 (#1550): a dashboard number says what it counts, so it agrees with the list it opens.
describe('cardScope', () => {
  it('names the scope, the inherited rows and the inactive ones the list also shows', () => {
    const rows = [
      { _tenantId: 'ke', _isActive: true }, { _tenantId: 'ke', _isActive: true },
      { _tenantId: 'ke.bomet', _isActive: true }, { _tenantId: 'ke', _isActive: false },
    ];
    expect(cardScope('ke.bomet', true, rows, 4, 1)).toBe('active at ke.bomet \u00b7 2 from ke \u00b7 list: 4 (1 inactive)');
  });
  it('is short when nothing is inherited or inactive, and says "at" for other lists', () => {
    expect(cardScope('ke', true, [{ _tenantId: 'ke', _isActive: true }], 1, 0)).toBe('active at ke');
    expect(cardScope('ke', false, [], undefined, 0)).toBe('at ke');
  });
  it('counts a county\'s own subtree of tenants, not the state\'s', () => {
    const rows = [
      { code: 'ke', _isActive: true }, { code: 'ke.bomet', _isActive: true }, { code: 'ke.bomet.health', _isActive: true },
      { code: 'ke.bomet.old', _isActive: false }, { code: 'ke.kilima', _isActive: true }, { code: 'ke.bometx', _isActive: true },
    ];
    expect(tenantSubtree('ke.bomet', rows)).toEqual({ active: 2, inactive: 1 });
    expect(tenantSubtree('ke', rows)).toEqual({ active: 5, inactive: 1 });
  });
  it('knows the county-scoped masters (option B)', () => {
    expect(isCountyScopedSchema('common-masters.Department')).toBe(true);
    expect(isCountyScopedSchema('RAINMAKER-PGR.ComplaintHierarchy')).toBe(true);
    expect(isCountyScopedSchema('tenant.tenants')).toBe(false);
    expect(isCountyScopedSchema(undefined)).toBe(false);
  });
});
