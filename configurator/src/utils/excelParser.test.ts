import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import {
  parseDepartmentExcel,
  parseDesignationExcel,
  parseComplaintTypeExcel,
  parseBoundaryExcel,
  parseTenantExcel,
  parseEmployeeExcel,
} from './excelParser';

// LibreOffice / Google Sheets convert TRUE / FALSE cells to JS booleans
// when xlsx parses them. Before the ?? fix the parser used `||` for the
// fallback chain, so any boolean `false` was treated as falsy and
// silently flipped to the default `'true'` — every deactivated row in
// a bulk import came back active (closes egovernments/CCRS#472).
function makeWorkbook(sheetName: string, rows: Record<string, unknown>[]): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return wb;
}

describe('Excel boolean coalescing (active column)', () => {
  it('Department: native JS false stays false', () => {
    const wb = makeWorkbook('Department', [
      { code: 'DEPT_A', name: 'Active One', active: true },
      { code: 'DEPT_B', name: 'Inactive One', active: false },
    ]);
    const { data, validation } = parseDepartmentExcel(wb);
    expect(validation.errors).toEqual([]);
    expect(data).toEqual([
      { code: 'DEPT_A', name: 'Active One', active: true },
      { code: 'DEPT_B', name: 'Inactive One', active: false },
    ]);
  });

  it('Department: missing active column defaults to true', () => {
    const wb = makeWorkbook('Department', [{ code: 'DEPT_A', name: 'Default Active' }]);
    const { data } = parseDepartmentExcel(wb);
    expect(data[0]?.active).toBe(true);
  });

  it('Department: stringified false (with single quote / TRUE / FALSE) parses correctly', () => {
    const wb = makeWorkbook('Department', [
      { code: 'DEPT_A', name: 'Quoted False', active: 'false' },
      { code: 'DEPT_B', name: 'Upper FALSE', active: 'FALSE' },
      { code: 'DEPT_C', name: 'Upper TRUE', active: 'TRUE' },
    ]);
    const { data } = parseDepartmentExcel(wb);
    expect(data.map((r) => r.active)).toEqual([false, false, true]);
  });

  it('Designation: boolean false survives coalescing', () => {
    const wb = makeWorkbook('Designation', [
      { code: 'DSG_A', name: 'Officer', description: 'desc', department: 'DEPT_1', active: false },
    ]);
    const { data } = parseDesignationExcel(wb);
    expect(data[0]?.active).toBe(false);
  });

  it('ComplaintType: boolean false survives coalescing', () => {
    const wb = makeWorkbook('ComplaintType', [
      { serviceCode: 'POTHOLE', name: 'Pothole', department: 'DEPT_1', slaHours: 24, active: false },
    ]);
    const { data } = parseComplaintTypeExcel(wb);
    expect(data[0]?.active).toBe(false);
  });
});

describe('Boundary coordinate parsing', () => {
  it('keeps 0.0 latitude / longitude as 0 (not undefined)', () => {
    // `parseFloat(...) || undefined` would coerce a legitimate 0 to
    // undefined — the Equator + Greenwich Meridian edge. Use NaN-check.
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet([
      { code: 'EQ_GP', name: 'Equator + Greenwich', boundaryType: 'Ward', latitude: 0, longitude: 0 },
      { code: 'NA', name: 'No coords', boundaryType: 'Ward' },
    ]);
    XLSX.utils.book_append_sheet(wb, ws, 'Boundary');
    const { data } = parseBoundaryExcel(wb);
    const eq = data.find((r) => r.code === 'EQ_GP');
    const na = data.find((r) => r.code === 'NA');
    expect(eq?.latitude).toBe(0);
    expect(eq?.longitude).toBe(0);
    expect(na?.latitude).toBeUndefined();
    expect(na?.longitude).toBeUndefined();
  });
});

