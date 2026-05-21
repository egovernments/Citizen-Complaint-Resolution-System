// Excel Parsing Utilities
import * as XLSX from 'xlsx';
import type {
  TenantExcelRow,
  BoundaryExcelRow,
  DepartmentExcelRow,
  DesignationExcelRow,
  ComplaintTypeExcelRow,
  EmployeeExcelRow,
  ValidationResult,
  ValidationError,
  ValidationWarning,
} from '@/api/types';

// ============================================
// Generic Excel Parser
// ============================================

interface SheetData<T> {
  sheetName: string;
  rows: T[];
  headers: string[];
}

export function parseExcelFile(file: File): Promise<XLSX.WorkBook> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        resolve(workbook);
      } catch (error) {
        reject(new Error('Failed to parse Excel file'));
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsArrayBuffer(file);
  });
}

export function getSheetNames(workbook: XLSX.WorkBook): string[] {
  return workbook.SheetNames;
}

export function parseSheet<T>(
  workbook: XLSX.WorkBook,
  sheetName: string,
  headerRowIndex: number = 0
): SheetData<T> {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    throw new Error(`Sheet "${sheetName}" not found`);
  }

  const jsonData = XLSX.utils.sheet_to_json<T>(sheet, {
    header: headerRowIndex,
    defval: '',
  });

  // Get headers from first row
  const headers = jsonData.length > 0 ? Object.keys(jsonData[0] as object) : [];

  return {
    sheetName,
    rows: jsonData,
    headers,
  };
}

// ============================================
// Tenant Excel Parser
// ============================================

interface TenantBrandingData {
  tenant: TenantExcelRow;
  branding: {
    bannerUrl?: string;
    logoUrl?: string;
    logoUrlWhite?: string;
    stateLogo?: string;
  };
}

