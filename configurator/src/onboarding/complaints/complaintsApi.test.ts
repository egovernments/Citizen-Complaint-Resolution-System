import { beforeEach, describe, expect, it, vi } from 'vitest';
import { localizationService, mdmsService } from '@/api';
import type { MdmsRecord } from '@/api/types';
import {
  loadComplaints,
  nextData,
  removeSheetComplaints,
  rowsFingerprint,
  rowsFor,
  saveComplaints,
  writeSheetHierarchy,
  type ComplaintDraft,
} from './complaintsApi';

vi.mock('@/api', () => ({
  mdmsService: { searchRecords: vi.fn(), create: vi.fn(async () => ({})), update: vi.fn(async () => ({})), setActive: vi.fn(async () => ({})), getStateInfoLocales: vi.fn(async () => ['en_KE']) },
  localizationService: {
    uploadComplaintTypeLocalizations: vi.fn(async () => ({ success: 1, failed: 0 })),
    cacheBust: vi.fn(async () => undefined),
  },
}));

const search = vi.mocked(mdmsService.searchRecords);
const create = vi.mocked(mdmsService.create);
const update = vi.mocked(mdmsService.update);
const setActive = vi.mocked(mdmsService.setActive);

// mdms-v2 keys hierarchy rows by hierarchyType and code, as the live 8c box does.
const row = (code: string, data: Record<string, unknown>, extra: Partial<MdmsRecord> = {}): MdmsRecord => ({
  id: code,
  tenantId: 'acme',
  schemaCode: 'RAINMAKER-PGR.ComplaintHierarchy',
  uniqueIdentifier: `PGR.${code}`,
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

  it("ignores the state root's rows a city search falls back to", async () => {
    search.mockImplementation(async (_tenant, schema) =>
      schema === 'RAINMAKER-PGR.ComplaintHierarchyDefinition'
        ? []
        : [row('Garbage', { levelCode: 'COMPLAINT_TYPE', name: 'Garbage', department: 'HEALTH', slaHours: 72 }, { tenantId: 'ke' })],
    );
    const loaded = await loadComplaints('ke.a');
    expect(loaded.editable && loaded.draft.types).toEqual([]);
  });

  it('leaves a spreadsheet hierarchy with other levels alone', async () => {
    search.mockImplementation(async (_tenant, schema) =>
      schema === 'RAINMAKER-PGR.ComplaintHierarchyDefinition'
        ? [row('PGR', { levels: [{ levelCode: 'AUTHORITY_TYPE' }, { levelCode: 'MAIN_CATEGORY' }, { levelCode: 'SUB_TYPE' }] }, { schemaCode: schema })]
        : [row('A', { levelCode: 'SUB_TYPE', department: 'X', slaHours: 24 })],
    );
    expect(await loadComplaints('acme')).toEqual({
      editable: false,
      leafCount: 1,
      levels: ['AUTHORITY_TYPE', 'MAIN_CATEGORY', 'SUB_TYPE'],
      departments: ['X'],
      routes: [{ name: 'A', department: 'X' }],
    });
  });

  it('routes a spreadsheet hierarchy by its leaves only', async () => {
    search.mockImplementation(async (_tenant, schema) =>
      schema === 'RAINMAKER-PGR.ComplaintHierarchyDefinition'
        ? [row('PGR', { levels: [{ levelCode: 'MAIN_CATEGORY' }, { levelCode: 'SUB_TYPE' }, { levelCode: 'DETAIL' }] }, { schemaCode: schema })]
        : [
            row('Water', { levelCode: 'MAIN_CATEGORY', department: 'PARENT_ONLY' }),
            row('Leak', { levelCode: 'SUB_TYPE', parentCode: 'Water', department: 'WATER', slaHours: 24 }),
            row('Meter', { levelCode: 'SUB_TYPE', parentCode: 'Water', department: 'WATER', slaHours: 24 }),
          ],
    );
    const loaded = await loadComplaints('acme');
    expect(loaded.editable === false && loaded.departments).toEqual(['WATER']);
  });
});

