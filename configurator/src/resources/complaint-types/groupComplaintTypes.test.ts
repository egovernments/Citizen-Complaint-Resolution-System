import { describe, it, expect } from 'vitest';
import { groupComplaintTypes, type SubTypeRecord } from './groupComplaintTypes';

// translate stub: returns the provided default (opts._) when given, else the
// key — simulates "no message found, fall back to default".
const translate = (key: string, opts?: { _?: string }) => opts?._ ?? key;

// translate stub with a known label only for SERVICEDEFS.SANITATION.
const translateWithLabel = (key: string, opts?: { _?: string }) =>
  key === 'SERVICEDEFS.SANITATION' ? 'Sanitation & Waste' : opts?._ ?? key;

function rec(p: Partial<SubTypeRecord> & { serviceCode: string }): SubTypeRecord {
  return { id: p.serviceCode, ...p };
}

describe('groupComplaintTypes', () => {
  it('groups records by menuPath case-insensitively', () => {
    const groups = groupComplaintTypes(
      [
        rec({ serviceCode: 'A', menuPath: 'Sanitation', order: 1, active: true }),
        rec({ serviceCode: 'B', menuPath: 'SANITATION', order: 2, active: true }),
      ],
      translate,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(2);
  });

  it('computes count and activeCount', () => {
    const groups = groupComplaintTypes(
      [
        rec({ serviceCode: 'A', menuPath: 'Roads', order: 1, active: true }),
        rec({ serviceCode: 'B', menuPath: 'Roads', order: 2, active: false }),
        rec({ serviceCode: 'C', menuPath: 'Roads', order: 3, active: true }),
      ],
      translate,
    );
    expect(groups[0].count).toBe(3);
    expect(groups[0].activeCount).toBe(2);
  });

  it('puts records with no menuPath into an Uncategorized group, placed last', () => {
    const groups = groupComplaintTypes(
      [
        rec({ serviceCode: 'A', menuPath: undefined, order: 1 }),
        rec({ serviceCode: 'B', menuPath: '  ', order: 2 }),
        rec({ serviceCode: 'C', menuPath: 'Water', order: 5 }),
      ],
      translate,
    );
    expect(groups).toHaveLength(2);
    const last = groups[groups.length - 1];
    expect(last.isUncategorized).toBe(true);
    expect(last.count).toBe(2);
  });

  it('uses SERVICEDEFS.<MENUPATH> label when present, else the raw menuPath', () => {
    const groups = groupComplaintTypes(
      [
        rec({ serviceCode: 'A', menuPath: 'Sanitation', order: 1 }),
        rec({ serviceCode: 'B', menuPath: 'Roads', order: 2 }),
      ],
      translateWithLabel,
    );
    const sanitation = groups.find((g) => g.menuPath === 'SANITATION')!;
    const roads = groups.find((g) => g.menuPath === 'ROADS')!;
    expect(sanitation.label).toBe('Sanitation & Waste');
    expect(roads.label).toBe('Roads');
  });

  it('orders types by the group minimum order, Uncategorized always last', () => {
    const groups = groupComplaintTypes(
      [
        rec({ serviceCode: 'A', menuPath: 'Water', order: 10 }),
        rec({ serviceCode: 'B', menuPath: 'Roads', order: 2 }),
        rec({ serviceCode: 'C', menuPath: 'Roads', order: 99 }),
        rec({ serviceCode: 'D', menuPath: undefined, order: 1 }),
      ],
      translate,
    );
    expect(groups.map((g) => g.menuPath)).toEqual(['ROADS', 'WATER', '']);
  });

  it('orders sub-types within a group by order then serviceCode', () => {
    const groups = groupComplaintTypes(
      [
        rec({ serviceCode: 'Zebra', menuPath: 'Roads', order: 1 }),
        rec({ serviceCode: 'Alpha', menuPath: 'Roads', order: 1 }),
        rec({ serviceCode: 'Mango', menuPath: 'Roads', order: 0 }),
      ],
      translate,
    );
    expect(groups[0].subTypes.map((s) => s.serviceCode)).toEqual([
      'Mango',
      'Alpha',
      'Zebra',
    ]);
  });
});