export function parseTenantExcel(workbook: XLSX.WorkBook): {
  data: TenantBrandingData | null;
  validation: ValidationResult;
} {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  // Try to find the Tenant sheet
  const tenantSheetNames = ['Tenant Info', 'Tenant', 'TenantMaster', 'Tenant Master', 'tenants'];
  let tenantSheet: XLSX.WorkSheet | undefined;
  let tenantSheetName = '';

  for (const name of tenantSheetNames) {
    if (workbook.Sheets[name]) {
      tenantSheet = workbook.Sheets[name];
      tenantSheetName = name;
      break;
    }
  }

  // If no specific tenant sheet, use first sheet
  if (!tenantSheet) {
    tenantSheetName = workbook.SheetNames[0];
    tenantSheet = workbook.Sheets[tenantSheetName];
  }

  if (!tenantSheet) {
    errors.push({
      field: 'file',
      message: 'No valid sheet found in Excel file',
      code: 'NO_SHEET',
    });
    return { data: null, validation: { valid: false, errors, warnings } };
  }

  const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(tenantSheet);

  if (jsonData.length === 0) {
    errors.push({
      field: 'file',
      message: 'Excel sheet is empty',
      code: 'EMPTY_SHEET',
    });
    return { data: null, validation: { valid: false, errors, warnings } };
  }

  // Parse first row as tenant data (expecting single tenant per file)
  const row = jsonData[0];

  // Helper function to find value by checking multiple possible column names
  const getValue = (row: Record<string, unknown>, ...keys: string[]): string => {
    for (const key of keys) {
      // Check exact match first
      if (row[key] !== undefined && row[key] !== null && row[key] !== '') {
        return String(row[key]).trim();
      }
      // Check case-insensitive and partial matches
      for (const [rowKey, value] of Object.entries(row)) {
        const normalizedRowKey = rowKey.toLowerCase().replace(/[*\n\r]/g, '').replace(/\s+/g, ' ').trim();
        const normalizedKey = key.toLowerCase().replace(/[*\n\r]/g, '').replace(/\s+/g, ' ').trim();
        if (normalizedRowKey === normalizedKey || normalizedRowKey.includes(normalizedKey)) {
          if (value !== undefined && value !== null && value !== '') {
            return String(value).trim();
          }
        }
      }
    }
    return '';
  };

  // Map column names (handle various naming conventions including template format)
  const tenantCode = getValue(row,
    'tenantCode', 'TenantCode', 'Tenant Code', 'tenant_code',
    'Tenant Code*', 'tenant code (to be filled by admin)'
  );
  const tenantName = getValue(row,
    'tenantName', 'TenantName', 'Tenant Name', 'tenant_name',
    'displayName', 'DisplayName', 'Display Name',
    'Tenant Display Name*', 'Tenant Display Name'
  );
  const displayName = getValue(row,
    'displayName', 'DisplayName', 'Display Name',
    'Tenant Display Name*', 'Tenant Display Name'
  ) || tenantName;
  const tenantType = getValue(row,
    'tenantType', 'TenantType', 'Tenant Type', 'Tenant Type*', 'type'
  ) || 'ULB';
  const cityName = getValue(row,
    'cityName', 'CityName', 'City Name', 'city'
  );
  const districtName = getValue(row,
    'districtName', 'DistrictName', 'District Name', 'district'
  );
  const logoPath = getValue(row,
    'logoPath', 'LogoPath', 'Logo Path', 'Logo File Path*', 'Logo File Path'
  );

  // Parse coordinates. `parseFloat(...) || undefined` coerces a legit
  // 0 (Greenwich Meridian / Equator) to undefined — use NaN-check
  // instead so 0.0 round-trips.
  const latitudeStr = getValue(row, 'latitude', 'Latitude');
  const longitudeStr = getValue(row, 'longitude', 'Longitude');
  const latNum = latitudeStr ? parseFloat(latitudeStr) : NaN;
  const lngNum = longitudeStr ? parseFloat(longitudeStr) : NaN;
  const latitude = Number.isFinite(latNum) ? latNum : undefined;
  const longitude = Number.isFinite(lngNum) ? lngNum : undefined;

  // Validate required fields
  if (!tenantCode) {
    errors.push({
      row: 1,
      field: 'tenantCode',
      message: 'Tenant code is required',
      code: 'REQUIRED_FIELD',
    });
  } else if (!/^[A-Za-z][A-Za-z0-9.]*$/.test(tenantCode)) {
    errors.push({
      row: 1,
      field: 'tenantCode',
      value: tenantCode,
      message: 'Tenant code must start with a letter and contain only letters, numbers, and dots',
      code: 'INVALID_FORMAT',
    });
  }

  if (!tenantName) {
    errors.push({
      row: 1,
      field: 'tenantName',
      message: 'Tenant name is required',
      code: 'REQUIRED_FIELD',
    });
  }

  // Warnings for optional but recommended fields
  if (!cityName) {
    warnings.push({
      row: 1,
      field: 'cityName',
      message: 'City name is recommended for proper display',
    });
  }

  if (!districtName) {
    warnings.push({
      row: 1,
      field: 'districtName',
      message: 'District name is recommended',
    });
  }

  // Try to parse branding from a separate sheet or same sheet
  const brandingSheetNames = ['Tenant Branding Details', 'Branding', 'BrandingMaster', 'branding'];
  let branding: TenantBrandingData['branding'] = {};

  for (const name of brandingSheetNames) {
    if (workbook.Sheets[name]) {
      const brandingData = XLSX.utils.sheet_to_json<Record<string, string>>(workbook.Sheets[name]);
      if (brandingData.length > 0) {
        const bRow = brandingData[0];
        // Helper for branding sheet (reuse same pattern)
        const getBrandingValue = (...keys: string[]): string | undefined => {
          for (const key of keys) {
            if (bRow[key]) return String(bRow[key]).trim();
            for (const [rowKey, value] of Object.entries(bRow)) {
              const normalizedRowKey = rowKey.toLowerCase().replace(/[*\n\r]/g, '').replace(/\s+/g, ' ').trim();
              const normalizedKey = key.toLowerCase().replace(/[*\n\r]/g, '').replace(/\s+/g, ' ').trim();
              if (normalizedRowKey === normalizedKey || normalizedRowKey.includes(normalizedKey)) {
                if (value) return String(value).trim();
              }
            }
          }
          return undefined;
        };
        branding = {
          bannerUrl: getBrandingValue('bannerUrl', 'BannerUrl', 'Banner URL'),
          logoUrl: getBrandingValue('logoUrl', 'LogoUrl', 'Logo URL'),
          logoUrlWhite: getBrandingValue('logoUrlWhite', 'LogoUrlWhite', 'Logo White', 'Logo URL (White)', 'Logo URL White'),
          stateLogo: getBrandingValue('stateLogo', 'StateLogo', 'State Logo'),
        };
        break;
      }
    }
  }

  // If no branding sheet, check main tenant sheet for branding columns
  if (!branding.logoUrl) {
    branding = {
      bannerUrl: getValue(row, 'bannerUrl', 'BannerUrl', 'Banner URL') || undefined,
      logoUrl: getValue(row, 'logoUrl', 'LogoUrl', 'Logo URL') || logoPath || undefined,
      logoUrlWhite: getValue(row, 'logoUrlWhite', 'LogoUrlWhite', 'Logo URL (White)', 'Logo URL White') || undefined,
      stateLogo: getValue(row, 'stateLogo', 'StateLogo', 'State Logo') || undefined,
    };
  }

  const tenant: TenantExcelRow = {
    tenantCode,
    tenantName,
    displayName,
    tenantType,
    cityName: cityName || undefined,
    districtName: districtName || undefined,
    latitude,
    longitude,
    logoPath: logoPath || undefined,
  };

  return {
    data: errors.length === 0 ? { tenant, branding } : null,
    validation: {
      valid: errors.length === 0,
      errors,
      warnings,
    },
  };
}

