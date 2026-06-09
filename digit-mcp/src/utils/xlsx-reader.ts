/**
 * xlsx-reader.ts — TypeScript port of CCRS UnifiedExcelReader.
 * Parses xlsx sheets in CCRS-compatible format into structured data
 * ready for DIGIT API calls.
 */
import ExcelJS from 'exceljs';
import * as fs from 'fs';

// ── Types ──

export interface TenantRecord {
  code: string;
  name: string;
  type: string;
  logoFilePath?: string;
  city: {
    code: string;
    name: string;
    districtName?: string;
    latitude?: number;
    longitude?: number;
  };
  domainUrl?: string;
}

export interface TenantBrandingRecord {
  code: string;
  name: string;
  bannerUrl?: string;
  logoUrl?: string;
  logoUrlWhite?: string;
  statelogo?: string;
}

export interface LocalizationMessage {
  code: string;
  message: string;
  module: string;
  locale: string;
}

export interface DepartmentRecord {
  code: string;
  name: string;
  enabled: boolean;
  active: boolean;
}

export interface DesignationRecord {
  code: string;
  name: string;
  enabled: boolean;
  active: boolean;
  description?: string;
}

export interface ComplaintTypeRecord {
  serviceCode: string;
  name: string;
  menuPath: string;
  department: string;
  slaHours: number;
  keywords: string;
  order: number;
  active: boolean;
}

export interface EmployeeRecord {
  code: string;
  name: string;
  mobileNumber: string;
  departmentName: string;
  designationName: string;
  roleNames: string[];
  appointmentDate: number; // Unix ms
  joiningDate: number; // Unix ms
  password: string;
  // Configurator-format extras (optional; legacy file may omit)
  userName?: string;
  emailId?: string;
  gender?: string;
  dob?: number;
  jurisdictionCodes?: string[];
}

// ── Helpers ──

/**
 * Read a worksheet into an array of row objects keyed by header names.
 * Skips the header row (row 1) and any fully empty rows.
 */
function sheetToRows(sheet: ExcelJS.Worksheet): Record<string, string>[] {
  const headerRow = sheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    headers[colNumber] = cell.text.trim();
  });

  const rows: Record<string, string>[] = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const obj: Record<string, string> = {};
    let hasValue = false;
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const header = headers[colNumber];
      if (header) {
        const val = cellToString(cell);
        obj[header] = val;
        if (val) hasValue = true;
      }
    });
    if (hasValue) rows.push(obj);
  });
  return rows;
}

/** Convert an ExcelJS cell value to a plain string. Handles dates, numbers, nulls. */
function cellToString(cell: ExcelJS.Cell): string {
  const val = cell.value;
  if (val === null || val === undefined) return '';
  if (val instanceof Date) return val.toISOString();
  if (typeof val === 'object' && 'result' in val) {
    // Formula cell — use the result
    const result = (val as ExcelJS.CellFormulaValue).result;
    if (result === null || result === undefined) return '';
    return String(result);
  }
  return String(val).trim();
}

/**
 * Convert an Excel date value to Unix timestamp in milliseconds.
 * Handles: Date objects, ISO strings, Excel serial numbers.
 */
export function excelDateToTimestamp(value: unknown): number {
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === 'string') {
    const d = new Date(value);
    if (!isNaN(d.getTime())) return d.getTime();
  }
  if (typeof value === 'number') {
    // Excel serial date: days since 1899-12-30
    // JavaScript epoch: 1970-01-01 = Excel serial 25569
    const msPerDay = 86400000;
    return Math.round((value - 25569) * msPerDay);
  }
  throw new Error(`Cannot convert "${value}" to date timestamp`);
}

/** Generate PascalCase code from a name: "Road Pothole" → "RoadPothole" */
export function nameToPascalCode(name: string): string {
  return name
    .split(/[\s_-]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join('');
}

/** Generate UPPER_SNAKE code from a name: "John Smith" → "JOHN_SMITH" */
export function nameToUpperSnake(name: string): string {
  return name
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^A-Z0-9_]/g, '');
}