describe('saveComplaints', () => {
  it('creates the definition and new rows, updates changed ones, deactivates dropped ones', async () => {
    const existing = [
      row('StreetLighting', { levelCode: 'COMPLAINT_TYPE', name: 'Street lighting', parentCode: null, order: 1, active: true, path: 'StreetLighting' }),
      row('Potholes', { levelCode: 'COMPLAINT_TYPE', name: 'Potholes', department: 'ROADS', slaHours: 72 }),
    ];
    search.mockImplementation(async (_tenant, schema) => (schema === 'RAINMAKER-PGR.ComplaintHierarchyDefinition' ? [] : existing));
    const saved: ComplaintDraft = {
      slaHours: 72,
      types: [{ code: 'StreetLighting', name: 'Street lights', department: 'ROADS', subtypes: [{ name: 'Broken lamp' }] }],
    };

    const filable = await saveComplaints('acme', { editable: true, draft: saved, records: existing, hasDefinition: false }, saved);

    expect(filable).toBe(1);
    expect(create).toHaveBeenCalledWith(
      'acme',
      'RAINMAKER-PGR.ComplaintHierarchyDefinition',
      'PGR',
      expect.objectContaining({
        hierarchyType: 'PGR',
        levels: [
          expect.objectContaining({ levelCode: 'COMPLAINT_TYPE', label: 'Complaint Category' }),
          expect.objectContaining({ levelCode: 'SUB_TYPE', label: 'Complaint Subcategory' }),
        ],
      }),
    );
    expect(update).toHaveBeenCalledWith(existing[0], expect.objectContaining({ name: 'Street lights' }));
    expect(create).toHaveBeenCalledWith(
      'acme',
      'RAINMAKER-PGR.ComplaintHierarchy',
      // A new subtype takes its code from the type's current name; its parent keeps the saved code
      'StreetLightsBrokenLamp',
      expect.objectContaining({ parentCode: 'StreetLighting', path: 'StreetLighting.StreetLightsBrokenLamp', department: 'ROADS', slaHours: 72 }),
    );
    expect(setActive).toHaveBeenCalledWith(existing[1], false);
    // Labels go to digit-ui's en_IN and the workspace's StateInfo locale alike.
    expect(vi.mocked(localizationService.uploadComplaintTypeLocalizations).mock.calls.map((call) => call[2])).toEqual(['en_IN', 'en_KE']);
  });
});

describe('resolution time per category', () => {
  const definition = row('PGR', { levels: [{ levelCode: 'COMPLAINT_TYPE' }, { levelCode: 'SUB_TYPE' }] }, { schemaCode: 'RAINMAKER-PGR.ComplaintHierarchyDefinition' });
  const serve = (rows: MdmsRecord[]) =>
    search.mockImplementation(async (_tenant, schema) => (schema === 'RAINMAKER-PGR.ComplaintHierarchyDefinition' ? [definition] : rows));

  it('writes a category’s own hours on its rows and the default on the rest', () => {
    const rows = rowsFor(
      {
        slaHours: 72,
        types: [
          { name: 'Street lighting', department: 'ROADS', slaHours: 24, subtypes: [{ name: 'Broken lamp' }, { name: 'Fallen pole', slaHours: 4 }] },
          { name: 'Garbage', department: 'HEALTH', subtypes: [] },
          { name: 'Water', department: 'WATER', slaHours: 168, subtypes: [] },
        ],
      },
      [],
    );
    const hours = Object.fromEntries(rows.filter((r) => 'slaHours' in r.data).map((r) => [r.data.name, r.data.slaHours]));
    expect(hours).toEqual({ 'Broken lamp': 24, 'Fallen pole': 4, Garbage: 72, Water: 168 });
  });

  it('loads mixed hours without flattening them, and saves them back unchanged', async () => {
    const saved = [
      row('Lights', { levelCode: 'COMPLAINT_TYPE', name: 'Street lighting', order: 1 }),
      row('LightsLamp', { levelCode: 'SUB_TYPE', name: 'Broken lamp', parentCode: 'Lights', department: 'ROADS', slaHours: 24, order: 2 }),
      row('LightsPole', { levelCode: 'SUB_TYPE', name: 'Fallen pole', parentCode: 'Lights', department: 'ROADS', slaHours: 4, order: 3 }),
      row('LightsDim', { levelCode: 'SUB_TYPE', name: 'Dim lamp', parentCode: 'Lights', department: 'ROADS', slaHours: 24, order: 4 }),
      row('Garbage', { levelCode: 'COMPLAINT_TYPE', name: 'Garbage', department: 'HEALTH', slaHours: 72, order: 5 }),
      row('Drains', { levelCode: 'COMPLAINT_TYPE', name: 'Drains', department: 'WATER', slaHours: 72, order: 6 }),
      row('Water', { levelCode: 'COMPLAINT_TYPE', name: 'Water', department: 'WATER', slaHours: 168, order: 7 }),
    ];
    serve(saved);
    const loaded = await loadComplaints('acme');
    if (!loaded.editable) throw new Error('expected an editable hierarchy');
    // 72 is on the most rows, so it is the default; Lights keeps 24 with Fallen pole's 4 as its own.
    expect(loaded.draft.slaHours).toBe(72);
    expect(loaded.draft.types.map((t) => [t.name, t.slaHours, t.subtypes.map((s) => s.slaHours)])).toEqual([
      ['Street lighting', 24, [undefined, 4, undefined]],
      ['Garbage', undefined, []],
      ['Drains', undefined, []],
      ['Water', 168, []],
    ]);
    const back = rowsFor(loaded.draft, saved.map((r) => String(r.data.code)));
    for (const record of saved) {
      const written = back.find((r) => r.code === record.data.code)!;
      expect([written.code, written.data.slaHours]).toEqual([record.data.code, record.data.slaHours]);
    }
  });

  it('falls back to the standard default when no row has hours', async () => {
    serve([row('Garbage', { levelCode: 'COMPLAINT_TYPE', name: 'Garbage', department: 'HEALTH', order: 1 })]);
    const loaded = await loadComplaints('acme');
    if (!loaded.editable) throw new Error('expected an editable hierarchy');
    expect(loaded.draft.slaHours).toBe(72);
    expect(loaded.draft.types[0].slaHours).toBeUndefined();
  });
});