// ============================================
// Boundary Excel Parser
// ============================================

export function parseBoundaryExcel(workbook: XLSX.WorkBook): {
  data: BoundaryExcelRow[];
  hierarchyLevels: string[];
  validation: ValidationResult;
} {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];
  const boundaries: BoundaryExcelRow[] = [];
  const hierarchyLevels: string[] = [];

  // Try to find boundary sheet
  const sheetNames = ['Boundary', 'Boundaries', 'BoundaryMaster', 'boundary'];
  let sheet: XLSX.WorkSheet | undefined;

  for (const name of sheetNames) {
    if (workbook.Sheets[name]) {
      sheet = workbook.Sheets[name];
      break;
    }
  }

  if (!sheet) {
    errors.push({
      field: 'file',
      message: `No boundary sheet found. Expected one of: ${sheetNames.join(', ')}. Got sheets in this file: ${workbook.SheetNames.join(', ')}.`,
      code: 'WRONG_SHEET',
    });
    return { data: [], hierarchyLevels: [], validation: { valid: false, errors, warnings } };
  }

  const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);

  // Track seen boundary types for hierarchy
  const seenTypes = new Set<string>();

  jsonData.forEach((row, index) => {
    const code = String(row['code'] || row['Code'] || row['boundaryCode'] || '').trim();
    const name = String(row['name'] || row['Name'] || row['boundaryName'] || '').trim();
    const boundaryType = String(row['boundaryType'] || row['BoundaryType'] || row['type'] || '').trim();
    const parentCode = String(row['parentCode'] || row['ParentCode'] || row['parent'] || '').trim() || undefined;

    // Parse coordinates — keep 0.0 as a legit value (Equator / Greenwich).
    const latRaw = row['latitude'] ?? row['Latitude'];
    const lngRaw = row['longitude'] ?? row['Longitude'];
    const latNum = latRaw == null || latRaw === '' ? NaN : parseFloat(String(latRaw));
    const lngNum = lngRaw == null || lngRaw === '' ? NaN : parseFloat(String(lngRaw));
    const latitude = Number.isFinite(latNum) ? latNum : undefined;
    const longitude = Number.isFinite(lngNum) ? lngNum : undefined;

    if (!code) {
      errors.push({
        row: index + 2,
        field: 'code',
        message: 'Boundary code is required',
        code: 'REQUIRED_FIELD',
      });
      return;
    }

    if (!name) {
      errors.push({
        row: index + 2,
        field: 'name',
        message: 'Boundary name is required',
        code: 'REQUIRED_FIELD',
      });
      return;
    }

    if (!boundaryType) {
      errors.push({
        row: index + 2,
        field: 'boundaryType',
        message: 'Boundary type is required',
        code: 'REQUIRED_FIELD',
      });
      return;
    }

    // Track hierarchy levels in order of appearance
    if (!seenTypes.has(boundaryType)) {
      seenTypes.add(boundaryType);
      hierarchyLevels.push(boundaryType);
    }

    boundaries.push({
      code,
      name,
      boundaryType,
      parentCode,
      latitude,
      longitude,
    });
  });

  return {
    data: boundaries,
    hierarchyLevels,
    validation: {
      valid: errors.length === 0,
      errors,
      warnings,
    },
  };
}

// ============================================
// Department Excel Parser
// ============================================

