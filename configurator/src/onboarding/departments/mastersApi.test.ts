import { beforeEach, describe, expect, it, vi } from 'vitest';
import { localizationService, mdmsService } from '@/api';
import type { MdmsRecord } from '@/api/types';
import { importMasters, listMasters, removeMaster, saveMaster, suggestCode } from './mastersApi';

vi.mock('@/api', () => ({
  MDMS_SCHEMAS: { DEPARTMENT: 'common-masters.Department', DESIGNATION: 'common-masters.Designation' },
  mdmsService: { searchRecords: vi.fn(), create: vi.fn(), update: vi.fn(), setActive: vi.fn() },
  localizationService: {
    uploadDepartmentLocalizations: vi.fn(async () => ({ success: 1, failed: 0 })),
    uploadDesignationLocalizations: vi.fn(async () => ({ success: 1, failed: 0 })),
    cacheBust: vi.fn(async () => undefined),
  },
}));

const search = vi.mocked(mdmsService.searchRecords);
const create = vi.mocked(mdmsService.create);
const update = vi.mocked(mdmsService.update);
const setActive = vi.mocked(mdmsService.setActive);
const departmentLabels = vi.mocked(localizationService.uploadDepartmentLocalizations);

const record = (over: Partial<MdmsRecord>): MdmsRecord => ({
  id: 'uuid',
  tenantId: 'acme',
  schemaCode: 'common-masters.Department',
  uniqueIdentifier: 'ROADS',
  data: { code: 'ROADS', name: 'Roads', active: true },
  isActive: true,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  create.mockImplementation(async (tenantId, schemaCode, uniqueIdentifier, data) => record({ tenantId, schemaCode, uniqueIdentifier, data }));
  update.mockImplementation(async (rec, data) => ({ ...rec, data }));
  setActive.mockImplementation(async (rec, isActive, data) => ({ ...rec, isActive, data: data ?? rec.data }));
});

describe('suggestCode', () => {
  it('turns a name into capitals and underscores', () => {
    expect(suggestCode('Roads & Infrastructure')).toBe('ROADS_INFRASTRUCTURE');
    expect(suggestCode('  ward officer (grade 2) ')).toBe('WARD_OFFICER_GRADE_2');
  });

  it('stays short and never ends on an underscore', () => {
    const code = suggestCode('Department of Environment Parks and Recreation Services');
    expect(code.length).toBeLessThanOrEqual(30);
    expect(code.endsWith('_')).toBe(false);
  });
});

describe('listMasters', () => {
  it('leaves out removed records', async () => {
    search.mockResolvedValue([record({}), record({ uniqueIdentifier: 'OLD', isActive: false })]);
    const listed = await listMasters('acme', 'department');
    expect(listed.map((r) => r.uniqueIdentifier)).toEqual(['ROADS']);
  });

  it("offers the state root's rows a city inherits, except where records are edited", async () => {
    search.mockResolvedValue([record({ tenantId: 'ke' })]);
    // Pickers: a city employee can hold a state department.
    expect((await listMasters('ke.a', 'department')).map((r) => r.uniqueIdentifier)).toEqual(['ROADS']);
    // The Departments step edits and removes, so only the city's own.
    expect(await listMasters('ke.a', 'department', { ownOnly: true })).toEqual([]);
  });
});

describe('saveMaster', () => {
  it('creates a new record and labels it', async () => {
    search.mockResolvedValue([]);
    await saveMaster('acme', 'department', { code: 'WATER', name: ' Water ' });
    expect(create).toHaveBeenCalledWith('acme', 'common-masters.Department', 'WATER', { code: 'WATER', name: 'Water', active: true });
    expect(departmentLabels).toHaveBeenCalledWith('acme', [{ code: 'WATER', name: 'Water' }], 'en_IN');
  });

  it('restores a removed record that still holds the code, instead of creating', async () => {
    const removed = record({ uniqueIdentifier: 'WATER', isActive: false, data: { code: 'WATER', name: 'Old water' } });
    search.mockResolvedValue([removed]);
    await saveMaster('acme', 'department', { code: 'WATER', name: 'Water' });
    expect(create).not.toHaveBeenCalled();
    expect(setActive).toHaveBeenCalledWith(removed, true, expect.objectContaining({ name: 'Water', active: true }));
  });

  it('edits the name but keeps the code', async () => {
    const existing = record({});
    await saveMaster('acme', 'department', { code: 'IGNORED', name: 'Roads and Bridges' }, existing);
    expect(update).toHaveBeenCalledWith(existing, expect.objectContaining({ code: 'ROADS', name: 'Roads and Bridges' }));
  });

  it('gives a designation its departments and a description', async () => {
    search.mockResolvedValue([]);
    await saveMaster('acme', 'designation', { code: 'ENGINEER', name: 'Engineer', departments: ['ROADS'] });
    expect(create).toHaveBeenCalledWith('acme', 'common-masters.Designation', 'ENGINEER', {
      code: 'ENGINEER',
      name: 'Engineer',
      active: true,
      department: ['ROADS'],
      description: 'Engineer',
    });
  });
});

describe('removeMaster', () => {
  it('deactivates rather than deleting', async () => {
    const existing = record({});
    await removeMaster(existing);
    expect(setActive).toHaveBeenCalledWith(existing, false);
  });
});

describe('importMasters', () => {
  it('skips codes the workspace has and reports failures', async () => {
    create.mockImplementationOnce(async () => {
      throw new Error('boom');
    });
    const result = await importMasters(
      'acme',
      'department',
      [
        { code: 'BAD', name: 'Bad' },
        { code: 'ROADS', name: 'Roads' },
        { code: 'PARKS', name: 'Parks' },
      ],
      new Set(['ROADS']),
    );
    expect(result).toEqual({ created: 1, skipped: 1, failed: [{ code: 'BAD', error: 'boom' }] });
    expect(departmentLabels).toHaveBeenCalledWith('acme', [{ code: 'PARKS', name: 'Parks' }], 'en_IN');
  });
});
