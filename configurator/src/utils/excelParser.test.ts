import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { parseDepartmentExcel, parseDesignationExcel, parseComplaintTypeExcel, parseBoundaryExcel } from './excelParser';

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