export function parseDepartmentExcel(workbook: XLSX.WorkBook): {
  data: DepartmentExcelRow[];
  validation: ValidationResult;
} {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];
  const departments: DepartmentExcelRow[] = [];

  const sheetNames = ['Department', 'Departments', 'DepartmentMaster', 'department'];
  let sheet: XLSX.WorkSheet | undefined;

  for (const name of sheetNames) {
    if (workbook.Sheets[name]) {
      sheet = workbook.Sheets[name];
      break;
    }
  }

  if (!sheet) {
    errors.push({
      field: 'file',
      message: `No department sheet found. Expected one of: Department, Departments, DepartmentMaster, department. Got sheets in this file: ${workbook.SheetNames.join(', ')}.`,
      code: 'WRONG_SHEET',
    });
    return { data: [], validation: { valid: false, errors, warnings } };
  }

  const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);

  jsonData.forEach((row, index) => {
    const code = String(row['code'] || row['Code'] || row['departmentCode'] || '').trim();
    const name = String(row['name'] || row['Name'] || row['departmentName'] || '').trim();
    // Use ?? not || — when LibreOffice / Google Sheets renders a `FALSE`
    // cell as the JS boolean `false`, `||` treats it as falsy and falls
    // through to the default `'true'`, flipping every deactivated row to
    // active. ?? only short-circuits on null/undefined (closes
    // egovernments/CCRS#472 — bulk-import boolean parsing).
    const rawActive = row['active'] ?? row['Active'] ?? row['isActive'] ?? 'true';
    const activeStr = String(rawActive).trim().toLowerCase();
    const active = activeStr === 'true' || activeStr === 'yes' || activeStr === '1';

    if (!code) {
      errors.push({
        row: index + 2,
        field: 'code',
        message: 'Department code is required',
        code: 'REQUIRED_FIELD',
      });
      return;
    }

    if (!name) {
      errors.push({
        row: index + 2,
        field: 'name',
        message: 'Department name is required',
        code: 'REQUIRED_FIELD',
      });
      return;
    }

    departments.push({ code, name, active });
  });

  return {
    data: departments,
    validation: {
      valid: errors.length === 0,
      errors,
      warnings,
    },
  };
}

// ============================================
// Designation Excel Parser
// ============================================

export function parseDesignationExcel(workbook: XLSX.WorkBook): {
  data: DesignationExcelRow[];
  validation: ValidationResult;
} {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];
  const designations: DesignationExcelRow[] = [];

  const sheetNames = ['Designation', 'Designations', 'DesignationMaster', 'designation'];
  let sheet: XLSX.WorkSheet | undefined;

  for (const name of sheetNames) {
    if (workbook.Sheets[name]) {
      sheet = workbook.Sheets[name];
      break;
    }
  }

  if (!sheet) {
    errors.push({
      field: 'file',
      message: `No designation sheet found. Expected one of: Designation, Designations, DesignationMaster, designation. Got sheets in this file: ${workbook.SheetNames.join(', ')}.`,
      code: 'WRONG_SHEET',
    });
    return { data: [], validation: { valid: false, errors, warnings } };
  }

  const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);

  jsonData.forEach((row, index) => {
    const code = String(row['code'] || row['Code'] || row['designationCode'] || '').trim();
    const name = String(row['name'] || row['Name'] || row['designationName'] || '').trim();
    const description = String(row['description'] || row['Description'] || '').trim() || name;
    const deptRaw = String(row['department'] || row['Department'] || '').trim();
    const department = deptRaw ? deptRaw.split(',').map(s => s.trim()).filter(Boolean) : undefined;
    // Use ?? — see Department parser note for the FALSE-coalescing bug.
    const rawActive = row['active'] ?? row['Active'] ?? row['isActive'] ?? 'true';
    const activeStr = String(rawActive).trim().toLowerCase();
    const active = activeStr === 'true' || activeStr === 'yes' || activeStr === '1';

    if (!code) {
      errors.push({
        row: index + 2,
        field: 'code',
        message: 'Designation code is required',
        code: 'REQUIRED_FIELD',
      });
      return;
    }

    if (!name) {
      errors.push({
        row: index + 2,
        field: 'name',
        message: 'Designation name is required',
        code: 'REQUIRED_FIELD',
      });
      return;
    }

    designations.push({ code, name, description, department, active });
  });

  return {
    data: designations,
    validation: {
      valid: errors.length === 0,
      errors,
      warnings,
    },
  };
}

// ============================================
// Complaint Type Excel Parser
// ============================================