/**
 * Find a worksheet by trying multiple names (case-insensitive).
 * Returns undefined if none found.
 */
function findSheet(workbook: ExcelJS.Workbook, ...names: string[]): ExcelJS.Worksheet | undefined {
  for (const name of names) {
    const sheet = workbook.worksheets.find(
      (ws) => ws.name.toLowerCase().trim() === name.toLowerCase().trim(),
    );
    if (sheet) return sheet;
  }
  return undefined;
}

// ── Sheet Readers ──

/**
 * Read "Tenant Info" sheet → tenant records + localization messages.
 */
export function readTenantInfo(workbook: ExcelJS.Workbook): {
  tenants: TenantRecord[];
  localizations: LocalizationMessage[];
} {
  const sheet = findSheet(workbook, 'Tenant Info');
  if (!sheet) throw new Error("Sheet 'Tenant Info' not found in workbook");

  const rows = sheetToRows(sheet);
  const tenants: TenantRecord[] = [];
  const localizations: LocalizationMessage[] = [];

  for (const row of rows) {
    const name = row['Tenant Display Name*'];
    const code = (row['Tenant Code*'] || '').toLowerCase().replace(/\./g, '');
    const type = row['Tenant Type*'];

    if (!name || !code) continue;

    const tenant: TenantRecord = {
      code,
      name,
      type: type || 'CITY',
      logoFilePath: row['Logo File Path*'] || undefined,
      city: {
        code: code.toUpperCase(),
        name: row['City Name'] || name,
        districtName: row['District Name'] || undefined,
        latitude: row['Latitude'] ? parseFloat(row['Latitude']) : undefined,
        longitude: row['Longitude'] ? parseFloat(row['Longitude']) : undefined,
      },
      domainUrl: row['Tenant Website'] || undefined,
    };
    tenants.push(tenant);

    // Auto-generate localization key
    localizations.push({
      code: `TENANT_TENANTS_${code.toUpperCase().replace(/\./g, '_')}`,
      message: name,
      module: 'rainmaker-common',
      locale: 'en_IN',
    });
  }

  return { tenants, localizations };
}

/**
 * Read optional "Tenant Branding Details" sheet → branding records.
 * Returns empty array if sheet not found (it's optional).
 */
export function readTenantBranding(workbook: ExcelJS.Workbook): TenantBrandingRecord[] {
  const sheet = findSheet(workbook, 'Tenant Branding Details');
  if (!sheet) return []; // Optional sheet

  const rows = sheetToRows(sheet);
  const records: TenantBrandingRecord[] = [];

  for (const row of rows) {
    const code = (row['Tenant Code*'] || row['Tenant Code'] || '').toLowerCase().replace(/\./g, '');
    if (!code) continue;

    records.push({
      code,
      name: row['Tenant Display Name*'] || row['Tenant Display Name'] || code,
      bannerUrl: row['Banner URL'] || undefined,
      logoUrl: row['Logo URL'] || undefined,
      logoUrlWhite: row['Logo URL (White)'] || undefined,
      statelogo: row['State Logo'] || undefined,
    });
  }

  return records;
}

/**
 * Read departments + designations + their localizations from either the
 * legacy CCRS dataloader format (one combined "Department And Designation
 * Master" sheet with `Department Name*` / `Designation Name*` columns and
 * auto-generated codes) OR the configurator format (separate `Department`
 * and `Designation` sheets with explicit `code` columns).
 *
 * Returns a `deptNameToCode` map keyed by BOTH the human name and the
 * lowercase code so downstream phases can resolve either reference.
 */
