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

  const ctHeader = ['serviceCode', 'name', 'keywords', 'department', 'slaHours', 'active'];
  const ctRows: Row[] = [
    ['POTHOLE', 'Pothole Repair', 'pothole,road', 'WORKS', 120, 'true'],
    ['GARBAGE', 'Garbage Collection', 'garbage,waste', 'ENV', 48, 'true'],
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
  const rows: Row[] = [
    [
      'EMP001',
      'Jane Doe',
      'jane.doe',
      '9000000001',
      'jane@example.com',
      'FEMALE',
      '1990-01-15',
      'ENV',
      'OFFICER',
      'EMPLOYEE,GRO',
      'WARD_001',
      '2024-06-01',
    ],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, buildSheet(header, rows), 'Employee');
  triggerDownload(writeWorkbook(wb), 'Employee_Template.xlsx');
}
