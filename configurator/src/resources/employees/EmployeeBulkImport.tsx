import { useCallback, useEffect, useMemo, useState } from 'react';
import { useGetList } from 'ra-core';
import { Download } from 'lucide-react';
import * as XLSX from 'xlsx';
import { Button } from '@/components/ui/button';
import { BulkImportPanel, triggerDownload, type BulkRow, type BulkColumn } from '@/admin/bulk/BulkImportPanel';
import { parseEmployeeExcel } from '@/utils/excelParser';
import { hrmsService, mdmsService, boundaryService } from '@/api';
import type {
  EmployeeExcelRow,
  Employee,
  Department,
  Designation,
  Boundary,
} from '@/api/types';
import { useApp } from '../../App';

type EmployeeBulkRow = EmployeeExcelRow & BulkRow;

const TEMPLATE_COLUMNS = [
  'employeeCode',
  'name',
  'userName',
  'mobileNumber',
  'emailId',
  'gender',
  'dob',
  'department',
  'designation',
  'roles',
  'jurisdictions',
  'dateOfAppointment',
];

const TEMPLATE_SAMPLE = {
  employeeCode: 'EMP_001',
  name: 'Jane Kamau',
  userName: '',
  mobileNumber: '0712345678',
  emailId: 'jane.kamau@example.com',
  gender: 'FEMALE',
  dob: '1990-05-14',
  department: 'DEPT_07',
  designation: 'DESIG_1004',
  roles: 'PGR_LME',
  jurisdictions: 'NAIROBI_CITY_VIWANDANI',
  dateOfAppointment: '2026-01-15',
};

