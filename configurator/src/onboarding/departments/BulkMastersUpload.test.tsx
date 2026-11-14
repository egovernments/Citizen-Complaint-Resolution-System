import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as XLSX from 'xlsx';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BulkMastersUpload } from './BulkMastersUpload';
import { importMasters } from './mastersApi';

vi.mock('./mastersApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./mastersApi')>()),
  importMasters: vi.fn(async () => ({ created: 1, skipped: 0, failed: [] })),
}));
const bringIn = vi.mocked(importMasters);

function sheetFile(departments: Record<string, unknown>[], designations: Record<string, unknown>[]): File {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(departments), 'Department');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(designations), 'Designation');
  const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return new File([bytes], 'masters.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

beforeEach(() => vi.clearAllMocks());

describe('BulkMastersUpload', () => {
  it('names a designation row linked to a missing department and leaves it out of the import (#2807)', async () => {
    const onDone = vi.fn();
    const { container } = render(
      <BulkMastersUpload tenantId="acme" existingDepartments={new Set(['WATER'])} existingDesignations={new Set()} onDone={onDone} onCancel={vi.fn()} />,
    );
    const file = sheetFile(
      [{ code: 'ROADS', name: 'Roads' }],
      [
        { code: 'ENG', name: 'Engineer', department: 'ROADS,WATER' },
        { code: 'GRO_OFF', name: 'Grievance Officer', department: 'ROADS,NOPE' },
      ],
    );
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } });

    expect(await screen.findByText('Row 3: department NOPE doesn’t exist. Add it to the Department sheet, or use one you already have.')).toBeTruthy();
    expect(screen.getByText('masters.xlsx has 1 department and 1 designation.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Bring them in' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(bringIn).toHaveBeenCalledWith('acme', 'designation', [{ code: 'ENG', name: 'Engineer', departments: ['ROADS', 'WATER'] }], new Set());
  });
});
