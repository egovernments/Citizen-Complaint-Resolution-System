import { useCallback, useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { BulkImportPanel, type BulkRow, type BulkColumn } from '@/admin/bulk/BulkImportPanel';
import { parseDesignationExcel } from '@/utils/excelParser';
import { mdmsService } from '@/api';
import type { DesignationExcelRow, Designation, Department } from '@/api/types';
import { useApp } from '../../App';

type DesignationBulkRow = DesignationExcelRow & BulkRow;

const COLUMNS = ['code', 'name', 'description', 'department', 'active'];

function buildTemplate(tenant: string, depts: Department[]): Blob {
  const wb = XLSX.utils.book_new();
  const primary = XLSX.utils.aoa_to_sheet([
    COLUMNS,
    ['DESIG_EXAMPLE', 'Example Designation', 'An example', 'DEPT_07', 'true'],
    ['DESIG_MULTI', 'Multi-Dept Designation', 'Belongs to two depts', 'DEPT_07,DEPT_08', 'true'],
  ]);
  primary['!cols'] = [{ wch: 20 }, { wch: 36 }, { wch: 40 }, { wch: 28 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(wb, primary, 'Designation');

  const codesRows: string[][] = [['departments (code : name)']];
  for (const d of depts) codesRows.push([`${d.code} : ${d.name}`]);
  const ref = XLSX.utils.aoa_to_sheet(codesRows);
  ref['!cols'] = [{ wch: 40 }];
  XLSX.utils.book_append_sheet(wb, ref, 'Codes');

  const notes = XLSX.utils.aoa_to_sheet([
    ['Designation bulk import template'],
    [`Tenant: ${tenant}`],
    [''],
    ['Required columns:'],
    ['  code         (unique, e.g. DESIG_29)'],
    ['  name         (display name)'],
    ['  description  (free text, the MDMS schema requires it)'],
    [''],
    ['Optional columns:'],
    ['  department   (comma-separated codes from the Codes sheet — stored as array)'],
    ['  active       (true / false, defaults to true)'],
    [''],
    ['Existing codes on this tenant will be rejected.'],
  ]);
  notes['!cols'] = [{ wch: 80 }];
  XLSX.utils.book_append_sheet(wb, notes, 'Instructions');

  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

export function DesignationBulkImport() {
  const { state } = useApp();
  const tenantId = state.tenant;

  const [existing, setExisting] = useState<Designation[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [refsLoading, setRefsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setRefsLoading(true);
      try {
        const [desigs, depts] = await Promise.all([
          mdmsService.getDesignations(tenantId),
          mdmsService.getDepartments(tenantId),
        ]);
        if (!cancelled) {
          setExisting(desigs);
          setDepartments(depts);
        }
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
    const result = parseDesignationExcel(wb);
    if (result.validation.errors.length > 0 && result.data.length === 0) {
      return { data: [] as DesignationBulkRow[], parseError: result.validation.errors[0].message };
    }
    return { data: result.data as DesignationBulkRow[] };
  }, []);

  const validateRow = useCallback(
    (row: DesignationBulkRow): string[] => {
      const errs: string[] = [];
      if (!/^[A-Za-z0-9][A-Za-z0-9_.\-/]*$/.test(row.code)) {
        errs.push('Code uses unsupported characters');
      }
      if (existing.find((d) => d.code === row.code)) {
        errs.push(`Code "${row.code}" already exists on this tenant`);
      }
      if (!row.description || !String(row.description).trim()) {
        errs.push('Description is required by the schema');
      }
      if (row.department && row.department.length > 0) {
        const deptCodes = new Set(departments.map((d) => d.code));
        for (const code of row.department) {
          if (!deptCodes.has(code)) errs.push(`Department "${code}" not found`);
        }
      }
      return errs;
    },
    [existing, departments],
  );

  const createOne = useCallback(
    async (row: DesignationBulkRow) => {
      await mdmsService.createDesignation(tenantId, {
        code: row.code,
        name: row.name,
        description: row.description,
        department: row.department,
        active: row.active ?? true,
      });
    },
    [tenantId],
  );

  const columns = useMemo<BulkColumn<DesignationBulkRow>[]>(
    () => [
      { header: 'Code', render: (r) => r.code, mono: true },
      { header: 'Name', render: (r) => r.name },
      { header: 'Description', render: (r) => r.description },
      {
        header: 'Departments',
        render: (r) => (Array.isArray(r.department) ? r.department.join(', ') : '--'),
        mono: true,
      },
      { header: 'Active', render: (r) => (r.active ? 'yes' : 'no'), mono: true },
    ],
    [],
  );

  return (
    <BulkImportPanel<DesignationBulkRow>
      title="Bulk import designations"
      backTo="/manage/designations"
      tenantId={tenantId}
      referenceLoading={refsLoading}
      referenceCounts={[
        { label: 'Existing designations', value: existing.length },
        { label: 'Departments', value: departments.length },
      ]}
      buildTemplate={() => buildTemplate(tenantId, departments)}
      templateFilename={`designations-template-${tenantId}.xlsx`}
      parseWorkbook={parseWorkbook}
      validateRow={validateRow}
      columns={columns}
      createOne={createOne}
      entityLabel={{ singular: 'designation', plural: 'designations' }}
    />
  );
}
