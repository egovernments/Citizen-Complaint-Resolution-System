import { describe, it, expect } from 'vitest';
import { cardScope } from './cardScope';

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
});
