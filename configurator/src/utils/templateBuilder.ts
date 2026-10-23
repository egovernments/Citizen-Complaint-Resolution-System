import * as XLSX from 'xlsx';
import { triggerDownload } from '@/admin/bulk/BulkImportPanel';

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

type CodeName = { code: string; name?: string };
type CodeBoundary = { code: string; boundaryType?: string };

/**
 * Employee bulk-import workbook: an `Employee` sheet with one sample row, a
 * `Codes` reference sheet listing the workspace's departments, designations,
 * roles and boundaries, and an `Instructions` sheet. The sample row uses codes
 * from the passed-in data (blank when a list is empty) so it never references
 * codes that do not exist in the workspace.
 */
export function buildEmployeeTemplate(
  tenant: string,
  depts: CodeName[],
  desigs: CodeName[],
  boundaries: CodeBoundary[],
  roles: { code: string; name?: string }[],
): Blob {
  const sample: Record<string, string> = {
    employeeCode: 'EMP_001',
    name: 'Jane Kamau',
    mobileNumber: '0712345678',
    emailId: 'jane.kamau@example.com',
    gender: 'FEMALE',
    dob: '1990-05-14',
    department: depts[0]?.code ?? '',
    designation: desigs[0]?.code ?? '',
    roles: (roles.find((r) => r.code === 'PGR_LME') ?? roles[0])?.code ?? '',
    jurisdictions: boundaries[0]?.code ?? '',
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
    ['departments (code : name)', 'designations (code : name)', 'roles (code)', 'boundaries (code : type)'],
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
    ['Employee bulk import template'],
    [`Tenant: ${tenant}`],
    [''],
    ['Required columns: name, mobileNumber (per the tenant mobile rule),'],
    ['department (from Codes), designation (from Codes).'],
    ['Required: emailId. Optional: employeeCode (blank = the next free EMP_ code),'],
    ['gender, dob (YYYY-MM-DD),'],
    ['roles (comma-separated), jurisdictions (comma-separated boundary codes),'],
    ['dateOfAppointment (YYYY-MM-DD).'],
    [''],
    ['Email is required. New employees receive a secure password setup email.'],
    ['Each employee signs in with their employee code as username.'],
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
) {
  triggerDownload(
    buildEmployeeTemplate(tenant, depts, desigs, boundaries, roles),
    `Employee_Master_Dynamic_${tenant.toUpperCase()}.xlsx`,
  );
}
