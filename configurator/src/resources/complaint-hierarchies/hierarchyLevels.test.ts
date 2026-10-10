import { describe, it, expect } from 'vitest';
import { levelsForSave, levelsForEdit } from './hierarchyLevels';
import { getDescriptor } from '../../admin/schemaDescriptors';
import { getGenericMdmsResources } from '../../../packages/data-provider/src/providers/resourceRegistry';

describe('complaint hierarchy levels (Create)', () => {
  it('keeps the label, free-text and active the operator set', () => {
    expect(levelsForSave([
      { levelCode: 'CATEGORY', parentLevel: null, label: 'Kind of problem', isFreeText: false, active: true },
      { levelCode: 'SUB_TYPE', parentLevel: 'CATEGORY', isLeafServiceCode: true, label: 'Problem', isFreeText: true, active: false },
    ])).toEqual([
      { levelCode: 'CATEGORY', order: 1, parentLevel: null, isFreeText: false, isLeafServiceCode: false, label: 'Kind of problem', active: true },
      { levelCode: 'SUB_TYPE', order: 2, parentLevel: 'CATEGORY', isFreeText: true, isLeafServiceCode: true, label: 'Problem', active: false },
    ]);
  });
  it('fills only what is empty: order = position, label = code, not free text, active', () => {
    expect(levelsForSave([{ levelCode: 'A' }, { levelCode: '' }, { levelCode: 'B', parentLevel: 'A', label: '  ' }])).toEqual([
      { levelCode: 'A', order: 1, parentLevel: null, isFreeText: false, isLeafServiceCode: false, label: 'A', active: true },
      { levelCode: 'B', order: 2, parentLevel: 'A', isFreeText: false, isLeafServiceCode: false, label: 'B', active: true },
    ]);
  });
});

describe('complaint hierarchy levels (Edit of a live definition)', () => {
  const saved = [
    { levelCode: 'CATEGORY', order: 1, isFreeText: false, isLeafServiceCode: false, label: 'Category' },
    { levelCode: 'SUB_TYPE', order: 2, parentLevel: 'CATEGORY', isFreeText: false, isLeafServiceCode: true, label: 'Sub-Type' },
  ];
  it('takes label, free-text and active from the form, by level code', () => {
    const out = levelsForEdit(saved, [
      { levelCode: 'CATEGORY', label: ' Kind of problem ', isFreeText: true, active: false },
      { levelCode: 'SUB_TYPE', label: 'Problem' },
    ]);
    expect(out[0]).toEqual({ levelCode: 'CATEGORY', order: 1, isFreeText: true, isLeafServiceCode: false, label: 'Kind of problem', active: false });
    expect(out[1]).toEqual({ levelCode: 'SUB_TYPE', order: 2, parentLevel: 'CATEGORY', isFreeText: false, isLeafServiceCode: true, label: 'Problem', active: true });
  });
  it('keeps the saved structure whatever the form sends', () => {
    const out = levelsForEdit(saved, [
      { levelCode: 'SUB_TYPE', parentLevel: null, isLeafServiceCode: false },
      { levelCode: 'NEW', label: 'x' },
    ]);
    expect(out.map((l) => [l.levelCode, l.order, l.parentLevel ?? null, l.isLeafServiceCode, l.label])).toEqual([
      ['CATEGORY', 1, null, false, 'Category'],
      ['SUB_TYPE', 2, 'CATEGORY', true, 'Sub-Type'],
    ]);
  });
});

describe('complaint hierarchy nodes (interior types)', () => {
  it('is a generic MDMS screen on the whole ComplaintHierarchy master', () => {
    expect(getGenericMdmsResources()['complaint-hierarchy-nodes']?.schema).toBe('RAINMAKER-PGR.ComplaintHierarchy');
  });
  it('locks the key (hierarchyType + code) on edit and edits departments as a list', () => {
    const d = getDescriptor('RAINMAKER-PGR.ComplaintHierarchy')!;
    expect(d.fields.find((f) => f.path === 'code')?.hidden).toBe('edit');
    expect(d.fields.find((f) => f.path === 'hierarchyType')?.hidden).toBe('edit');
    expect(d.fields.find((f) => f.path === 'departments')?.widget).toBe('chip-array');
  });
});
