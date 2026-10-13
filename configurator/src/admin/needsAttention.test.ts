import { describe, it, expect } from 'vitest';
import { attentionItems } from './needsAttention';

// cfgreview F28 (#1574): the dashboard lists what needs attention, each with where to fix it.
describe('attentionItems', () => {
  it('names categories without an SLA, active employees without areas and inactive tenants', () => {
    const items = attentionItems({
      categories: [{ code: 'A', slaHours: 24 }, { code: 'B' }, { code: 'C', slaHours: 0 }, { code: 'D', active: false }],
      employees: [
        { code: 'E1', jurisdictions: [{ boundary: 'W1' }] },
        { code: 'E2', jurisdictions: [] },
        { code: 'E3', jurisdictions: [{ boundary: 'W2', isActive: false }] },
        { code: 'E4', isActive: false },
      ],
      tenant: 'ke', tenants: [{ code: 'ke' }, { code: 'ke.bomet' }, { code: 'ke.old', _isActive: false }, { code: 'ke.e2e', _isActive: false }],
    });
    expect(items.map((i) => [i.id, i.count])).toEqual([['categories-no-sla', 2], ['employees-no-areas', 2], ['tenants-inactive', 2]]);
    expect(items[0].to).toBe('/manage/complaint-hierarchy');
  });

  it('counts inactive tenants in its own subtree only, not the whole state', () => {
    const tenants = [{ code: 'ke' }, { code: 'ke.bomet' }, { code: 'ke.bomet.x', _isActive: false }, { code: 'ke.old', _isActive: false }, { code: 'ke.old2', _isActive: false }];
    expect(attentionItems({ tenant: 'ke.bomet', tenants }).map((i) => [i.id, i.count])).toEqual([['tenants-inactive', 1]]);
    expect(attentionItems({ tenant: 'ke.bomet', tenants: tenants.slice(0, 2) })).toEqual([]);
  });

  it('returns nothing when nothing needs attention (or nothing is known yet)', () => {
    expect(attentionItems({ categories: [{ slaHours: 72 }], employees: [{ jurisdictions: [{ boundary: 'W' }] }], tenant: 'ke', tenants: [{ code: 'ke' }] })).toEqual([]);
    expect(attentionItems({})).toEqual([]);
  });
});