export function readDepartmentsDesignations(workbook: ExcelJS.Workbook): {
  departments: DepartmentRecord[];
  designations: DesignationRecord[];
  localizations: LocalizationMessage[];
  deptNameToCode: Map<string, string>;
  desigNameToCode: Map<string, string>;
} {
  // Configurator format: separate sheets, explicit codes.
  const deptSheet = findSheet(workbook, 'Department', 'Departments', 'DepartmentMaster', 'department');
  const desigSheet = findSheet(workbook, 'Designation', 'Designations', 'DesignationMaster', 'designation');
  if (deptSheet && desigSheet) {
    return readMastersConfigurator(deptSheet, desigSheet);
  }

  // Legacy format: one combined sheet.
  const sheet = findSheet(
    workbook,
    'Department And Designation Master',
    'Department and Designation Master',
    'Department And Designation Mast', // ExcelJS truncates to 31 chars
  );
  if (!sheet) {
    throw new Error(
      "Masters sheet not found. Expected configurator format ('Department' + 'Designation' sheets) " +
      "or legacy CCRS format ('Department And Designation Master' sheet).",
    );
  }
  return readMastersLegacy(sheet);
}

function readMastersConfigurator(
  deptSheet: ExcelJS.Worksheet,
  desigSheet: ExcelJS.Worksheet,
): {
  departments: DepartmentRecord[];
  designations: DesignationRecord[];
  localizations: LocalizationMessage[];
  deptNameToCode: Map<string, string>;
  desigNameToCode: Map<string, string>;
} {
  const departments: DepartmentRecord[] = [];
  const deptNameToCode = new Map<string, string>();
  for (const row of sheetToRows(deptSheet)) {
    const code = (row['code'] || row['Code'] || row['CODE'])?.trim();
    const name = (row['name'] || row['Name'])?.trim();
    if (!code || !name) continue;
    const active = parseBoolish(row['active'] ?? row['Active'], true);
    departments.push({ code, name, enabled: active, active });
    deptNameToCode.set(name, code);
    deptNameToCode.set(code, code); // self-reference so designation rows that use code resolve cleanly
  }

  const designations: DesignationRecord[] = [];
  const desigNameToCode = new Map<string, string>();
  for (const row of sheetToRows(desigSheet)) {
    const code = (row['code'] || row['Code'])?.trim();
    const name = (row['name'] || row['Name'])?.trim();
    if (!code || !name) continue;
    const active = parseBoolish(row['active'] ?? row['Active'], true);
    const description = (row['description'] || row['Description'] || '').trim() || name;
    designations.push({ code, name, enabled: active, active, description });
    desigNameToCode.set(name, code);
    desigNameToCode.set(code, code);
  }

  const localizations: LocalizationMessage[] = [
    ...departments.map((d) => ({
      code: `COMMON_MASTERS_DEPARTMENT_${d.code}`,
      message: d.name,
      module: 'rainmaker-common',
      locale: 'en_IN',
    })),
    ...designations.map((d) => ({
      code: `COMMON_MASTERS_DESIGNATION_${d.code}`,
      message: d.name,
      module: 'rainmaker-common',
      locale: 'en_IN',
    })),
  ];

  return { departments, designations, localizations, deptNameToCode, desigNameToCode };
}