describe('a retried save', () => {
  it('does not create the definition again when an earlier save already did', async () => {
    // The first Finish created the definition, then the step update was refused; the page still says hasDefinition: false.
    const definition: MdmsRecord = {
      id: 'def', tenantId: 'acme', schemaCode: 'RAINMAKER-PGR.ComplaintHierarchyDefinition', uniqueIdentifier: 'PGR', isActive: true,
      data: { hierarchyType: 'PGR', levels: [] },
    };
    search.mockImplementation(async (_tenant, schema) => (schema === 'RAINMAKER-PGR.ComplaintHierarchyDefinition' ? [definition] : []));

    await saveComplaints('acme', { editable: true, draft, records: [], hasDefinition: false }, draft);

    expect(create).not.toHaveBeenCalledWith('acme', 'RAINMAKER-PGR.ComplaintHierarchyDefinition', expect.anything(), expect.anything());
    expect(create).toHaveBeenCalledWith('acme', 'RAINMAKER-PGR.ComplaintHierarchy', expect.any(String), expect.anything());
  });
});

describe('a type that gains subtypes', () => {
  it('loses the leaf fields it had as a leaf', () => {
    const asLeaf = { hierarchyType: 'PGR', levelCode: 'COMPLAINT_TYPE', code: 'Garbage', name: 'Garbage', department: 'HEALTH', slaHours: 72, keywords: '' };
    const [typeRow] = rowsFor({ slaHours: 72, types: [{ code: 'Garbage', name: 'Garbage', department: 'HEALTH', subtypes: [{ name: 'Overflowing bin' }] }] }, ['Garbage']);
    const next = nextData(asLeaf, typeRow);
    expect(next).not.toHaveProperty('department');
    expect(next).not.toHaveProperty('slaHours');
    expect(next).not.toHaveProperty('keywords');
  });

  it('is updated on save even though its own fields did not change', async () => {
    const existing = [row('Garbage', { levelCode: 'COMPLAINT_TYPE', name: 'Garbage', parentCode: null, order: 1, active: true, path: 'Garbage', department: 'HEALTH', slaHours: 72, keywords: '' })];
    search.mockResolvedValue(existing);
    const withSubtype: ComplaintDraft = { slaHours: 72, types: [{ code: 'Garbage', name: 'Garbage', department: 'HEALTH', subtypes: [{ name: 'Overflowing bin' }] }] };
    await saveComplaints('acme', { editable: true, draft: withSubtype, records: existing, hasDefinition: true }, withSubtype);
    const [, sent] = update.mock.calls.find(([record]) => record === existing[0])!;
    expect(sent).not.toHaveProperty('department');
    expect(sent).not.toHaveProperty('slaHours');
  });
});

