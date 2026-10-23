import * as XLSX from 'xlsx';
import { triggerDownload } from '@/admin/bulk/BulkImportPanel';
import type { Boundary, Department, Designation } from '@/api/types';
import { englishT, type OnboardingT } from '@/onboarding/i18n';
import { allowedEmployeeRoles, pickerChoices } from '@/lib/systemRecords';

type Row = Array<string | number>;

function buildSheet(header: string[], rows: Row[]): XLSX.WorkSheet {
  const aoa: (string | number)[][] = [header, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = header.map((h) => ({ wch: Math.max(14, h.length + 2) }));
  return ws;
}

function writeWorkbook(wb: XLSX.WorkBook): Blob {
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

/** The boundaries on screen as a sheet: one column per level, one row per area path. */
export function downloadBoundaryList(levels: string[], rows: string[][], filename: string) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, buildSheet(levels, rows), 'Boundaries');
  triggerDownload(writeWorkbook(wb), filename);
}

export function downloadBoundaryTemplate(hierarchyType: string, levels: string[]) {
  const safeLevels = levels.length > 0 ? levels : ['Country', 'State', 'City', 'Ward'];
  const header = ['code', 'name', 'boundaryType', 'parentCode', 'latitude', 'longitude'];
  const sample: Row[] = safeLevels.map((level, i) => {
    const code = `${level.toUpperCase().replace(/\s+/g, '_')}_001`;
    const parent = i === 0 ? '' : `${safeLevels[i - 1].toUpperCase().replace(/\s+/g, '_')}_001`;
    return [code, `Sample ${level}`, level, parent, '', ''];
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, buildSheet(header, sample), 'Boundary');
  const filename = `Boundary_Template_${hierarchyType || 'ADMIN'}.xlsx`;
  triggerDownload(writeWorkbook(wb), filename);
}

export function downloadCommonMastersTemplate() {
  const wb = XLSX.utils.book_new();

  const deptHeader = ['code', 'name', 'active'];
  const deptRows: Row[] = [
    ['ENV', 'Environment', 'true'],
    ['WORKS', 'Public Works', 'true'],
  ];
  XLSX.utils.book_append_sheet(wb, buildSheet(deptHeader, deptRows), 'Department');

  const desigHeader = ['code', 'name', 'description', 'department', 'active'];
  const desigRows: Row[] = [
    ['OFFICER', 'Officer', 'Field Officer', 'ENV', 'true'],
    ['INSPECTOR', 'Inspector', 'Senior Inspector', 'ENV,WORKS', 'true'],
  ];
  XLSX.utils.book_append_sheet(wb, buildSheet(desigHeader, desigRows), 'Designation');

  // Complaint types are no longer part of this workbook — they are defined in
  // Phase 3 Step 3.2 via the configurable complaint-hierarchy flow
  // (downloadComplaintHierarchyTemplate), which supersedes the old flat
  // "ComplaintType" sheet.
  triggerDownload(writeWorkbook(wb), 'Departments_and_Designations.xlsx');
}

/**
 * Dynamic complaint-hierarchy template. Columns are generated from the
 * operator-defined levels (one column per level, top→leaf) plus the leaf
 * attribute columns (Department Name*, Resolution Time (Hours)*, Search Words*,
 * which map to the leaf fields department / slaHours / keywords). Each row is
 * one leaf complaint type carrying its full ancestor path — the parser folds
 * the non-leaf cells (de-duped) and the leaf rows into the ONE ComplaintHierarchy
 * node array. The number/identity of columns reflects whatever hierarchy the
 * operator defined — fully dynamic.
 */
export function downloadComplaintHierarchyTemplate(hierarchyType: string, levelCodes: string[]) {
  const levels = levelCodes.filter((l) => l && l.trim());
  const safe = levels.length >= 2 ? levels : ['AUTHORITY_TYPE', 'MAIN_CATEGORY', 'SECTOR', 'SUB_TYPE'];
  const leafIdx = safe.length - 1;
  const header = [...safe, 'Department Name*', 'Resolution Time (Hours)*', 'Search Words*'];

  // Example rows: rows 1-2 share ancestors (two leaves under one sector),
  // row 3 varies the sector — shows the grouping the hierarchy produces.
  const ancestor = safe.slice(0, leafIdx).map((lc) => `Sample ${lc}`);
  const mkRow = (
    sectorOverride: string | null,
    leaf: string,
    dept: string,
    sla: number,
    kw: string
  ): Row => {
    const path = safe.map((_lc, i) => {
      if (i === leafIdx) return leaf;
      if (i === leafIdx - 1 && sectorOverride) return sectorOverride;
      return ancestor[i];
    });
    return [...path, dept, sla, kw];
  };
  const rows: Row[] = [
    mkRow(null, 'Example Subcategory 1', 'DEPT_1', 24, 'keyword1, keyword2'),
    mkRow(null, 'Example Subcategory 2', 'DEPT_1', 48, 'keyword3'),
    mkRow(`Another ${safe[Math.max(0, leafIdx - 1)]}`, 'Example Subcategory 3', 'DEPT_2', 72, 'keyword4'),
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, buildSheet(header, rows), 'ComplaintHierarchy');
  triggerDownload(writeWorkbook(wb), `Complaint_Hierarchy_${hierarchyType || 'PGR'}.xlsx`);
}

const EMPLOYEE_TEMPLATE_COLUMNS = [
  'employeeCode',
  'name',
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

type CodeName = Pick<Department | Designation, 'code' | 'name'>;
type CodeBoundary = Pick<Boundary, 'code' | 'boundaryType'> & Partial<Pick<Boundary, 'parent' | 'hierarchyType'>>;

/** The one name of the employee template workbook, shown on screen and used for the download. */
export function employeeTemplateFilename(tenant: string): string {
  return `Employee_Master_Dynamic_${tenant.toUpperCase()}.xlsx`;
}

/**
 * Employee bulk-import workbook: an `Employee` sheet with one sample row, a
 * `Codes` reference sheet listing the workspace's departments, designations,
 * roles and boundaries, and an `Instructions` sheet. The lists are narrowed to
 * what an employee can be given (no founder records, no platform roles), and the
 * sample row uses codes from them (blank when a list is empty) so it never
 * references codes that do not exist in the workspace. The sample roles keep
 * EMPLOYEE first, which the parser does not add when the cell is filled and
 * without which the employee cannot sign in; the jurisdiction is a leaf boundary
 * so a copied row is not tenant-wide; the mobile number is left blank because
 * only the tenant's own rule says what is valid.
 */
export function buildEmployeeTemplate(
  tenant: string,
  allDepts: CodeName[],
  allDesigs: CodeName[],
  allBoundaries: CodeBoundary[],
  allRoles: { code: string; name?: string }[],
  t: OnboardingT = englishT,
): Blob {
  const depts = pickerChoices(allDepts, (d) => d.code);
  const desigs = pickerChoices(allDesigs, (d) => d.code);
  const roles = allowedEmployeeRoles(allRoles);
  // The reserved WORKSPACE hierarchy roots the founder; it is not a place to assign anyone.
  const boundaries = pickerChoices(allBoundaries, (b) => b.hierarchyType);
  const parents = new Set(boundaries.map((b) => b.parent).filter(Boolean));
  const leaf = boundaries.find((b) => !parents.has(b.code));
  const extraRole = (roles.find((r) => r.code === 'PGR_LME') ?? roles.find((r) => r.code !== 'EMPLOYEE'))?.code;

  const sample: Record<string, string> = {
    employeeCode: 'EMP_001',
    name: 'Jane Kamau',
    mobileNumber: '',
    emailId: 'jane.kamau@example.com',
    gender: 'FEMALE',
    dob: '1990-05-14',
    department: depts[0]?.code ?? '',
    designation: desigs[0]?.code ?? '',
    roles: ['EMPLOYEE', extraRole].filter(Boolean).join(','),
    jurisdictions: leaf?.code ?? '',
    dateOfAppointment: '2026-01-15',
  };

  const wb = XLSX.utils.book_new();
  const primary = XLSX.utils.aoa_to_sheet([
    EMPLOYEE_TEMPLATE_COLUMNS,
    EMPLOYEE_TEMPLATE_COLUMNS.map((c) => sample[c] ?? ''),
  ]);
  primary['!cols'] = EMPLOYEE_TEMPLATE_COLUMNS.map((c) => ({ wch: Math.max(12, c.length + 2) }));
  XLSX.utils.book_append_sheet(wb, primary, 'Employee');

  const maxLen = Math.max(depts.length, desigs.length, roles.length, boundaries.length);
  const rows: (string | undefined)[][] = [
    [
      t('bulk_employees.codes_departments', 'departments (code : name)'),
      t('bulk_employees.codes_designations', 'designations (code : name)'),
      t('bulk_employees.codes_roles', 'roles (code)'),
      t('bulk_employees.codes_boundaries', 'boundaries (code : type)'),
    ],
  ];
  for (let i = 0; i < maxLen; i += 1) {
    rows.push([
      depts[i] ? `${depts[i].code} : ${depts[i].name ?? ''}` : '',
      desigs[i] ? `${desigs[i].code} : ${desigs[i].name ?? ''}` : '',
      roles[i] ? roles[i].code : '',
      boundaries[i] ? `${boundaries[i].code} : ${boundaries[i].boundaryType ?? ''}` : '',
    ]);
  }
  const ref = XLSX.utils.aoa_to_sheet(rows);
  ref['!cols'] = [{ wch: 36 }, { wch: 36 }, { wch: 20 }, { wch: 36 }];
  XLSX.utils.book_append_sheet(wb, ref, 'Codes');

  const notes = XLSX.utils.aoa_to_sheet([
    [t('bulk_employees.instr_title', 'Employee bulk import template')],
    [t('bulk_employees.instr_tenant', 'Tenant: %{tenant}', { tenant })],
    [''],
    [t('bulk_employees.instr_required_1', 'Required columns: name, mobileNumber (per the tenant mobile rule; the sample row leaves it blank),')],
    [t('bulk_employees.instr_required_2', 'department (ONE department code from Codes), designation (from Codes).')],
    [t('bulk_employees.instr_required_3', 'Required: emailId. Optional: employeeCode (blank = the next free EMP_ code),')],
    [t('bulk_employees.instr_optional_1', 'gender, dob (YYYY-MM-DD),')],
    [t('bulk_employees.instr_optional_2', 'roles (comma-separated; keep EMPLOYEE first, it is what lets the employee sign in),')],
    [t('bulk_employees.instr_optional_3', 'jurisdictions (comma-separated boundary codes; the sample uses a lowest-level boundary),')],
    [t('bulk_employees.instr_optional_4', 'dateOfAppointment (YYYY-MM-DD).')],
    [''],
    [t('bulk_employees.instr_email', 'Email is required. New employees receive a secure password setup email.')],
    [t('bulk_employees.instr_signin', 'Each employee signs in with their email address.')],
  ]);
  notes['!cols'] = [{ wch: 80 }];
  XLSX.utils.book_append_sheet(wb, notes, 'Instructions');

  return writeWorkbook(wb);
}

export function downloadEmployeeTemplate(
  tenant: string,
  depts: CodeName[],
  desigs: CodeName[],
  boundaries: CodeBoundary[],
  roles: { code: string; name?: string }[],
  t: OnboardingT = englishT,
) {
  triggerDownload(buildEmployeeTemplate(tenant, depts, desigs, boundaries, roles, t), employeeTemplateFilename(tenant));
}