function readMastersLegacy(sheet: ExcelJS.Worksheet): {
  departments: DepartmentRecord[];
  designations: DesignationRecord[];
  localizations: LocalizationMessage[];
  deptNameToCode: Map<string, string>;
  desigNameToCode: Map<string, string>;
} {
  const rows = sheetToRows(sheet);

  const deptNames = new Set<string>();
  const desigNames = new Set<string>();
  for (const row of rows) {
    const dept = row['Department Name*']?.trim();
    const desig = row['Designation Name*']?.trim();
    if (dept) deptNames.add(dept);
    if (desig) desigNames.add(desig);
  }

  const departments: DepartmentRecord[] = [];
  const deptNameToCode = new Map<string, string>();
  let deptIdx = 1;
  for (const name of deptNames) {
    const code = `DEPT_${deptIdx}`;
    departments.push({ code, name, enabled: true, active: true });
    deptNameToCode.set(name, code);
    deptIdx++;
  }

  const designations: DesignationRecord[] = [];
  const desigNameToCode = new Map<string, string>();
  let desigIdx = 1;
  for (const name of desigNames) {
    const code = `DESIG_${String(desigIdx).padStart(2, '0')}`;
    designations.push({ code, name, enabled: true, active: true });
    desigNameToCode.set(name, code);
    desigIdx++;
  }

  const localizations: LocalizationMessage[] = [
    ...departments.map((d) => ({
      code: `COMMON_MASTERS_DEPARTMENT_${d.code}`,
      message: d.name,
      module: 'rainmaker-common',
      locale: 'en_IN',
    })),
    ...designations.map((d) => ({
      code: `COMMON_MASTERS_DESIGNATION_${d.code}`,
      message: d.name,
      module: 'rainmaker-common',
      locale: 'en_IN',
    })),
  ];

  return { departments, designations, localizations, deptNameToCode, desigNameToCode };
}

function parseBoolish(val: unknown, fallback: boolean): boolean {
  if (val === undefined || val === null || val === '') return fallback;
  const s = String(val).trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'active'].includes(s)) return true;
  if (['false', '0', 'no', 'n', 'inactive'].includes(s)) return false;
  return fallback;
}

/**
 * Read "Complaint Type Master" sheet → complaint types + localizations.
 * Handles parent-child hierarchy: parent rows have "Complaint Type*",
 * child rows have "Complaint sub type*". Children inherit department/SLA from parent.
 */
export function readComplaintTypes(
  workbook: ExcelJS.Workbook,
  deptNameToCode: Map<string, string>,
): {
  complaintTypes: ComplaintTypeRecord[];
  localizations: LocalizationMessage[];
} {
  // Configurator format: flat sheet with explicit serviceCode + slaHours + department columns.
  const flat = findSheet(workbook, 'ComplaintType', 'ComplaintTypes', 'ServiceDefs', 'servicedefs', 'PGR');
  if (flat) {
    return readComplaintTypesFlat(flat, deptNameToCode);
  }

  const sheet = findSheet(workbook, 'Complaint Type Master');
  if (!sheet) {
    throw new Error(
      "Complaint type sheet not found. Expected configurator format ('ComplaintType' sheet) " +
      "or legacy CCRS format ('Complaint Type Master' sheet).",
    );
  }

  const rows = sheetToRows(sheet);
  const complaintTypes: ComplaintTypeRecord[] = [];
  const localizations: LocalizationMessage[] = [];

  let currentParent: {
    name: string;
    department: string;
    slaHours: number;
    keywords: string;
  } | null = null;
  let order = 1;

  for (const row of rows) {
    const parentName = row['Complaint Type*']?.trim();
    const childName = row['Complaint sub type*']?.trim();

    if (parentName) {
      // This is a parent row — update current parent context
      const deptName = row['Department Name*']?.trim() || '';
      const deptCode = deptNameToCode.get(deptName) || deptName;
      currentParent = {
        name: parentName,
        department: deptCode,
        slaHours: parseInt(row['Resolution Time (Hours)*'] || '48', 10) || 48,
        keywords: row['Search Words*'] || '',
      };

      // Create the parent complaint type record
      const serviceCode = nameToPascalCode(parentName);
      complaintTypes.push({
        serviceCode,
        name: parentName,
        menuPath: `complaints.categories.${serviceCode}`,
        department: deptCode,
        slaHours: currentParent.slaHours,
        keywords: currentParent.keywords,
        order: order++,
        active: true,
      });

      localizations.push({
        code: `SERVICEDEFS.${serviceCode.toUpperCase()}`,
        message: parentName,
        module: 'rainmaker-pgr',
        locale: 'en_IN',
      });
    } else if (childName && currentParent) {
      // This is a child row — inherits from current parent
      const serviceCode = nameToPascalCode(`${currentParent.name} ${childName}`);
      const childDept = row['Department Name*']?.trim();
      const childDeptCode = childDept ? (deptNameToCode.get(childDept) || childDept) : currentParent.department;

      complaintTypes.push({
        serviceCode,
        name: childName,
        menuPath: `complaints.categories.${nameToPascalCode(currentParent.name)}.${serviceCode}`,
        department: childDeptCode,
        slaHours: parseInt(row['Resolution Time (Hours)*'] || '', 10) || currentParent.slaHours,
        keywords: row['Search Words*'] || currentParent.keywords,
        order: order++,
        active: true,
      });

      localizations.push({
        code: `SERVICEDEFS.${serviceCode.toUpperCase()}`,
        message: childName,
        module: 'rainmaker-pgr',
        locale: 'en_IN',
      });
    }
  }

  return { complaintTypes, localizations };
}

