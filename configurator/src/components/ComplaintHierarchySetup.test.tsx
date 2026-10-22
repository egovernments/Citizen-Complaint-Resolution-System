import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { localizationService, mdmsService } from '@/api';
import { parseComplaintHierarchyExcel, type ComplaintHierarchyRow } from '@/utils/excelParser';
import { ComplaintHierarchySetup } from './ComplaintHierarchySetup';

vi.mock('@/api', () => ({
  mdmsService: { create: vi.fn(async () => ({})), getStateInfoLocales: vi.fn(async () => ['pt_MZ', 'hi_IN']) },
  localizationService: {
    uploadComplaintTypeLocalizations: vi.fn(async () => ({ success: 1, failed: 0 })),
    cacheBust: vi.fn(async () => undefined),
  },
}));
// The sheet itself is parsed elsewhere (excelParser.test.ts); here it yields fixed rows.
vi.mock('@/utils/excelParser', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/excelParser')>()),
  parseExcelFile: vi.fn(async () => ({})),
  parseComplaintHierarchyExcel: vi.fn(),
}));

const create = vi.mocked(mdmsService.create);
const upload = vi.mocked(localizationService.uploadComplaintTypeLocalizations);

const node = (code: string, levelCode: string, extra: Partial<ComplaintHierarchyRow> = {}): ComplaintHierarchyRow => ({
  hierarchyType: 'PGR',
  levelCode,
  code,
  name: code,
  parentCode: null,
  order: 1,
  active: true,
  path: code,
  ...extra,
});
const nodes = [
  node('Water', 'AUTHORITY_TYPE', { name: 'Water' }),
  node('WaterLeak', 'SUB_TYPE', { name: 'Leak', parentCode: 'Water', isLeaf: true, department: 'WATER', slaHours: 24 }),
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(parseComplaintHierarchyExcel).mockReturnValue({
    nodes,
    leaves: nodes.filter((n) => n.isLeaf),
    validation: { valid: true, errors: [], warnings: [] },
  });
});

async function ingestSheet() {
  const onDone = vi.fn();
  render(<ComplaintHierarchySetup targetTenant="mz.maputo" stateTenant="mz.maputo" onDone={onDone} />);
  fireEvent.click(screen.getByTestId('ch-next-template'));
  fireEvent.change(document.getElementById('ch-file-upload')!, {
    target: { files: [new File(['x'], 'hierarchy.xlsx')] },
  });
  await waitFor(() => expect(screen.getByTestId('complaint-hierarchy-setup').dataset.step).toBe('verify'));
  fireEvent.click(screen.getByTestId('ch-create'));
  await waitFor(() => expect(onDone).toHaveBeenCalled());
}

describe('ComplaintHierarchySetup: ingesting a sheet', () => {
  it('stores a readable label for each level, keeping the level codes', async () => {
    await ingestSheet();

    const definition = create.mock.calls.find(([, schema]) => schema === 'RAINMAKER-PGR.ComplaintHierarchyDefinition');
    const levels = (definition?.[3] as { levels: { levelCode: string; label: string }[] }).levels;
    expect(levels.map((l) => [l.levelCode, l.label])).toEqual([
      ['AUTHORITY_TYPE', 'Authority Type'],
      ['MAIN_CATEGORY', 'Main Category'],
      ['SECTOR', 'Sector'],
      ['SUB_TYPE', 'Sub Type'],
    ]);
  });

  it('uploads the category names once under every workspace language', async () => {
    await ingestSheet();

    const labels = [
      { serviceCode: 'Water', name: 'Water', department: undefined },
      { serviceCode: 'WaterLeak', name: 'Leak', department: 'WATER' },
    ];
    expect(upload.mock.calls).toEqual([
      ['mz.maputo', labels, 'en_IN'],
      ['mz.maputo', labels, 'pt_MZ'],
      ['mz.maputo', labels, 'hi_IN'],
    ]);
    expect(mdmsService.getStateInfoLocales).toHaveBeenCalledWith('mz.maputo');
  });
});
