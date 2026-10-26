import { useCallback, useEffect, useMemo, useState } from 'react';
import { useGetList } from 'ra-core';
import { Download } from 'lucide-react';
import * as XLSX from 'xlsx';
import { Button } from '@/components/ui/button';
import { BulkImportPanel, triggerDownload, type BulkRow, type BulkColumn } from '@/admin/bulk/BulkImportPanel';
import { parseEmployeeExcel } from '@/utils/excelParser';
import { useOnboardingT } from '@/onboarding/i18n';
import { buildEmployeeTemplate, employeeTemplateFilename } from '@/utils/templateBuilder';
import { hrmsService, mdmsService, boundaryService } from '@/api';
import { loadTenantHierarchies } from '@/api/services/tenantHierarchy';
import type {
  EmployeeExcelRow,
  Employee,
  Department,
  Designation,
  Boundary,
} from '@/api/types';
import { codeProblem, employeesByCode, withEmployeeCodes, type EmployeeRecord } from '@/onboarding/employees/employeesApi';
import { useApp } from '../../App';

type EmployeeBulkRow = EmployeeExcelRow & BulkRow;

export function EmployeeBulkImport() {
  const { state } = useApp();
  const tenantId = state.tenant;
  const t = useOnboardingT();

  const [departments, setDepartments] = useState<Department[]>([]);
  const [designations, setDesignations] = useState<Designation[]>([]);
  const [boundaries, setBoundaries] = useState<Boundary[]>([]);
  const [roles, setRoles] = useState<{ code: string; name: string; description?: string }[]>([]);
  // Mirrors what mdmsService.getMobileValidation actually returns. It has never
  // carried minLength/maxLength; declaring them optional here is what let the
  // validator silently read `undefined` and fall back to a hardcoded 9.
  const [mobileRules, setMobileRules] = useState<{
    pattern: string;
    errorMessage: string;
  } | null>(null);
  const [existingEmployees, setExistingEmployees] = useState<Map<string, EmployeeRecord>>(new Map());
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
        // Only the boundaries wait for the hierarchy walk.
        const boundariesInDefaultHierarchy = loadTenantHierarchies(tenantId).then(({ hierarchyType }) =>
          boundaryService.searchBoundaries(tenantId, hierarchyType ? { hierarchyType } : undefined),
        );

        const [depts, desigs, bounds, fetchedRoles, mobile, employees] = await Promise.all([
          mdmsService.getDepartments(tenantId),
          mdmsService.getDesignations(tenantId),
          boundariesInDefaultHierarchy,
          mdmsService.getRoles(tenantId).catch(() => [] as typeof roles),
          mdmsService.getMobileValidation(tenantId).catch(() => null),
          // The code check is advisory: creating still refuses a code that's taken.
          employeesByCode(tenantId).catch(() => new Map<string, EmployeeRecord>()),
        ]);
        if (cancelled) return;
        setDepartments(depts);
        setDesignations(desigs);
        setBoundaries(bounds);
        setRoles(fetchedRoles);
        setMobileRules(mobile);
        setExistingEmployees(employees);
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
    return { data: withEmployeeCodes(result.data, existingEmployees) as EmployeeBulkRow[] };
  }, [existingEmployees]);

  const validateRow = useCallback(
    (row: EmployeeBulkRow, rows: EmployeeBulkRow[]): string[] => {
      const deptCodes = new Set(departments.map((d) => d.code));
      const desigCodes = new Set(designations.map((d) => d.code));
      const boundaryCodes = new Set(templateBoundaries.map((b) => b.code));
      const validRoles = new Set(roles.map((r) => r.code));

      let compiled: RegExp | null = null;
      if (mobileRules) {
        try { compiled = new RegExp(mobileRules.pattern); } catch { compiled = null; }
      }

      const errors: string[] = [];
      if (!row.emailId || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.emailId)) errors.push('A valid email is required to invite an employee.');
      const clash = codeProblem(row, rows, existingEmployees);
      if (clash) errors.push('repeated' in clash ? `${row.employeeCode} is on more than one row` : `${row.employeeCode} is already used by ${clash.takenBy}`);
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
        // MDMS is the source of truth — egov-hrms's User.java no longer
        // carries its own `@Pattern("^[0-9]{10}$")`, validation is delegated
        // to MDMS via egov-user's MobileNumberValidator. Trust the rule
        // returned by `mdmsService.getMobileValidation` exactly. Closes the
        // bulk-import side of the CCRS#484/#540 BLOCKER.
        //
        // The regex IS the length rule — `^[6-9][0-9]{9}$` already pins ten
        // digits. There used to be a separate length window here reading
        // `minLength`/`maxLength` off the rule, but getMobileValidation returns
        // only { mobileNumberRegex, pattern, countryCode, prefix, errorMessage }
        // and never those two, so both collapsed to their `?? 9` default. Every
        // tenant on a 10-digit rule therefore had EVERY row rejected as "does
        // not match the configured format" — against a format the number did
        // match. Length now comes from the pattern alone.
        const msg = mobileRules?.errorMessage ?? 'Please enter a valid mobile number';
        // No rule reachable (MDMS down, or a tenant with no row): keep
        // excelParser's own 9-or-10-digit floor rather than accepting anything.
        const ok = compiled
          ? compiled.test(row.mobileNumber)
          : /^\d{9,10}$/.test(row.mobileNumber);
        if (!ok) errors.push(msg);
      }
      // dob is optional (egovernments/CCRS#1949) — a blank cell is fine, but a
      // filled one still has to be a real YYYY-MM-DD date.
      if (row.dob && !/^\d{4}-\d{2}-\d{2}$/.test(row.dob)) {
        errors.push('Date of birth malformed (expected YYYY-MM-DD)');
      }
      return errors;
    },
    [departments, designations, templateBoundaries, roles, mobileRules, existingEmployees],
  );

  const createOne = useCallback(
    async (row: EmployeeBulkRow) => {
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
        code: row.employeeCode,
        name: row.name,
        userName: row.employeeCode, // HRMS makes the username the code anyway
        mobileNumber: row.mobileNumber,
        emailId: row.emailId,
        gender: row.gender,
        dob: row.dob ? new Date(row.dob).getTime() : undefined,
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

  const handleDownloadInvitations = useCallback(() => {
    const rowsOut = [['Name', 'Employee Code', 'Mobile', 'Email']];
    for (const emp of createdEmployees) {
      rowsOut.push([emp.user.name, emp.user.userName, emp.user.mobileNumber, emp.user.emailId || '']);
    }
    const csv = rowsOut
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    triggerDownload(blob, `employee-invitations-${tenantId}.csv`);
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
        buildEmployeeTemplate(tenantId, departments, designations, templateBoundaries, roles, t)
      }
      templateFilename={employeeTemplateFilename(tenantId)}
      parseWorkbook={parseWorkbook}
      validateRow={validateRow}
      columns={columns}
      createOne={createOne}
      entityLabel={{ singular: 'employee', plural: 'employees' }}
      completionExtras={(createdCount) =>
        createdCount > 0 ? (
          <Button variant="outline" onClick={handleDownloadInvitations} className="gap-2">
            <Download className="w-4 h-4" />
            Download invitations CSV
          </Button>
        ) : null
      }
    />
  );
}
