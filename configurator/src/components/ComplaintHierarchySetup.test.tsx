import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { localizationService, mdmsService } from '@/api';
import { parseComplaintHierarchyExcel, type ComplaintHierarchyRow } from '@/utils/excelParser';
import { ComplaintHierarchySetup } from './ComplaintHierarchySetup';

vi.mock('@/api', () => ({
  mdmsService: {
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    setActive: vi.fn(async () => ({})),
    searchRecords: vi.fn(async () => []),
    getStateInfoLocales: vi.fn(async () => ['pt_MZ', 'hi_IN']),
  },
  localizationService: {
    uploadComplaintTypeLocalizationsForLocales: vi.fn(async () => undefined),
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
const upload = vi.mocked(localizationService.uploadComplaintTypeLocalizationsForLocales);

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
      ['SUB_TYPE', 'Complaint Subcategory'],
    ]);
  });

  it('uploads the category names once under every workspace language', async () => {
    await ingestSheet();

    const labels = [
      { serviceCode: 'Water', name: 'Water', department: undefined },
      { serviceCode: 'WaterLeak', name: 'Leak', department: 'WATER' },
    ];
    expect(upload.mock.calls).toEqual([['mz.maputo', labels, ['en_IN', 'pt_MZ', 'hi_IN']]]);
    expect(mdmsService.getStateInfoLocales).toHaveBeenCalledWith('mz.maputo');
  });
});

describe('ComplaintHierarchySetup: a sheet with rows to fix (#2806)', () => {
  it('lists the problems in the preview and creates nothing', async () => {
    vi.mocked(parseComplaintHierarchyExcel).mockReturnValue({
      nodes,
      leaves: nodes.filter((n) => n.isLeaf),
      validation: {
        valid: false,
        errors: [
          { row: 4, field: 'department', message: 'Row 4: no department. Every complaint type needs one.', code: 'NO_DEPT' },
          { row: 2, field: 'department', message: 'Row 2: department “Sanitaton” doesn’t exist. Use one of: Sanitation Services (SANIT).', code: 'UNKNOWN_DEPT' },
        ],
        warnings: [],
      },
    });
    const onDone = vi.fn();
    render(<ComplaintHierarchySetup targetTenant="mz.maputo" stateTenant="mz.maputo" onDone={onDone} departments={[{ code: 'SANIT', name: 'Sanitation Services' }]} />);
    fireEvent.click(screen.getByTestId('ch-next-template'));
    fireEvent.change(document.getElementById('ch-file-upload')!, { target: { files: [new File(['x'], 'hierarchy.xlsx')] } });
    await waitFor(() => expect(screen.getByTestId('complaint-hierarchy-setup').dataset.step).toBe('verify'));

    expect(screen.getByTestId('ch-row-errors').textContent).toContain('Row 4: no department. Every complaint type needs one.');
    expect(screen.getByTestId('ch-row-errors').textContent).toContain('Row 2: department “Sanitaton” doesn’t exist.');
    expect(screen.getByTestId('ch-create')).toBeDisabled();
    fireEvent.click(screen.getByTestId('ch-create'));
    expect(create).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
    // The parser was given the workspace's departments to check against.
    expect(vi.mocked(parseComplaintHierarchyExcel).mock.calls[0][3]).toMatchObject({ departments: [{ code: 'SANIT', name: 'Sanitation Services' }] });
  });

  it('never writes a complaint type without a department (no NA stand-in)', async () => {
    const blank = [nodes[0], { ...nodes[1], department: '' }];
    vi.mocked(parseComplaintHierarchyExcel).mockReturnValue({ nodes: blank, leaves: [blank[1]], validation: { valid: true, errors: [], warnings: [] } });
    const onDone = vi.fn();
    render(<ComplaintHierarchySetup targetTenant="mz.maputo" stateTenant="mz.maputo" onDone={onDone} />);
    fireEvent.click(screen.getByTestId('ch-next-template'));
    fireEvent.change(document.getElementById('ch-file-upload')!, { target: { files: [new File(['x'], 'hierarchy.xlsx')] } });
    await waitFor(() => expect(screen.getByTestId('complaint-hierarchy-setup').dataset.step).toBe('verify'));
    fireEvent.click(screen.getByTestId('ch-create'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(create).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });
});