function buildTemplate(
  tenant: string,
  depts: Department[],
  desigs: Designation[],
  boundaries: Boundary[],
  roles: { code: string; name: string }[],
): Blob {
  const wb = XLSX.utils.book_new();
  const primary = XLSX.utils.aoa_to_sheet([
    TEMPLATE_COLUMNS,
    TEMPLATE_COLUMNS.map((c) => TEMPLATE_SAMPLE[c as keyof typeof TEMPLATE_SAMPLE] ?? ''),
  ]);
  primary['!cols'] = TEMPLATE_COLUMNS.map((c) => ({ wch: Math.max(12, c.length + 2) }));
  XLSX.utils.book_append_sheet(wb, primary, 'Employee');

  const maxLen = Math.max(depts.length, desigs.length, roles.length, boundaries.length);
  const rows: (string | undefined)[][] = [
    ['departments (code : name)', 'designations (code : name)', 'roles (code)', 'boundaries (code : type)'],
  ];
  for (let i = 0; i < maxLen; i += 1) {
    rows.push([
      depts[i] ? `${depts[i].code} : ${depts[i].name}` : '',
      desigs[i] ? `${desigs[i].code} : ${desigs[i].name}` : '',
      roles[i] ? roles[i].code : '',
      boundaries[i] ? `${boundaries[i].code} : ${boundaries[i].boundaryType ?? ''}` : '',
    ]);
  }
  const ref = XLSX.utils.aoa_to_sheet(rows);
  ref['!cols'] = [{ wch: 36 }, { wch: 36 }, { wch: 20 }, { wch: 36 }];
  XLSX.utils.book_append_sheet(wb, ref, 'Codes');

  const notes = XLSX.utils.aoa_to_sheet([
    ['Employee bulk import template'],
    [`Tenant: ${tenant}`],
    [''],
    ['Required columns: employeeCode, name, mobileNumber (10-digit Kenya), dob (YYYY-MM-DD),'],
    ['department (from Codes), designation (from Codes).'],
    ['Optional: userName (auto-derives), emailId, gender, roles (comma-separated),'],
    ['jurisdictions (comma-separated boundary codes), dateOfAppointment (YYYY-MM-DD).'],
    [''],
    ['Password defaults to eGov@123; employees rotate on first login.'],
  ]);
  notes['!cols'] = [{ wch: 80 }];
  XLSX.utils.book_append_sheet(wb, notes, 'Instructions');

  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

export function EmployeeBulkImport() {
  const { state } = useApp();
  const tenantId = state.tenant;

  const [departments, setDepartments] = useState<Department[]>([]);
  const [designations, setDesignations] = useState<Designation[]>([]);
  const [boundaries, setBoundaries] = useState<Boundary[]>([]);
  const [roles, setRoles] = useState<{ code: string; name: string; description?: string }[]>([]);
  const [mobileRules, setMobileRules] = useState<{
    pattern: string;
    minLength: number;
    maxLength: number;
    errorMessage: string;
  } | null>(null);
  const [refsLoading, setRefsLoading] = useState(false);
  const [createdEmployees, setCreatedEmployees] = useState<Employee[]>([]);

  const { data: aggregatedBoundaries } = useGetList('boundaries', {
    pagination: { page: 1, perPage: 1000 },
    sort: { field: 'name', order: 'ASC' },
  });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setRefsLoading(true);
      try {
        const [depts, desigs, bounds, fetchedRoles, mobile] = await Promise.all([
          mdmsService.getDepartments(tenantId),
          mdmsService.getDesignations(tenantId),
          boundaryService.searchBoundaries(tenantId),
          mdmsService.getRoles(tenantId).catch(() => [] as typeof roles),
          mdmsService.getMobileValidation(tenantId).catch(() => null),
        ]);
        if (cancelled) return;
        setDepartments(depts);
        setDesignations(desigs);
        setBoundaries(bounds);
        setRoles(fetchedRoles);
        setMobileRules(mobile);
      } finally {
        if (!cancelled) setRefsLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  const templateBoundaries = useMemo<Boundary[]>(() => {
    if (!aggregatedBoundaries || aggregatedBoundaries.length === 0) return boundaries;
    const byCode = new Map<string, Boundary>();
    for (const b of boundaries) byCode.set(b.code, b);
    for (const r of aggregatedBoundaries) {
      const rec = r as Record<string, unknown>;
      const code = typeof rec.code === 'string' ? rec.code : String(rec.id ?? '');
      if (!code || byCode.has(code)) continue;
      byCode.set(code, {
        code,
        name: typeof rec.name === 'string' ? rec.name : code,
        boundaryType: typeof rec.boundaryType === 'string' ? rec.boundaryType : '',
        hierarchyType: typeof rec.hierarchyType === 'string' ? rec.hierarchyType : 'ADMIN',
      } as Boundary);
    }
    return Array.from(byCode.values());
  }, [boundaries, aggregatedBoundaries]);

  const parseWorkbook = useCallback((wb: XLSX.WorkBook) => {
    const result = parseEmployeeExcel(wb);
    return { data: result.data as EmployeeBulkRow[] };
  }, []);

  const validateRow = useCallback(
    (row: EmployeeBulkRow): string[] => {
      const deptCodes = new Set(departments.map((d) => d.code));
      const desigCodes = new Set(designations.map((d) => d.code));
      const boundaryCodes = new Set(templateBoundaries.map((b) => b.code));
      const validRoles = new Set(roles.map((r) => r.code));

      let compiled: RegExp | null = null;
      if (mobileRules) {
        try { compiled = new RegExp(mobileRules.pattern); } catch { compiled = null; }
      }

      const errors: string[] = [];
      if (row.department && !deptCodes.has(row.department)) errors.push(`Department "${row.department}" not found`);
      if (row.designation && !desigCodes.has(row.designation)) errors.push(`Designation "${row.designation}" not found`);
      if (row.roles) {
        for (const r of row.roles.split(',').map((s) => s.trim()).filter(Boolean)) {
          if (!validRoles.has(r)) errors.push(`Role "${r}" not valid`);
        }
      }
      if (row.jurisdictions) {
        for (const b of row.jurisdictions.split(',').map((s) => s.trim()).filter(Boolean)) {
          if (!boundaryCodes.has(b)) errors.push(`Boundary "${b}" not found`);
        }
      }
      if (row.mobileNumber) {
        const len = row.mobileNumber.length;
        const effMin = Math.max(mobileRules?.minLength ?? 10, 10);
        const effMax = mobileRules?.maxLength ?? 10;
        if (len < effMin || len > effMax || (compiled && !compiled.test(row.mobileNumber))) {
          errors.push(mobileRules?.errorMessage ?? 'Mobile number must be 10 digits starting with 07 or 01');
        }
      }
      if (!row.dob || !/^\d{4}-\d{2}-\d{2}$/.test(row.dob)) {
        errors.push('Date of birth missing or malformed (expected YYYY-MM-DD)');
      }
      return errors;
    },
    [departments, designations, templateBoundaries, roles, mobileRules],
  );

  const createOne = useCallback(
    async (row: EmployeeBulkRow, index: number) => {
      const empRoles = row.roles
        ? row.roles
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
            .map((code) => {
              const def = roles.find((pr) => pr.code === code);
              return { code, name: def?.name || code };
            })
        : [{ code: 'EMPLOYEE', name: 'Employee' }];

      const jurisdictions = row.jurisdictions
        ? row.jurisdictions
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
            .map((code) => {
              const bnd = templateBoundaries.find((b) => b.code === code);
              return {
                boundary: code,
                boundaryType: bnd?.boundaryType ?? 'Ward',
                hierarchyType: bnd?.hierarchyType ?? 'ADMIN',
              };
            })
        : [];

      const built = hrmsService.buildEmployee({
        tenantId,
        code: row.employeeCode || hrmsService.generateEmployeeCode('EMP', index + 1),
        name: row.name,
        userName: (row.userName && row.userName.trim()) || hrmsService.generateUsername(row.name),
        mobileNumber: row.mobileNumber,
        emailId: row.emailId,
        gender: row.gender,
        dob: new Date(row.dob).getTime(),
        department: row.department,
        designation: row.designation,
        roles: empRoles,
        jurisdictions,
        dateOfAppointment: row.dateOfAppointment ? new Date(row.dateOfAppointment).getTime() : undefined,
      });

      const created = await hrmsService.createEmployee(built);
      setCreatedEmployees((prev) => [...prev, created]);
    },
    [roles, templateBoundaries, tenantId],
  );

  const columns = useMemo<BulkColumn<EmployeeBulkRow>[]>(
    () => [
      { header: 'Name', render: (r) => r.name },
      { header: 'Code', render: (r) => r.employeeCode, mono: true },
      { header: 'Mobile', render: (r) => r.mobileNumber, mono: true },
      { header: 'DOB', render: (r) => r.dob, mono: true },
      { header: 'Dept', render: (r) => r.department, mono: true },
      { header: 'Designation', render: (r) => r.designation, mono: true },
      { header: 'Roles', render: (r) => r.roles, mono: true },
    ],
    [],
  );

  const handleDownloadCreds = useCallback(() => {
    const rowsOut = [['Name', 'Employee Code', 'Mobile', 'Password']];
    for (const emp of createdEmployees) {
      rowsOut.push([emp.user.name, emp.user.userName, emp.user.mobileNumber, 'eGov@123']);
    }
    const csv = rowsOut
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    triggerDownload(blob, `employee-credentials-${tenantId}.csv`);
  }, [createdEmployees, tenantId]);

  return (
    <BulkImportPanel<EmployeeBulkRow>
      title="Bulk import employees"
      backTo="/manage/employees"
      tenantId={tenantId}
      referenceLoading={refsLoading}
      referenceCounts={[
        { label: 'Departments', value: departments.length },
        { label: 'Designations', value: designations.length },
        { label: 'Roles', value: roles.length },
        { label: 'Boundaries', value: templateBoundaries.length },
      ]}
      buildTemplate={() =>
        buildTemplate(tenantId, departments, designations, templateBoundaries, roles)
      }
      templateFilename={`employees-template-${tenantId}.xlsx`}
      parseWorkbook={parseWorkbook}
      validateRow={validateRow}
      columns={columns}
      createOne={createOne}
      entityLabel={{ singular: 'employee', plural: 'employees' }}
      completionExtras={(createdCount) =>
        createdCount > 0 ? (
          <Button variant="outline" onClick={handleDownloadCreds} className="gap-2">
            <Download className="w-4 h-4" />
            Download credentials CSV
          </Button>
        ) : null
      }
    />
  );
}
