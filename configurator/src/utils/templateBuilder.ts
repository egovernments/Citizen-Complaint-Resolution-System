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
 * attribute columns. Each row is one leaf complaint type carrying its full
 * ancestor path — the parser derives ClassificationNodes (non-leaf cells,
 * de-duped) and ServiceDefs (leaf rows). The number/identity of columns
 * therefore reflects whatever hierarchy the operator defined — fully dynamic.
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
    const path = safe.map((lc, i) => {
      if (i === leafIdx) return leaf;
      if (i === leafIdx - 1 && sectorOverride) return sectorOverride;
      return ancestor[i];
    });
    return [...path, dept, sla, kw];
  };
  const rows: Row[] = [
    mkRow(null, 'Example Sub-type 1', 'DEPT_1', 24, 'keyword1, keyword2'),
    mkRow(null, 'Example Sub-type 2', 'DEPT_1', 48, 'keyword3'),
    mkRow(`Another ${safe[Math.max(0, leafIdx - 1)]}`, 'Example Sub-type 3', 'DEPT_2', 72, 'keyword4'),
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, buildSheet(header, rows), 'ComplaintHierarchy');
  triggerDownload(writeWorkbook(wb), `Complaint_Hierarchy_${hierarchyType || 'PGR'}.xlsx`);
}

export function downloadEmployeeTemplate() {
  const header = [
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
  // `department` accepts a comma-separated list — each extra department
  // becomes a historical HRMS assignment (bootstrap-ADMIN pattern), letting
  // one employee qualify as assignee for complaints in all of them.
  const rows: Row[] = [
    [
      'EMP001',
      'Jane Doe',
      'jane.doe',
      '777777701',
      'jane@example.com',
      'FEMALE',
      '1990-01-15',
      'ENV',
      'OFFICER',
      'EMPLOYEE,PGR_LME',
      'WARD_001',
      '2024-06-01',
    ],
    [
      'EMP002',
      'John Admin',
      'john.admin',
      '777777702',
      'john.admin@example.com',
      'MALE',
      '1985-03-10',
      'ENV,WORKS',
      'OFFICER',
      'EMPLOYEE,GRO,DGRO',
      'COUNTY_001',
      '2024-06-01',
    ],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, buildSheet(header, rows), 'Employee');
  triggerDownload(writeWorkbook(wb), 'Employee_Template.xlsx');
}
