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
      tenantsListed: 708, tenantsActive: 9,
    });
    expect(items.map((i) => [i.id, i.count])).toEqual([['categories-no-sla', 2], ['employees-no-areas', 2], ['tenants-inactive', 699]]);
    expect(items[0].to).toBe('/manage/complaint-hierarchy');
  });

  it('returns nothing when nothing needs attention (or nothing is known yet)', () => {
    expect(attentionItems({ categories: [{ slaHours: 72 }], employees: [{ jurisdictions: [{ boundary: 'W' }] }], tenantsListed: 3, tenantsActive: 3 })).toEqual([]);
    expect(attentionItems({})).toEqual([]);
  });
});