describe('Tenant code validation (egovernments/CCRS#1847)', () => {
  // egov-user enforces `Pattern.createUserRequest.user.tenantId` =
  // `^[a-zA-Z. ]*$` server-side (letters, dots, spaces — no digits). A
  // tenant code that violates this passes tenant creation in Phase 1 but
  // breaks employee creation in Phase 4, so the Excel parser must reject
  // it up front at upload time.
  it('rejects an alphanumeric tenant code', () => {
    const wb = makeWorkbook('Tenant Info', [
      { tenantCode: 'testcity001', tenantName: 'Test City' },
    ]);
    const { data, validation } = parseTenantExcel(wb);
    expect(validation.valid).toBe(false);
    expect(validation.errors).toContainEqual(
      expect.objectContaining({ field: 'tenantCode', code: 'INVALID_FORMAT' })
    );
    expect(data).toBeNull();
  });

  it('accepts a letters-only tenant code', () => {
    const wb = makeWorkbook('Tenant Info', [
      { tenantCode: 'testcity', tenantName: 'Test City' },
    ]);
    const { data, validation } = parseTenantExcel(wb);
    expect(validation.errors).toEqual([]);
    expect(data?.tenant.tenantCode).toBe('testcity');
  });

  it('accepts letters with dots and spaces (e.g. sub-tenant codes)', () => {
    const wb = makeWorkbook('Tenant Info', [
      { tenantCode: 'ke.testcity', tenantName: 'Test City' },
    ]);
    const { validation } = parseTenantExcel(wb);
    expect(validation.errors).toEqual([]);
  });
});

describe('Employee dob is optional (egovernments/CCRS#1949)', () => {
  // The Employee EDIT screen has always let an operator clear Date of Birth and
  // save, and egov-hrms guards every DOB rule with a null check. The bulk /
  // Phase-4 import paths used to disagree: a blank `dob` cell dropped the whole
  // row with a REQUIRED_FIELD error.
  const baseRow = {
    employeeCode: 'EMP_001',
    name: 'Jane Kamau',
    mobileNumber: '712345678',
    department: 'DEPT_07',
    designation: 'DESIG_1004',
    roles: 'PGR_LME',
    jurisdictions: 'NAIROBI_CITY_VIWANDANI',
  };

  it('imports a row with no dob column at all', () => {
    const { data, validation } = parseEmployeeExcel(makeWorkbook('Employee', [baseRow]));
    expect(validation.errors).toEqual([]);
    expect(validation.valid).toBe(true);
    expect(data).toHaveLength(1);
    expect(data[0].dob).toBeUndefined();
  });

  it('imports a row whose dob cell is blank or whitespace', () => {
    const { data, validation } = parseEmployeeExcel(
      makeWorkbook('Employee', [
        { ...baseRow, dob: '' },
        { ...baseRow, employeeCode: 'EMP_002', dob: '   ' },
      ])
    );
    expect(validation.errors).toEqual([]);
    expect(data.map((e) => e.dob)).toEqual([undefined, undefined]);
  });

  it('still parses a supplied dob', () => {
    const { data, validation } = parseEmployeeExcel(
      makeWorkbook('Employee', [{ ...baseRow, dob: '1990-05-14' }])
    );
    expect(validation.errors).toEqual([]);
    expect(data[0].dob).toBe('1990-05-14');
  });

  it('still rejects a malformed dob', () => {
    const { data, validation } = parseEmployeeExcel(
      makeWorkbook('Employee', [{ ...baseRow, dob: '14/05/1990' }])
    );
    expect(validation.valid).toBe(false);
    expect(validation.errors).toContainEqual(
      expect.objectContaining({ field: 'dob', code: 'INVALID_FORMAT' })
    );
    expect(data).toHaveLength(0);
  });

  it('still rejects a dob that leaves the employee under 18', () => {
    const thisYear = new Date().getFullYear();
    const { validation } = parseEmployeeExcel(
      makeWorkbook('Employee', [{ ...baseRow, dob: `${thisYear - 5}-05-14` }])
    );
    expect(validation.valid).toBe(false);
    expect(validation.errors).toContainEqual(
      expect.objectContaining({ field: 'dob', code: 'INVALID_FORMAT' })
    );
  });
});
