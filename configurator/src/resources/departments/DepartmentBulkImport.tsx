import { useCallback, useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { BulkImportPanel, type BulkRow, type BulkColumn } from '@/admin/bulk/BulkImportPanel';
import { parseDepartmentExcel } from '@/utils/excelParser';
import { mdmsService } from '@/api';
import type { DepartmentExcelRow, Department } from '@/api/types';
import { useApp } from '../../App';

type DepartmentBulkRow = DepartmentExcelRow & BulkRow;

const COLUMNS = ['code', 'name', 'active'];

function buildTemplate(tenant: string): Blob {
  const wb = XLSX.utils.book_new();
  const primary = XLSX.utils.aoa_to_sheet([
    COLUMNS,
    ['DEPT_EXAMPLE', 'Example Department', 'true'],
  ]);
  primary['!cols'] = [{ wch: 20 }, { wch: 36 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(wb, primary, 'Department');

  const notes = XLSX.utils.aoa_to_sheet([
    ['Department bulk import template'],
    [`Tenant: ${tenant}`],
    [''],
    ['Required columns:'],
    ['  code   (unique, e.g. DEPT_18 — letters / digits / underscores / dots)'],
    ['  name   (display name, e.g. ADMINISTRATION)'],
    [''],
    ['Optional column:'],
    ['  active (true / false, defaults to true)'],
    [''],
    ['Existing codes on this tenant will be rejected (MDMS requires unique uniqueIdentifier).'],
  ]);
  notes['!cols'] = [{ wch: 80 }];
  XLSX.utils.book_append_sheet(wb, notes, 'Instructions');

  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

export function DepartmentBulkImport() {
  const { state } = useApp();
  const tenantId = state.tenant;

  const [existing, setExisting] = useState<Department[]>([]);
  const [refsLoading, setRefsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setRefsLoading(true);
      try {
        const depts = await mdmsService.getDepartments(tenantId);
        if (!cancelled) setExisting(depts);
      } finally {
        if (!cancelled) setRefsLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  const parseWorkbook = useCallback((wb: XLSX.WorkBook) => {
    const result = parseDepartmentExcel(wb);
    if (result.validation.errors.length > 0 && result.data.length === 0) {
      return { data: [] as DepartmentBulkRow[], parseError: result.validation.errors[0].message };
    }
    return { data: result.data as DepartmentBulkRow[] };
  }, []);

  const validateRow = useCallback(
    (row: DepartmentBulkRow): string[] => {
      const errs: string[] = [];
      if (!/^[A-Za-z0-9][A-Za-z0-9_.\-/]*$/.test(row.code)) {
        errs.push('Code uses unsupported characters');
      }
      if (existing.find((d) => d.code === row.code)) {
        errs.push(`Code "${row.code}" already exists on this tenant`);
      }
      return errs;
    },
    [existing],
  );

  const createOne = useCallback(
    async (row: DepartmentBulkRow) => {
      await mdmsService.createDepartment(tenantId, {
        code: row.code,
        name: row.name,
        active: row.active ?? true,
      });
    },
    [tenantId],
  );

  const columns = useMemo<BulkColumn<DepartmentBulkRow>[]>(
    () => [
      { header: 'Code', render: (r) => r.code, mono: true },
      { header: 'Name', render: (r) => r.name },
      { header: 'Active', render: (r) => (r.active ? 'yes' : 'no'), mono: true },
    ],
    [],
  );

  return (
    <BulkImportPanel<DepartmentBulkRow>
      title="Bulk import departments"
      backTo="/manage/departments"
      tenantId={tenantId}
      referenceLoading={refsLoading}
      referenceCounts={[{ label: 'Existing departments', value: existing.length }]}
      buildTemplate={() => buildTemplate(tenantId)}
      templateFilename={`departments-template-${tenantId}.xlsx`}
      parseWorkbook={parseWorkbook}
      validateRow={validateRow}
      columns={columns}
      createOne={createOne}
      entityLabel={{ singular: 'department', plural: 'departments' }}
    />
  );
}
