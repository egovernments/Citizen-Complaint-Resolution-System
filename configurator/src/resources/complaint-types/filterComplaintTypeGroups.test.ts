import { describe, it, expect } from 'vitest';
import { filterComplaintTypeGroups } from './filterComplaintTypeGroups';
import type { ComplaintTypeGroup } from './groupComplaintTypes';

function group(over: Partial<ComplaintTypeGroup>): ComplaintTypeGroup {
  return {
    menuPath: 'X',
    label: 'X',
    count: 0,
    activeCount: 0,
    isUncategorized: false,
    minOrder: 0,
    subTypes: [],
    ...over,
  };
}

const groups: ComplaintTypeGroup[] = [
  group({
    menuPath: 'SANITATION',
    label: 'Sanitation',
    count: 2,
    activeCount: 2,
    subTypes: [
      { id: 'g', serviceCode: 'GarbageNotCollected', name: 'Garbage not collected', active: true },
      { id: 'b', serviceCode: 'OverflowingBin', name: 'Overflowing bin', active: true },
    ],
  }),
  group({
    menuPath: 'ROADS',
    label: 'Roads',
    count: 1,
    activeCount: 0,
    subTypes: [
      { id: 'p', serviceCode: 'PotHole', name: 'Pot hole', active: false },
    ],
  }),
];

describe('filterComplaintTypeGroups', () => {
  it('returns the same array reference for an empty/whitespace query', () => {
    expect(filterComplaintTypeGroups(groups, '')).toBe(groups);
    expect(filterComplaintTypeGroups(groups, '   ')).toBe(groups);
  });

  it('matches a group by its label and keeps all sub-types', () => {
    const out = filterComplaintTypeGroups(groups, 'sanit');
    expect(out).toHaveLength(1);
    expect(out[0].menuPath).toBe('SANITATION');
    expect(out[0].subTypes).toHaveLength(2);
  });

  it('matches by sub-type name and keeps only matching sub-types with recomputed counts', () => {
    const out = filterComplaintTypeGroups(groups, 'garbage');
    expect(out).toHaveLength(1);
    expect(out[0].menuPath).toBe('SANITATION');
    expect(out[0].subTypes.map((s) => s.serviceCode)).toEqual(['GarbageNotCollected']);
    expect(out[0].count).toBe(1);
    expect(out[0].activeCount).toBe(1);
  });

  it('matches by sub-type serviceName when name is absent', () => {
    const withServiceName: ComplaintTypeGroup[] = [
      group({
        menuPath: 'WATER',
        label: 'Water',
        count: 1,
        activeCount: 1,
        subTypes: [
          { id: 'l', serviceCode: 'LeakReport', serviceName: 'Pipe leakage', active: true },
        ],
      }),
    ];
    const out = filterComplaintTypeGroups(withServiceName, 'leakage');
    expect(out).toHaveLength(1);
    expect(out[0].subTypes).toHaveLength(1);
  });

  it('matches by sub-type service code', () => {
    const out = filterComplaintTypeGroups(groups, 'pothole');
    expect(out).toHaveLength(1);
    expect(out[0].menuPath).toBe('ROADS');
    expect(out[0].subTypes).toHaveLength(1);
  });

  it('returns an empty array when nothing matches', () => {
    expect(filterComplaintTypeGroups(groups, 'zzz')).toEqual([]);
  });

  it('is case-insensitive', () => {
    expect(filterComplaintTypeGroups(groups, 'ROADS')).toHaveLength(1);
  });
});
