import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { localizationService, mdmsService } from '@/api';
import { parseComplaintHierarchyExcel, type ComplaintHierarchyRow } from '@/utils/excelParser';
import { MDMS_WRITES_IN_FLIGHT } from '@/onboarding/complaints/complaintsApi';
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

describe('ComplaintHierarchySetup: the hierarchy type (#2806)', () => {
  it('is fixed to PGR, the one the Complaints step can show and remove', async () => {
    const onDone = vi.fn();
    render(<ComplaintHierarchySetup targetTenant="mz.maputo" stateTenant="mz.maputo" onDone={onDone} />);
    const field = screen.getByTestId('ch-hierarchy-type') as HTMLInputElement;
    expect(field).toBeDisabled();
    fireEvent.change(field, { target: { value: 'PGR_CITY' } });

    fireEvent.click(screen.getByTestId('ch-next-template'));
    fireEvent.change(document.getElementById('ch-file-upload')!, { target: { files: [new File(['x'], 'hierarchy.xlsx')] } });
    await waitFor(() => expect(screen.getByTestId('complaint-hierarchy-setup').dataset.step).toBe('verify'));
    fireEvent.click(screen.getByTestId('ch-create'));
    await waitFor(() => expect(onDone).toHaveBeenCalled());

    expect(vi.mocked(parseComplaintHierarchyExcel).mock.calls[0][1]).toBe('PGR');
    expect(create).toHaveBeenCalledWith('mz.maputo', 'RAINMAKER-PGR.ComplaintHierarchyDefinition', 'PGR', expect.objectContaining({ hierarchyType: 'PGR' }));
  });
});

describe('ComplaintHierarchySetup: a city’s copy at the state root', () => {
  it('only adds rows there, several at a time', async () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      node(`Leaf${i}`, 'SUB_TYPE', { isLeaf: true, department: 'WATER', slaHours: 24 }),
    );
    vi.mocked(parseComplaintHierarchyExcel).mockReturnValue({ nodes: many, leaves: many, validation: { valid: true, errors: [], warnings: [] } });
    let open = 0;
    let most = 0;
    // Counts the state root's writes only: the city's own go first, through writeSheetHierarchy.
    create.mockImplementation(async (tenant) => {
      if (tenant !== 'ke') return {} as Awaited<ReturnType<typeof mdmsService.create>>;
      open += 1;
      most = Math.max(most, open);
      await new Promise((resolve) => setTimeout(resolve, 1));
      open -= 1;
      return {} as Awaited<ReturnType<typeof mdmsService.create>>;
    });
    try {
      const onDone = vi.fn();
      render(<ComplaintHierarchySetup targetTenant="ke.b" stateTenant="ke" onDone={onDone} />);
      fireEvent.click(screen.getByTestId('ch-next-template'));
      fireEvent.change(document.getElementById('ch-file-upload')!, { target: { files: [new File(['x'], 'hierarchy.xlsx')] } });
      await waitFor(() => expect(screen.getByTestId('complaint-hierarchy-setup').dataset.step).toBe('verify'));
      fireEvent.click(screen.getByTestId('ch-create'));
      await waitFor(() => expect(onDone).toHaveBeenCalled());

      const atRoot = create.mock.calls.filter(([tenant, schema]) => tenant === 'ke' && schema === 'RAINMAKER-PGR.ComplaintHierarchy');
      expect(atRoot).toHaveLength(20);
      expect(most).toBeGreaterThan(1);
      expect(most).toBeLessThanOrEqual(MDMS_WRITES_IN_FLIGHT);
      expect(mdmsService.update).not.toHaveBeenCalled();
    } finally {
      create.mockImplementation(async () => ({}) as Awaited<ReturnType<typeof mdmsService.create>>);
    }
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

  it('shows each subcategory’s department by name, with its code', async () => {
    render(
      <ComplaintHierarchySetup targetTenant="mz.maputo" stateTenant="mz.maputo" onDone={vi.fn()} departments={[{ code: 'WATER', name: 'Water Works' }]} />,
    );
    fireEvent.click(screen.getByTestId('ch-next-template'));
    fireEvent.change(document.getElementById('ch-file-upload')!, { target: { files: [new File(['x'], 'hierarchy.xlsx')] } });
    expect(await screen.findByRole('cell', { name: 'Water Works (WATER)' })).toBeTruthy();
  });

  it('clears the last file’s preview when the fixed sheet can’t be used', async () => {
    vi.mocked(parseComplaintHierarchyExcel).mockReturnValueOnce({
      nodes,
      leaves: nodes.filter((n) => n.isLeaf),
      validation: {
        valid: false,
        errors: [{ row: 4, field: 'department', message: 'Row 4: no department. Every complaint type needs one.', code: 'NO_DEPT' }],
        warnings: [],
      },
    });
    render(<ComplaintHierarchySetup targetTenant="mz.maputo" stateTenant="mz.maputo" onDone={vi.fn()} />);
    fireEvent.click(screen.getByTestId('ch-next-template'));
    const upload = document.getElementById('ch-file-upload')!;
    fireEvent.change(upload, { target: { files: [new File(['x'], 'old.xlsx')] } });
    await waitFor(() => expect(screen.getByTestId('complaint-hierarchy-setup').dataset.step).toBe('verify'));
    expect(screen.getByText('File: old.xlsx')).toBeTruthy();

    // "Upload the fixed sheet" with a file that has no rows at all.
    vi.mocked(parseComplaintHierarchyExcel).mockReturnValueOnce({ nodes: [], leaves: [], validation: { valid: true, errors: [], warnings: [] } });
    fireEvent.change(upload, { target: { files: [new File(['x'], 'new.xlsx')] } });

    expect(await screen.findByText('No complaint subcategories found in the sheet. Fill at least one row.')).toBeTruthy();
    expect(screen.getByTestId('complaint-hierarchy-setup').dataset.step).toBe('template');
    expect(screen.queryByText('File: old.xlsx')).toBeNull();
    expect(screen.queryByTestId('ch-row-errors')).toBeNull();
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