/**
 * Configurator format: flat ComplaintType sheet with explicit serviceCode,
 * department references (name or code), and slaHours per row. No parent /
 * sub-type — every row is a standalone service definition.
 */
function readComplaintTypesFlat(
  sheet: ExcelJS.Worksheet,
  deptNameToCode: Map<string, string>,
): {
  complaintTypes: ComplaintTypeRecord[];
  localizations: LocalizationMessage[];
} {
  const complaintTypes: ComplaintTypeRecord[] = [];
  const localizations: LocalizationMessage[] = [];
  let order = 1;

  for (const row of sheetToRows(sheet)) {
    const serviceCode = (row['serviceCode'] || row['ServiceCode'] || row['code'])?.trim();
    const name = (row['name'] || row['Name'])?.trim();
    if (!serviceCode || !name) continue;

    const deptRef = (row['department'] || row['Department'] || '').trim();
    const deptCode = deptNameToCode.get(deptRef) || deptRef;
    const slaRaw = row['slaHours'] ?? row['SLA Hours'] ?? row['slaHours*'];
    const slaHours = parseInt(String(slaRaw ?? ''), 10) || 48;
    const keywords = (row['keywords'] || row['Keywords'] || '').trim();
    const active = parseBoolish(row['active'] ?? row['Active'], true);

    complaintTypes.push({
      serviceCode,
      name,
      menuPath: `complaints.categories.${serviceCode}`,
      department: deptCode,
      slaHours,
      keywords,
      order: order++,
      active,
    });

    localizations.push({
      code: `SERVICEDEFS.${serviceCode.toUpperCase()}`,
      message: name,
      module: 'rainmaker-pgr',
      locale: 'en_IN',
    });
  }

  return { complaintTypes, localizations };
}

/**
 * Read employees from either configurator format (sheet 'Employee' /
 * 'Employees' / … with `employeeCode` + `mobileNumber` columns) or legacy
 * 'Employee Master' (with `User Name*` / `Mobile Number*` columns and
 * auto-generated codes from name).
 */
export function readEmployees(workbook: ExcelJS.Workbook): EmployeeRecord[] {
  const newSheet = findSheet(workbook, 'Employee', 'Employees', 'EmployeeMaster', 'HRMS', 'employee');
  if (newSheet) {
    const sample = sheetToRows(newSheet)[0] ?? {};
    if ('employeeCode' in sample || 'mobileNumber' in sample || 'userName' in sample) {
      return readEmployeesConfigurator(newSheet);
    }
  }

  const sheet = findSheet(workbook, 'Employee Master');
  if (!sheet) {
    throw new Error(
      "Employee sheet not found. Expected configurator format ('Employee' sheet with " +
      "'employeeCode'/'mobileNumber' columns) or legacy CCRS format ('Employee Master' sheet).",
    );
  }
  return readEmployeesLegacy(sheet);
}

