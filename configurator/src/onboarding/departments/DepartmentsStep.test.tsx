import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MdmsRecord } from '@/api/types';
import DepartmentsStep from './DepartmentsStep';
import { importMasters, listMasters } from './mastersApi';

const app = {
  state: { tenant: 'ke.nairobi', targetTenant: 'ke.nairobi', completedPhases: [] as number[], user: { uuid: 'me' } },
  completePhase: vi.fn(async () => true),
};
vi.mock('@/App', () => ({ useApp: () => app }));
vi.mock('@/identity/workspace', () => ({ searchWorkspace: vi.fn(async () => ({ Probes: {}, Workspace: { legacy: true } })) }));
vi.mock('../telemetry', () => ({
  reportStepError: vi.fn(),
  trackImport: vi.fn(),
  trackMethod: vi.fn(),
  trackRecordSave: vi.fn(),
  trackTemplateDownload: vi.fn(),
  trackUploadRefused: vi.fn(),
}));
vi.mock('./mastersApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./mastersApi')>()),
  listMasters: vi.fn(),
  importMasters: vi.fn(async () => ({ created: 0, skipped: 0, failed: [] })),
}));

const record = (code: string, name: string, tenantId = 'ke.nairobi'): MdmsRecord => ({
  id: code,
  tenantId,
  schemaCode: 'common-masters.Department',
  uniqueIdentifier: code,
  isActive: true,
  data: { code, name },
});

function sheetFile(designations: Record<string, unknown>[]): File {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([]), 'Department');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(designations), 'Designation');
  const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return new File([bytes], 'masters.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

beforeEach(() => vi.clearAllMocks());

describe('DepartmentsStep bulk upload', () => {
  it('lets a designation link to a department the city inherits from the state, or a system one (#2807)', async () => {
    // The search at the city returns its own departments, the state's and the provisioned one.
    vi.mocked(listMasters).mockImplementation(async (_tenant, kind) =>
      kind === 'department'
        ? [record('ROADS', 'Roads'), record('DEPT_1', 'Public Works', 'ke'), record('ONBOARDING_ADMIN', 'Administration')]
        : [record('ENGINEER', 'Engineer')],
    );
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <DepartmentsStep />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    // Only the city's own, non-system department is listed.
    expect(await screen.findByText('Roads')).toBeInTheDocument();
    expect(screen.queryByText('Public Works')).not.toBeInTheDocument();
    expect(screen.queryByText('Administration')).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'Upload a file' })[0]);
    const file = sheetFile([
      { code: 'CLERK', name: 'Clerk', department: 'DEPT_1' },
      { code: 'ADMIN_ASST', name: 'Admin assistant', department: 'ONBOARDING_ADMIN' },
      { code: 'GHOST', name: 'Ghost', department: 'NOPE' },
    ]);
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } });

    expect(await screen.findByText('masters.xlsx has 0 departments and 2 designations.')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Row 4: department NOPE doesn’t exist. Add it to the Department sheet, or use one you already have.',
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Bring them in' }));
    await waitFor(() =>
      expect(importMasters).toHaveBeenCalledWith(
        'ke.nairobi',
        'designation',
        [
          { code: 'CLERK', name: 'Clerk', departments: ['DEPT_1'] },
          { code: 'ADMIN_ASST', name: 'Admin assistant', departments: ['ONBOARDING_ADMIN'] },
        ],
        new Set(['ENGINEER']),
      ),
    );
  });
});
