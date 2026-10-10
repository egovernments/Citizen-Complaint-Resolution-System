import { describe, it, expect } from 'vitest';
import { levelsForSave } from './hierarchyLevels';
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