describe('a city workspace', () => {
  it("only adds its codes at the state root, never changing or switching off another city's", async () => {
    const cityRows = [row('Garbage', { levelCode: 'COMPLAINT_TYPE', name: 'Garbage', department: 'HEALTH', slaHours: 72 }, { tenantId: 'ke.a' })];
    const rootRows = [
      row('Garbage', { levelCode: 'COMPLAINT_TYPE', name: 'Rubbish', department: 'SANITATION', slaHours: 24 }, { id: 'root-garbage', tenantId: 'ke' }),
      row('Potholes', { levelCode: 'COMPLAINT_TYPE', name: 'Potholes', department: 'ROADS', slaHours: 72 }, { id: 'root-potholes', tenantId: 'ke' }),
    ];
    search.mockImplementation(async (tenant, schema) =>
      schema === 'RAINMAKER-PGR.ComplaintHierarchyDefinition' ? [] : tenant === 'ke' ? rootRows : cityRows,
    );
    const saved: ComplaintDraft = {
      slaHours: 72,
      types: [
        { code: 'Garbage', name: 'Garbage', department: 'HEALTH', subtypes: [] },
        { name: 'Water leak', department: 'WATER', subtypes: [] },
      ],
    };
    await saveComplaints('ke.a', { editable: true, draft: saved, records: cityRows, hasDefinition: true }, saved);

    // Another city's Potholes stays on, and the shared Garbage row keeps its data.
    expect(setActive).not.toHaveBeenCalledWith(rootRows[1], false);
    expect(update).not.toHaveBeenCalledWith(rootRows[0], expect.anything());
    // The new type is added at the root so pgr-services can validate it.
    expect(create).toHaveBeenCalledWith('ke', 'RAINMAKER-PGR.ComplaintHierarchy', 'WaterLeak', expect.objectContaining({ code: 'WaterLeak' }));
    expect(update.mock.calls.filter(([record]) => record.tenantId === 'ke')).toEqual([]);
    expect(setActive.mock.calls.filter(([record, isActive]) => record.tenantId === 'ke' && !isActive)).toEqual([]);
  });
});

describe('rowsFingerprint', () => {
  it('changes when a row is edited or switched off, not when the order does', () => {
    const a = row('A', {}, { auditDetails: { createdBy: 'x', createdTime: 1, lastModifiedBy: 'x', lastModifiedTime: 1 } });
    const b = row('B', {});
    expect(rowsFingerprint([a, b])).toBe(rowsFingerprint([b, a]));
    expect(rowsFingerprint([{ ...a, auditDetails: { ...a.auditDetails!, lastModifiedTime: 2 } }, b])).not.toBe(rowsFingerprint([a, b]));
    expect(rowsFingerprint([{ ...a, isActive: false }, b])).not.toBe(rowsFingerprint([a, b]));
  });
});

const DEFINITION = 'RAINMAKER-PGR.ComplaintHierarchyDefinition';
const definitionRecord = (levels: string[], extra: Partial<MdmsRecord> = {}): MdmsRecord => ({
  id: `def-${extra.tenantId ?? 'acme'}`,
  tenantId: 'acme',
  schemaCode: DEFINITION,
  uniqueIdentifier: 'PGR',
  isActive: true,
  data: { hierarchyType: 'PGR', levels: levels.map((levelCode) => ({ levelCode })) },
  ...extra,
});

