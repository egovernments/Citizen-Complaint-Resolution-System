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

  // Operator-friendly headers: "Complaint Type*" is the menu group shown in
  // the citizen UI, "Complaint sub type*" the actual complaint. serviceCode
  // and menuPath are derived on upload (excelParser/xlsx-reader) — sheet
  // authors never deal with API field names. Sub-types sharing the same
  // "Complaint Type*" value land under one menu entry (see the two
  // Water Pipes sample rows).
  const ctHeader = ['Complaint Type*', 'Complaint sub type*', 'department', 'slaHours', 'keywords', 'active'];
  const ctRows: Row[] = [
    ['Water Pipes', 'Pipe leakage or damage', 'WORKS', 48, 'leak, damage', 'true'],
    ['Water Pipes', 'Low pressure', 'WORKS', 48, 'low pressure', 'true'],
    ['Garbage', 'Missed garbage collection', 'ENV', 48, 'garbage, waste', 'true'],
  ];
  XLSX.utils.book_append_sheet(wb, buildSheet(ctHeader, ctRows), 'ComplaintType');

  triggerDownload(writeWorkbook(wb), 'Common_and_Complaint_Master.xlsx');
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