export function parseComplaintTypeExcel(workbook: XLSX.WorkBook): {
  data: ComplaintTypeExcelRow[];
  validation: ValidationResult;
} {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];
  const complaintTypes: ComplaintTypeExcelRow[] = [];

  const sheetNames = ['ComplaintType', 'ComplaintTypes', 'ServiceDefs', 'servicedefs', 'PGR'];
  let sheet: XLSX.WorkSheet | undefined;

  for (const name of sheetNames) {
    if (workbook.Sheets[name]) {
      sheet = workbook.Sheets[name];
      break;
    }
  }

  if (!sheet) {
    errors.push({
      field: 'file',
      message: `No complainttype sheet found. Expected one of: ComplaintType, ComplaintTypes, ServiceDefs, servicedefs, PGR. Got sheets in this file: ${workbook.SheetNames.join(', ')}.`,
      code: 'WRONG_SHEET',
    });
    return { data: [], validation: { valid: false, errors, warnings } };
  }

  const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);

  jsonData.forEach((row, index) => {
    const serviceCode = String(row['serviceCode'] || row['ServiceCode'] || row['code'] || '').trim();
    const name = String(row['name'] || row['Name'] || row['serviceName'] || row['ServiceName'] || '').trim();
    const keywordsRaw = String(row['keywords'] || row['Keywords'] || '').trim();
    const keywords = keywordsRaw || name.toLowerCase().replace(/\s+/g, ',');
    const department = String(row['department'] || row['Department'] || '').trim();
    const slaHours = parseInt(String(row['slaHours'] || row['SlaHours'] || row['sla'] || '24'), 10) || 24;
    // Use ?? — see Department parser note for the FALSE-coalescing bug.
    const rawActive = row['active'] ?? row['Active'] ?? row['isActive'] ?? 'true';
    const activeStr = String(rawActive).trim().toLowerCase();
    const active = activeStr === 'true' || activeStr === 'yes' || activeStr === '1';

    if (!serviceCode) {
      errors.push({
        row: index + 2,
        field: 'serviceCode',
        message: 'Service code is required',
        code: 'REQUIRED_FIELD',
      });
      return;
    }

    if (!name) {
      errors.push({
        row: index + 2,
        field: 'name',
        message: 'Service name is required',
        code: 'REQUIRED_FIELD',
      });
      return;
    }

    if (!department) {
      errors.push({
        row: index + 2,
        field: 'department',
        message: 'Department is required',
        code: 'REQUIRED_FIELD',
      });
      return;
    }

    complaintTypes.push({ serviceCode, name, keywords, department, slaHours, active });
  });

  return {
    data: complaintTypes,
    validation: {
      valid: errors.length === 0,
      errors,
      warnings,
    },
  };
}

// ============================================
// Employee Excel Parser
// ============================================