function readEmployeesConfigurator(sheet: ExcelJS.Worksheet): EmployeeRecord[] {
  const rows = sheetToRows(sheet);
  const employees: EmployeeRecord[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const code = (row['employeeCode'] || row['EmployeeCode'] || row['code'])?.trim();
    const name = (row['name'] || row['Name'])?.trim();
    const mobile = (row['mobileNumber'] || row['MobileNumber'] || row['mobile'])?.trim();
    if (!code || !name || !mobile) continue;

    // Pull the raw date cell so excelDateToTimestamp gets a Date object, not a string.
    const dobRaw = sheet.getRow(i + 2).getCell(findColumnIndex(sheet, 'dob')).value;
    const appointmentRaw = sheet.getRow(i + 2).getCell(findColumnIndex(sheet, 'dateOfAppointment')).value;

    const roles = (row['roles'] || 'EMPLOYEE')
      .split(',').map((r) => r.trim()).filter(Boolean);
    const jurisdictions = (row['jurisdictions'] || '')
      .split(',').map((r) => r.trim()).filter(Boolean);

    let dob: number | undefined;
    try { dob = dobRaw ? excelDateToTimestamp(dobRaw) : undefined; } catch { dob = undefined; }
    let appointmentDate = 0;
    try { appointmentDate = excelDateToTimestamp(appointmentRaw || row['dateOfAppointment']); } catch { appointmentDate = Date.now(); }

    employees.push({
      code,
      name,
      mobileNumber: mobile.replace(/\D/g, '').slice(-10),
      departmentName: (row['department'] || '').trim(),
      designationName: (row['designation'] || '').trim(),
      roleNames: roles,
      appointmentDate,
      joiningDate: appointmentDate,
      password: row['password'] || 'eGov@123',
      userName: (row['userName'] || row['username'] || '').trim() || code,
      emailId: (row['emailId'] || row['email'] || '').trim() || undefined,
      gender: (row['gender'] || '').trim() || undefined,
      dob,
      jurisdictionCodes: jurisdictions,
    });
  }

  return employees;
}

function readEmployeesLegacy(sheet: ExcelJS.Worksheet): EmployeeRecord[] {
  const rows = sheetToRows(sheet);
  const employees: EmployeeRecord[] = [];
  const seenCodes = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const name = row['User Name*']?.trim();
    const mobile = row['Mobile Number*']?.trim();
    if (!name || !mobile) continue;

    let code = nameToUpperSnake(name);
    if (seenCodes.has(code)) {
      let suffix = 2;
      while (seenCodes.has(`${code}_${suffix}`)) suffix++;
      code = `${code}_${suffix}`;
    }
    seenCodes.add(code);

    const appointmentRaw = sheet.getRow(i + 2).getCell(findColumnIndex(sheet, 'Date of Appointment*')).value;
    const joiningRaw = sheet.getRow(i + 2).getCell(findColumnIndex(sheet, 'Assignment From Date*')).value;

    employees.push({
      code,
      name,
      mobileNumber: mobile.replace(/\D/g, '').slice(-10),
      departmentName: row['Department Name*']?.trim() || '',
      designationName: row['Designation Name*']?.trim() || '',
      roleNames: (row['Role Names*'] || 'EMPLOYEE').split(',').map((r) => r.trim()).filter(Boolean),
      appointmentDate: excelDateToTimestamp(appointmentRaw || row['Date of Appointment*']),
      joiningDate: excelDateToTimestamp(joiningRaw || row['Assignment From Date*']),
      password: row['Password'] || 'eGov@123',
    });
  }

  return employees;
}

/** Find column index (1-based) by header name. */
function findColumnIndex(sheet: ExcelJS.Worksheet, headerName: string): number {
  const headerRow = sheet.getRow(1);
  let found = 1;
  headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    if (cell.text.trim() === headerName) found = colNumber;
  });
  return found;
}

/**
 * Load an ExcelJS Workbook from a file path or Buffer.
 */
export async function loadWorkbook(source: string | Buffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  if (typeof source === 'string') {
    await workbook.xlsx.readFile(source);
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await workbook.xlsx.load(source as any);
  }
  return workbook;
}