describe('a spreadsheet hierarchy that has to go (#2806)', () => {
  it('names each leaf with its department, so a missing GRO or an unknown department can name the categories', async () => {
    search.mockImplementation(async (_tenant, schema) =>
      schema === DEFINITION
        ? [definitionRecord(['SERVICE', 'COMPLAINT_TYPE', 'SUB_TYPE'])]
        : [
            row('Environment', { levelCode: 'SERVICE', name: 'Environment' }),
            row('Garbage', { levelCode: 'COMPLAINT_TYPE', name: 'Garbage', parentCode: 'Environment' }),
            row('GarbageUncollectedWaste', { levelCode: 'SUB_TYPE', name: 'Uncollected waste', parentCode: 'Garbage', department: 'Sanitation Services', slaHours: 24 }),
          ],
    );
    const loaded = await loadComplaints('acme');
    expect(loaded.editable === false && loaded.routes).toEqual([{ name: 'Uncollected waste', department: 'Sanitation Services' }]);
  });

  it('switches off every row and then the definition at the workspace, and nothing at the state root', async () => {
    const definition = definitionRecord(['SERVICE', 'COMPLAINT_TYPE', 'SUB_TYPE'], { tenantId: 'ke.nairobi' });
    const rootDefinition = definitionRecord(['SERVICE', 'COMPLAINT_TYPE', 'SUB_TYPE'], { tenantId: 'ke' });
    const own = [
      row('Environment', { levelCode: 'SERVICE' }, { tenantId: 'ke.nairobi' }),
      row('GarbageUncollectedWaste', { levelCode: 'SUB_TYPE', department: 'NA' }, { tenantId: 'ke.nairobi' }),
    ];
    const gone = row('Old', { levelCode: 'SUB_TYPE' }, { tenantId: 'ke.nairobi', isActive: false });
    const other = row('Other', { levelCode: 'X', hierarchyType: 'OTHER' }, { tenantId: 'ke.nairobi' });
    const root = row('Environment', { levelCode: 'SERVICE' }, { id: 'root-env', tenantId: 'ke' });
    search.mockImplementation(async (_tenant, schema) => (schema === DEFINITION ? [definition, rootDefinition] : [...own, gone, other, root]));

    await removeSheetComplaints('ke.nairobi');

    expect(setActive.mock.calls).toEqual([
      [own[0], false],
      [own[1], false],
      [definition, false],
    ]);
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('opens the step for editing once removed, even with the state root still holding its copy', async () => {
    search.mockImplementation(async (_tenant, schema) =>
      schema === DEFINITION
        ? [
            definitionRecord(['SERVICE', 'COMPLAINT_TYPE', 'SUB_TYPE'], { tenantId: 'ke.nairobi', isActive: false }),
            definitionRecord(['SERVICE', 'COMPLAINT_TYPE', 'SUB_TYPE'], { tenantId: 'ke' }),
          ]
        : [row('GarbageUncollectedWaste', { levelCode: 'SUB_TYPE', department: 'NA' }, { tenantId: 'ke.nairobi', isActive: false })],
    );
    const loaded = await loadComplaints('ke.nairobi');
    expect(loaded.editable).toBe(true);
    expect(loaded.editable && loaded.draft.types).toEqual([]);
    expect(loaded.editable && loaded.hasDefinition).toBe(false);
  });

  it('restores the removed definition with two levels when the categories are then added by hand', async () => {
    const removed = definitionRecord(['SERVICE', 'COMPLAINT_TYPE', 'SUB_TYPE'], { isActive: false });
    search.mockImplementation(async (_tenant, schema) => (schema === DEFINITION ? [removed] : []));

    await saveComplaints('acme', { editable: true, draft, records: [], hasDefinition: false }, draft);

    expect(create).not.toHaveBeenCalledWith('acme', DEFINITION, expect.anything(), expect.anything());
    expect(setActive).toHaveBeenCalledWith(
      removed,
      true,
      expect.objectContaining({ levels: [expect.objectContaining({ levelCode: 'COMPLAINT_TYPE' }), expect.objectContaining({ levelCode: 'SUB_TYPE' })] }),
    );
  });

  it('a sheet uploaded again restores what was removed, creates what is new and leaves the same alone', async () => {
    const removedDefinition = definitionRecord(['SERVICE', 'COMPLAINT_TYPE', 'SUB_TYPE'], { isActive: false });
    const removedLeaf = row('GarbageUncollectedWaste', { levelCode: 'SUB_TYPE', department: 'NA' }, { isActive: false });
    const same = row('Environment', { levelCode: 'SERVICE', name: 'Environment' });
    const changed = row('Garbage', { levelCode: 'COMPLAINT_TYPE', name: 'Rubbish' });
    search.mockImplementation(async (_tenant, schema) => (schema === DEFINITION ? [removedDefinition] : [removedLeaf, same, changed]));
    const definitionData = { hierarchyType: 'PGR', active: true, levels: [{ levelCode: 'SERVICE' }, { levelCode: 'COMPLAINT_TYPE' }, { levelCode: 'SUB_TYPE' }] };
    const leafData = { hierarchyType: 'PGR', code: 'GarbageUncollectedWaste', levelCode: 'SUB_TYPE', department: 'SANIT' };

    await writeSheetHierarchy('acme', 'PGR', definitionData, [
      { code: 'Environment', data: same.data },
      { code: 'Garbage', data: { ...changed.data, name: 'Garbage' } },
      { code: 'GarbageUncollectedWaste', data: leafData },
      { code: 'GarbageOverflowingBin', data: { hierarchyType: 'PGR', code: 'GarbageOverflowingBin', department: 'SANIT' } },
    ]);

    expect(setActive.mock.calls).toEqual([
      [removedDefinition, true, definitionData],
      [removedLeaf, true, leafData],
    ]);
    expect(update.mock.calls).toEqual([[changed, expect.objectContaining({ name: 'Garbage' })]]);
    expect(create.mock.calls).toEqual([
      ['acme', 'RAINMAKER-PGR.ComplaintHierarchy', 'GarbageOverflowingBin', expect.objectContaining({ department: 'SANIT' })],
    ]);
  });
});