export function parseEmployeeExcel(workbook: XLSX.WorkBook): {
  data: EmployeeExcelRow[];
  validation: ValidationResult;
} {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];
  const employees: EmployeeExcelRow[] = [];

  const sheetNames = ['Employee', 'Employees', 'EmployeeMaster', 'HRMS', 'employee'];
  let sheet: XLSX.WorkSheet | undefined;

  for (const name of sheetNames) {
    if (workbook.Sheets[name]) {
      sheet = workbook.Sheets[name];
      break;
    }
  }

  if (!sheet) {
    errors.push({
      field: 'file',
      message: `No employee sheet found. Expected one of: Employee, Employees, EmployeeMaster, HRMS, employee. Got sheets in this file: ${workbook.SheetNames.join(', ')}.`,
      code: 'WRONG_SHEET',
    });
    return { data: [], validation: { valid: false, errors, warnings } };
  }

  const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);

  jsonData.forEach((row, index) => {
    const employeeCode = String(row['employeeCode'] || row['EmployeeCode'] || row['code'] || '').trim();
    const name = String(row['name'] || row['Name'] || row['employeeName'] || '').trim();
    const userName = String(row['userName'] || row['UserName'] || row['username'] || '').trim();
    const mobileNumber = String(row['mobileNumber'] || row['MobileNumber'] || row['mobile'] || row['phone'] || '').trim();
    const emailId = String(row['emailId'] || row['EmailId'] || row['email'] || '').trim() || undefined;
    const gender = String(row['gender'] || row['Gender'] || '').trim() || undefined;
    const dobRaw = row['dob'] ?? row['DOB'] ?? row['dateOfBirth'];
    const department = String(row['department'] || row['Department'] || '').trim();
    const designation = String(row['designation'] || row['Designation'] || '').trim();
    const roles = String(row['roles'] || row['Roles'] || row['role'] || 'EMPLOYEE').trim();
    const jurisdictions = String(row['jurisdictions'] || row['Jurisdictions'] || row['boundary'] || '').trim();
    const dateOfAppointment = String(row['dateOfAppointment'] || row['DateOfAppointment'] || row['doa'] || '').trim() || undefined;

    if (!employeeCode) {
      errors.push({
        row: index + 2,
        field: 'employeeCode',
        message: 'Employee code is required',
        code: 'REQUIRED_FIELD',
      });
      return;
    }

    if (!name) {
      errors.push({
        row: index + 2,
        field: 'name',
        message: 'Employee name is required',
        code: 'REQUIRED_FIELD',
      });
      return;
    }

    // userName is optional at parse time — callers (Phase 4, bulk import) derive
    // `firstname.lastname` from `name` when the Excel cell is blank. Keeping it
    // required here forced operators to duplicate the name column unnecessarily.

    if (!mobileNumber) {
      errors.push({
        row: index + 2,
        field: 'mobileNumber',
        message: 'Mobile number is required',
        code: 'REQUIRED_FIELD',
      });
      return;
    } else if (!/^\d{10}$/.test(mobileNumber)) {
      errors.push({
        row: index + 2,
        field: 'mobileNumber',
        value: mobileNumber,
        message: 'Mobile number must be 10 digits',
        code: 'INVALID_FORMAT',
      });
    }

    if (!department) {
      errors.push({
        row: index + 2,
        field: 'department',
        message: 'Department is required',
        code: 'REQUIRED_FIELD',
      });
      return;
    }

    if (!designation) {
      errors.push({
        row: index + 2,
        field: 'designation',
        message: 'Designation is required',
        code: 'REQUIRED_FIELD',
      });
      return;
    }

    if (dobRaw === undefined || dobRaw === null || dobRaw === '') {
      errors.push({
        row: index + 2,
        field: 'dob',
        message: 'Date of birth is required (YYYY-MM-DD)',
        code: 'REQUIRED_FIELD',
      });
      return;
    }

    let dobYear: number;
    let dobMonth: number;
    let dobDay: number;

    if (dobRaw instanceof Date) {
      dobYear = dobRaw.getUTCFullYear();
      dobMonth = dobRaw.getUTCMonth() + 1;
      dobDay = dobRaw.getUTCDate();
    } else if (typeof dobRaw === 'number') {
      // Excel epoch adjustment to JS epoch ms: (serial - 25569) * 86400 * 1000.
      const jsDate = new Date((dobRaw - 25569) * 86400 * 1000);
      if (Number.isNaN(jsDate.getTime())) {
        errors.push({
          row: index + 2,
          field: 'dob',
          value: String(dobRaw),
          message: 'Date of birth is not a valid Excel date serial',
          code: 'INVALID_FORMAT',
        });
        return;
      }
      dobYear = jsDate.getUTCFullYear();
      dobMonth = jsDate.getUTCMonth() + 1;
      dobDay = jsDate.getUTCDate();
    } else {
      const dobStr = String(dobRaw).trim();
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dobStr);
      if (!match) {
        errors.push({
          row: index + 2,
          field: 'dob',
          value: dobStr,
          message: 'Date of birth must be ISO format YYYY-MM-DD',
          code: 'INVALID_FORMAT',
        });
        return;
      }
      dobYear = Number(match[1]);
      dobMonth = Number(match[2]);
      dobDay = Number(match[3]);
    }

    const maxYear = new Date().getFullYear() - 18;
    if (dobYear < 1920 || dobYear > maxYear) {
      errors.push({
        row: index + 2,
        field: 'dob',
        value: `${dobYear}-${String(dobMonth).padStart(2, '0')}-${String(dobDay).padStart(2, '0')}`,
        message: `Date of birth year must be between 1920 and ${maxYear} (employee must be at least 18)`,
        code: 'INVALID_FORMAT',
      });
      return;
    }

    const dob = `${dobYear}-${String(dobMonth).padStart(2, '0')}-${String(dobDay).padStart(2, '0')}`;

    if (!jurisdictions) {
      warnings.push({
        row: index + 2,
        field: 'jurisdictions',
        message: 'No jurisdictions specified - employee may not have access to any areas',
      });
    }

    employees.push({
      employeeCode,
      name,
      userName,
      mobileNumber,
      emailId,
      gender,
      dob,
      department,
      designation,
      roles,
      jurisdictions,
      dateOfAppointment,
    });
  });

  return {
    data: employees,
    validation: {
      valid: errors.length === 0,
      errors,
      warnings,
    },
  };
}
