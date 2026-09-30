import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mdmsService } from '@/api';
import type { MdmsRecord } from '@/api/types';
import { loadComplaints, rowsFor, saveComplaints, type ComplaintDraft } from './complaintsApi';

vi.mock('@/api', () => ({
  mdmsService: { searchRecords: vi.fn(), create: vi.fn(async () => ({})), update: vi.fn(async () => ({})), setActive: vi.fn(async () => ({})) },
  localizationService: {
    uploadComplaintTypeLocalizations: vi.fn(async () => ({ success: 1, failed: 0 })),
    cacheBust: vi.fn(async () => undefined),
  },
}));

const search = vi.mocked(mdmsService.searchRecords);
const create = vi.mocked(mdmsService.create);
const update = vi.mocked(mdmsService.update);
const setActive = vi.mocked(mdmsService.setActive);

const row = (code: string, data: Record<string, unknown>, extra: Partial<MdmsRecord> = {}): MdmsRecord => ({
  id: code,
  tenantId: 'acme',
  schemaCode: 'RAINMAKER-PGR.ComplaintHierarchy',
  uniqueIdentifier: code,
  isActive: true,
  data: { hierarchyType: 'PGR', code, ...data },
  ...extra,
});

const draft: ComplaintDraft = {
  slaHours: 72,
  types: [
    { name: 'Street lighting', department: 'ROADS', subtypes: [{ name: 'Broken lamp' }, { name: 'Flickering lamp' }] },
    { name: 'Garbage', department: 'HEALTH', subtypes: [] },
  ],
};

beforeEach(() => vi.clearAllMocks());

describe('rowsFor', () => {
  it('builds a two-level PGR hierarchy with the leaf fields on what people file against', () => {
    const rows = rowsFor(draft, []);
    expect(rows.map((r) => [r.code, r.data.levelCode, r.data.parentCode, r.data.path])).toEqual([
      ['StreetLighting', 'COMPLAINT_TYPE', null, 'StreetLighting'],
      ['StreetLightingBrokenLamp', 'SUB_TYPE', 'StreetLighting', 'StreetLighting.StreetLightingBrokenLamp'],
      ['StreetLightingFlickeringLamp', 'SUB_TYPE', 'StreetLighting', 'StreetLighting.StreetLightingFlickeringLamp'],
      ['Garbage', 'COMPLAINT_TYPE', null, 'Garbage'],
    ]);
    // A type with subtypes is only a heading; its subtypes carry the department and time
    expect(rows[0].data).not.toHaveProperty('slaHours');
    expect(rows[1].data).toMatchObject({ department: 'ROADS', slaHours: 72 });
    // A type with none is filed against directly
    expect(rows[3].data).toMatchObject({ department: 'HEALTH', slaHours: 72 });
  });

  it('keeps saved codes on rename and never reuses a taken one', () => {
    const renamed: ComplaintDraft = {
      slaHours: 24,
      types: [{ code: 'StreetLighting', name: 'Lights', department: 'ROADS', subtypes: [{ code: 'StreetLightingBrokenLamp', name: 'Dead lamp' }] }],
    };
    const rows = rowsFor(renamed, ['StreetLighting', 'StreetLightingBrokenLamp', 'Garbage']);
    expect(rows.map((r) => [r.code, r.data.name])).toEqual([
      ['StreetLighting', 'Lights'],
      ['StreetLightingBrokenLamp', 'Dead lamp'],
    ]);
    const clash = rowsFor({ slaHours: 24, types: [{ name: 'Garbage', department: 'HEALTH', subtypes: [] }] }, ['Garbage']);
    expect(clash[0].code).toBe('Garbage2');
  });
});

describe('loadComplaints', () => {
  it('turns a two-level hierarchy back into a draft', async () => {
    search.mockImplementation(async (_tenant, schema) =>
      schema === 'RAINMAKER-PGR.ComplaintHierarchyDefinition'
        ? [row('PGR', { levels: [{ levelCode: 'COMPLAINT_TYPE' }, { levelCode: 'SUB_TYPE' }] }, { schemaCode: schema })]
        : [
            row('StreetLighting', { levelCode: 'COMPLAINT_TYPE', name: 'Street lighting', order: 1 }),
            row('StreetLightingBrokenLamp', { levelCode: 'SUB_TYPE', name: 'Broken lamp', parentCode: 'StreetLighting', department: 'ROADS', slaHours: 48, order: 2 }),
          ],
    );
    const loaded = await loadComplaints('acme');
    expect(loaded.editable).toBe(true);
    if (!loaded.editable) return;
    expect(loaded.draft).toEqual({
      slaHours: 48,
      types: [{ code: 'StreetLighting', name: 'Street lighting', department: 'ROADS', subtypes: [{ code: 'StreetLightingBrokenLamp', name: 'Broken lamp' }] }],
    });
  });

  it('leaves a spreadsheet hierarchy with other levels alone', async () => {
    search.mockImplementation(async (_tenant, schema) =>
      schema === 'RAINMAKER-PGR.ComplaintHierarchyDefinition'
        ? [row('PGR', { levels: [{ levelCode: 'AUTHORITY_TYPE' }, { levelCode: 'MAIN_CATEGORY' }, { levelCode: 'SUB_TYPE' }] }, { schemaCode: schema })]
        : [row('A', { levelCode: 'SUB_TYPE', department: 'X', slaHours: 24 })],
    );
    expect(await loadComplaints('acme')).toEqual({ editable: false, leafCount: 1, levels: ['AUTHORITY_TYPE', 'MAIN_CATEGORY', 'SUB_TYPE'] });
  });
});

describe('saveComplaints', () => {
  it('creates the definition and new rows, updates changed ones, deactivates dropped ones', async () => {
    const existing = [
      row('StreetLighting', { levelCode: 'COMPLAINT_TYPE', name: 'Street lighting', parentCode: null, order: 1, active: true, path: 'StreetLighting' }),
      row('Potholes', { levelCode: 'COMPLAINT_TYPE', name: 'Potholes', department: 'ROADS', slaHours: 72 }),
    ];
    search.mockResolvedValue(existing);
    const saved: ComplaintDraft = {
      slaHours: 72,
      types: [{ code: 'StreetLighting', name: 'Street lights', department: 'ROADS', subtypes: [{ name: 'Broken lamp' }] }],
    };

    const filable = await saveComplaints('acme', { editable: true, draft: saved, records: existing, hasDefinition: false }, saved);

    expect(filable).toBe(1);
    expect(create).toHaveBeenCalledWith('acme', 'RAINMAKER-PGR.ComplaintHierarchyDefinition', 'PGR', expect.objectContaining({ hierarchyType: 'PGR' }));
    expect(update).toHaveBeenCalledWith(existing[0], expect.objectContaining({ name: 'Street lights' }));
    expect(create).toHaveBeenCalledWith(
      'acme',
      'RAINMAKER-PGR.ComplaintHierarchy',
      // A new subtype takes its code from the type's current name; its parent keeps the saved code
      'StreetLightsBrokenLamp',
      expect.objectContaining({ parentCode: 'StreetLighting', path: 'StreetLighting.StreetLightsBrokenLamp', department: 'ROADS', slaHours: 72 }),
    );
    expect(setActive).toHaveBeenCalledWith(existing[1], false);
  });
});
