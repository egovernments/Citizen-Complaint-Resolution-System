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
  const tenantSheetNames = ['Tenant', 'TenantMaster', 'Tenant Master', 'tenants'];
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

  // Map column names (handle various naming conventions)
  const tenantCode = String(
    row['tenantCode'] || row['TenantCode'] || row['Tenant Code'] || row['tenant_code'] || ''
  ).trim();
  const tenantName = String(
    row['tenantName'] || row['TenantName'] || row['Tenant Name'] || row['tenant_name'] ||
    row['displayName'] || row['DisplayName'] || row['Display Name'] || ''
  ).trim();
  const displayName = String(
    row['displayName'] || row['DisplayName'] || row['Display Name'] || tenantName || ''
  ).trim();
  const tenantType = String(
    row['tenantType'] || row['TenantType'] || row['Tenant Type'] || row['type'] || 'ULB'
  ).trim();
  const cityName = String(
    row['cityName'] || row['CityName'] || row['City Name'] || row['city'] || ''
  ).trim();
  const districtName = String(
    row['districtName'] || row['DistrictName'] || row['District Name'] || row['district'] || ''
  ).trim();
  const logoPath = String(row['logoPath'] || row['LogoPath'] || row['Logo Path'] || '').trim();

  // Parse coordinates
  const latitude = parseFloat(String(row['latitude'] || row['Latitude'] || '0')) || undefined;
  const longitude = parseFloat(String(row['longitude'] || row['Longitude'] || '0')) || undefined;

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
  const brandingSheetNames = ['Branding', 'BrandingMaster', 'branding'];
  let branding: TenantBrandingData['branding'] = {};

  for (const name of brandingSheetNames) {
    if (workbook.Sheets[name]) {
      const brandingData = XLSX.utils.sheet_to_json<Record<string, string>>(workbook.Sheets[name]);
      if (brandingData.length > 0) {
        const bRow = brandingData[0];
        branding = {
          bannerUrl: bRow['bannerUrl'] || bRow['BannerUrl'] || bRow['Banner URL'],
          logoUrl: bRow['logoUrl'] || bRow['LogoUrl'] || bRow['Logo URL'],
          logoUrlWhite: bRow['logoUrlWhite'] || bRow['LogoUrlWhite'] || bRow['Logo White'],
          stateLogo: bRow['stateLogo'] || bRow['StateLogo'] || bRow['State Logo'],
        };
        break;
      }
    }
  }

  // If no branding sheet, check main tenant sheet for branding columns
  if (!branding.logoUrl) {
    branding = {
      bannerUrl: String(row['bannerUrl'] || row['BannerUrl'] || '').trim() || undefined,
      logoUrl: String(row['logoUrl'] || row['LogoUrl'] || logoPath || '').trim() || undefined,
      logoUrlWhite: String(row['logoUrlWhite'] || row['LogoUrlWhite'] || '').trim() || undefined,
      stateLogo: String(row['stateLogo'] || row['StateLogo'] || '').trim() || undefined,
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
    sheet = workbook.Sheets[workbook.SheetNames[0]];
  }

  if (!sheet) {
    errors.push({
      field: 'file',
      message: 'No valid boundary sheet found',
      code: 'NO_SHEET',
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

    // Parse coordinates
    const latitude = parseFloat(String(row['latitude'] || row['Latitude'] || '0')) || undefined;
    const longitude = parseFloat(String(row['longitude'] || row['Longitude'] || '0')) || undefined;

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
    sheet = workbook.Sheets[workbook.SheetNames[0]];
  }

  if (!sheet) {
    errors.push({
      field: 'file',
      message: 'No valid department sheet found',
      code: 'NO_SHEET',
    });
    return { data: [], validation: { valid: false, errors, warnings } };
  }

  const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);

  jsonData.forEach((row, index) => {
    const code = String(row['code'] || row['Code'] || row['departmentCode'] || '').trim();
    const name = String(row['name'] || row['Name'] || row['departmentName'] || '').trim();
    const activeStr = String(row['active'] || row['Active'] || row['isActive'] || 'true').trim().toLowerCase();
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
    sheet = workbook.Sheets[workbook.SheetNames[0]];
  }

  if (!sheet) {
    errors.push({
      field: 'file',
      message: 'No valid designation sheet found',
      code: 'NO_SHEET',
    });
    return { data: [], validation: { valid: false, errors, warnings } };
  }

  const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);

  jsonData.forEach((row, index) => {
    const code = String(row['code'] || row['Code'] || row['designationCode'] || '').trim();
    const name = String(row['name'] || row['Name'] || row['designationName'] || '').trim();
    const department = String(row['department'] || row['Department'] || '').trim() || undefined;
    const activeStr = String(row['active'] || row['Active'] || row['isActive'] || 'true').trim().toLowerCase();
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

    designations.push({ code, name, department, active });
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
    sheet = workbook.Sheets[workbook.SheetNames[0]];
  }

  if (!sheet) {
    errors.push({
      field: 'file',
      message: 'No valid complaint type sheet found',
      code: 'NO_SHEET',
    });
    return { data: [], validation: { valid: false, errors, warnings } };
  }

  const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);

  jsonData.forEach((row, index) => {
    const serviceCode = String(row['serviceCode'] || row['ServiceCode'] || row['code'] || '').trim();
    const serviceName = String(row['serviceName'] || row['ServiceName'] || row['name'] || '').trim();
    const department = String(row['department'] || row['Department'] || '').trim();
    const slaHours = parseInt(String(row['slaHours'] || row['SlaHours'] || row['sla'] || '24'), 10) || 24;
    const activeStr = String(row['active'] || row['Active'] || row['isActive'] || 'true').trim().toLowerCase();
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

    if (!serviceName) {
      errors.push({
        row: index + 2,
        field: 'serviceName',
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

    complaintTypes.push({ serviceCode, serviceName, department, slaHours, active });
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
    sheet = workbook.Sheets[workbook.SheetNames[0]];
  }

  if (!sheet) {
    errors.push({
      field: 'file',
      message: 'No valid employee sheet found',
      code: 'NO_SHEET',
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

    if (!userName) {
      errors.push({
        row: index + 2,
        field: 'userName',
        message: 'Username is required',
        code: 'REQUIRED_FIELD',
      });
      return;
    }

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
