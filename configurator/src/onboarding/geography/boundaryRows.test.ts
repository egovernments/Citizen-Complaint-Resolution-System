import { describe, expect, it } from 'vitest';
import type { BoundaryExcelRow, BoundaryLevel } from '@/api/types';
import { checkBoundaryRows } from './boundaryRows';

// County → Ward, as Excel's "create a hierarchy" defines it.
const COUNTY_WARD: BoundaryLevel[] = [
  { boundaryType: 'County', active: true },
  { boundaryType: 'Ward', parentBoundaryType: 'County', active: true },
];

let nextRow = 2;
const row = (code: string, boundaryType: string, parentCode?: string, name = code): BoundaryExcelRow => ({
  code,
  name,
  boundaryType,
  parentCode,
  row: nextRow++,
});
const sheet = (...rows: BoundaryExcelRow[]) => {
  nextRow = 2;
  return rows.map((r) => ({ ...r, row: nextRow++ }));
};
const errorsOf = (rows: BoundaryExcelRow[], levels = COUNTY_WARD) =>
  Object.fromEntries(checkBoundaryRows(rows, levels).invalid.map(({ boundary, error }) => [boundary.code, error]));
const validCodes = (rows: BoundaryExcelRow[], levels = COUNTY_WARD) => checkBoundaryRows(rows, levels).valid.map((r) => r.code);

describe('checkBoundaryRows', () => {
  it('passes a sheet that fits the hierarchy', () => {
    const rows = sheet(row('C1', 'County'), row('W1', 'Ward', 'C1'), row('W2', 'Ward', 'C1'));
    expect(errorsOf(rows)).toEqual({});
    expect(validCodes(rows)).toEqual(['C1', 'W1', 'W2']);
  });

  it('G-9: refuses a type that is not a level, naming the row and the levels to use (#2795)', () => {
    const rows = sheet(row('C1', 'County'), row('W1', 'Village', 'C1'));
    expect(errorsOf(rows)).toEqual({ W1: 'Row 3: "Village" isn’t a level of this hierarchy. Use one of: County, Ward.' });
    expect(validCodes(rows)).toEqual(['C1']);
  });

  it('G-10: refuses a ward under a ward (#2796)', () => {
    const rows = sheet(row('C1', 'County'), row('W1', 'Ward', 'C1'), row('W2', 'Ward', 'W1'));
    expect(errorsOf(rows)).toEqual({ W2: 'Row 4: A Ward’s parent must be a County, but "W1" is a Ward.' });
  });

  it('G-10: refuses a ward with no parent: only the top level can be a root (#2796)', () => {
    const rows = sheet(row('C1', 'County'), row('W1', 'Ward'));
    expect(errorsOf(rows)).toEqual({
      W1: 'Row 3: A Ward needs a parent County in parentCode. Only the top level (County) can be left without one.',
    });
  });

  it('G-10: refuses a county under a ward (#2796)', () => {
    const rows = sheet(row('C1', 'County'), row('W1', 'Ward', 'C1'), row('C2', 'County', 'W1'));
    expect(errorsOf(rows)).toEqual({ C2: 'Row 4: County is the top level, so it can’t have a parent. Leave its parentCode empty.' });
  });

  it('refuses a parent two levels up, not only the wrong way round', () => {
    const levels: BoundaryLevel[] = [
      { boundaryType: 'County', active: true },
      { boundaryType: 'SubCounty', parentBoundaryType: 'County', active: true },
      { boundaryType: 'Ward', parentBoundaryType: 'SubCounty', active: true },
    ];
    const rows = sheet(row('C1', 'County'), row('S1', 'SubCounty', 'C1'), row('W1', 'Ward', 'C1'), row('W2', 'Ward', 'S1'));
    expect(errorsOf(rows, levels)).toEqual({ W1: 'Row 4: A Ward’s parent must be a SubCounty, but "C1" is a County.' });
  });

  it('refuses the rows under a refused row, all the way down', () => {
    const levels: BoundaryLevel[] = [
      { boundaryType: 'County', active: true },
      { boundaryType: 'SubCounty', parentBoundaryType: 'County', active: true },
      { boundaryType: 'Ward', parentBoundaryType: 'SubCounty', active: true },
    ];
    const rows = sheet(row('C1', 'County'), row('S1', 'Subcounty', 'C1'), row('W1', 'Ward', 'S1'));
    const errors = errorsOf(rows, levels);
    expect(errors.S1).toBe('Row 3: "Subcounty" isn’t a level of this hierarchy. Use one of: County, SubCounty, Ward.');
    expect(errors.W1).toBe('Row 4: Its parent "S1" has an error, so it can’t be added until that row is fixed.');
    expect(validCodes(rows, levels)).toEqual(['C1']);
  });

  it('keeps the existing checks: missing fields and a parent not in the sheet', () => {
    const rows = sheet(row('C1', 'County'), row('W1', 'Ward', 'CX'), { ...row('W2', 'Ward', 'C1'), name: '' });
    expect(errorsOf(rows)).toEqual({ W1: 'Row 3: Parent "CX" not found', W2: 'Row 4: Missing boundary name' });
  });

  it('reads the level order from parentBoundaryType, as the server lists it', () => {
    // boundary-service doesn't promise the levels in order.
    const levels: BoundaryLevel[] = [
      { boundaryType: 'Ward', parentBoundaryType: 'County', active: true },
      { boundaryType: 'County', active: true },
    ];
    const rows = sheet(row('C1', 'County'), row('W1', 'Ward', 'C1'), row('W2', 'Ward'), row('V1', 'Village', 'C1'));
    expect(errorsOf(rows, levels)).toEqual({
      W2: 'Row 4: A Ward needs a parent County in parentCode. Only the top level (County) can be left without one.',
      V1: 'Row 5: "Village" isn’t a level of this hierarchy. Use one of: County, Ward.',
    });
  });
});
