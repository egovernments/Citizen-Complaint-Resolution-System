import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { COMPLAINT_DEPARTMENT_HEADER, parseComplaintHierarchyExcel } from './excelParser';
import { buildComplaintHierarchyTemplate } from './templateBuilder';

/**
 * The complaints sheet's department column (#2806): a department's code or name, saved as its
 * code; a blank cell or a value no department has is an error on its row, never saved as typed.
 */

const LEVELS = ['SERVICE', 'COMPLAINT_TYPE', 'SUB_TYPE'];
const DEPARTMENTS = [
  { code: 'SANIT', name: 'Sanitation Services' },
  { code: 'ROADS', name: 'Roads and Transport' },
];

function workbook(rows: Record<string, string | number>[]): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'ComplaintHierarchy');
  return wb;
}

const row = (department: string, leaf = 'Uncollected waste', header = COMPLAINT_DEPARTMENT_HEADER) => ({
  SERVICE: 'Environment',
  COMPLAINT_TYPE: 'Garbage',
  SUB_TYPE: leaf,
  [header]: department,
  'Resolution Time (Hours)*': 48,
  'Search Words*': 'trash',
});

const parse = (rows: Record<string, string | number>[], departments = DEPARTMENTS) =>
  parseComplaintHierarchyExcel(workbook(rows), 'PGR', LEVELS, { departments });

describe('the complaints sheet department column', () => {
  it('takes a department name and saves its code (C-3, C-5)', () => {
    const result = parse([row('Sanitation Services')]);
    expect(result.validation.errors).toEqual([]);
    expect(result.leaves[0]).toMatchObject({ department: 'SANIT', departments: ['SANIT'] });
  });

  it('takes a code or a name in any case, with stray spaces', () => {
    const result = parse([row('sanit', 'A'), row('  sanitation   SERVICES ', 'B'), row('Roads and Transport, SANIT, roads', 'C')]);
    expect(result.validation.errors).toEqual([]);
    expect(result.leaves.map((leaf) => leaf.departments)).toEqual([['SANIT'], ['SANIT'], ['ROADS', 'SANIT']]);
    expect(result.leaves[2].department).toBe('ROADS');
  });

  it('refuses a blank cell, naming the row, instead of saving NA (C-4)', () => {
    const result = parse([row('Sanitation Services', 'A'), row('', 'B'), row('SANIT', 'C')]);
    expect(result.validation.valid).toBe(false);
    expect(result.validation.errors).toEqual([
      expect.objectContaining({ row: 3, code: 'NO_DEPT', message: 'Row 3: no department. Every complaint type needs one.' }),
    ]);
    expect(result.validation.warnings).toEqual([]);
  });

  it('refuses a department that does not exist, naming the row, the value and the choices', () => {
    const result = parse([row('Sanitaton')]);
    expect(result.validation.valid).toBe(false);
    expect(result.validation.errors.map((e) => e.message)).toEqual([
      'Row 2: department “Sanitaton” doesn’t exist. Use one of: Sanitation Services (SANIT), Roads and Transport (ROADS).',
    ]);
    expect(result.leaves[0].department).toBe('');
  });

  it('reads a name with a comma in it as one department, and a list only when the whole cell is none', () => {
    const departments = [...DEPARTMENTS, { code: 'RBD', name: 'Roads, Bridges and Drains' }];
    const result = parse([row('Roads, Bridges and Drains', 'A'), row(' roads,  bridges and drains ', 'B'), row('RBD, SANIT', 'C')], departments);
    expect(result.validation.errors).toEqual([]);
    expect(result.leaves.map((leaf) => leaf.departments)).toEqual([['RBD'], ['RBD'], ['RBD', 'SANIT']]);
  });

  it('flags each unknown value in a list on its own', () => {
    const result = parse([row('SANIT, NA, Parks')]);
    expect(result.validation.errors.map((e) => e.value)).toEqual(['NA', 'Parks']);
  });

  it('asks for the code when two departments share a name', () => {
    const result = parse([row('Works')], [
      { code: 'WORKS_N', name: 'Works' },
      { code: 'WORKS_S', name: 'works' },
    ]);
    expect(result.validation.errors.map((e) => e.message)).toEqual([
      'Row 2: more than one department is called “Works”. Use its code instead: WORKS_N, WORKS_S.',
    ]);
  });

  it('asks for the code when two departments share a name with a comma in it, rather than splitting it', () => {
    const result = parse([row('Roads, Bridges')], [
      { code: 'RB_N', name: 'Roads, Bridges' },
      { code: 'RB_S', name: 'Roads, bridges' },
    ]);
    expect(result.validation.errors.map((e) => e.message)).toEqual([
      'Row 2: more than one department is called “Roads, Bridges”. Use its code instead: RB_N, RB_S.',
    ]);
  });

  it('refuses a value that is one department’s code and another’s name, naming both', () => {
    const departments = [
      { code: 'ROADS', name: 'Road Works' },
      { code: 'PWD', name: 'Roads' },
    ];
    const result = parse([row('Roads', 'A'), row('PWD', 'B'), row('road works', 'C')], departments);
    expect(result.validation.errors.map((e) => [e.row, e.message])).toEqual([
      [
        2,
        'Row 2: “Roads” is the code of one department and the name of another: Road Works (ROADS), Roads (PWD). Use a name or code that only one of them has.',
      ],
    ]);
    expect(result.leaves.map((leaf) => leaf.department)).toEqual(['', 'PWD', 'ROADS']);
    // A department whose code and name are the same word is not two departments.
    expect(parse([row('Roads')], [{ code: 'ROADS', name: 'Roads' }]).validation.errors).toEqual([]);
  });

  it('lists eight departments to choose from, then trails off', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ code: `D${i + 1}`, name: `Dept ${i + 1}` }));
    expect(parse([row('Nope')], many).validation.errors[0].message).toBe(
      'Row 2: department “Nope” doesn’t exist. Use one of: Dept 1 (D1), Dept 2 (D2), Dept 3 (D3), Dept 4 (D4), Dept 5 (D5), Dept 6 (D6), Dept 7 (D7), Dept 8 (D8), ….',
    );
  });

  it('says to add departments first when the workspace has none', () => {
    const result = parse([row('SANIT')], []);
    expect(result.validation.errors[0].message).toBe(
      'Row 2: department “SANIT” doesn’t exist. This workspace has no departments yet: add them in the Departments step first.',
    );
  });

  it('still reads templates downloaded before the header changed', () => {
    const result = parse([row('Sanitation Services', 'A', 'Department Name*')]);
    expect(result.validation.errors).toEqual([]);
    expect(result.leaves[0].department).toBe('SANIT');
  });
});

describe('the complaints template', () => {
  const sheetRows = (wb: XLSX.WorkBook, name: string) => XLSX.utils.sheet_to_json<string[]>(wb.Sheets[name], { header: 1 });

  it('heads the department column the way it is read, with sample rows that pass as they are', () => {
    const wb = buildComplaintHierarchyTemplate(LEVELS, DEPARTMENTS);
    const [header, ...samples] = sheetRows(wb, 'ComplaintHierarchy');
    expect(header).toContain(COMPLAINT_DEPARTMENT_HEADER);
    const column = header.indexOf(COMPLAINT_DEPARTMENT_HEADER);
    // One sample by name, one by code: the column takes either.
    expect(samples.map((sample) => sample[column])).toEqual(['Sanitation Services', 'SANIT', 'Roads and Transport']);

    const result = parseComplaintHierarchyExcel(wb, 'PGR', LEVELS, { departments: DEPARTMENTS });
    expect(result.validation.errors).toEqual([]);
    expect(result.leaves.map((leaf) => leaf.department)).toEqual(['SANIT', 'SANIT', 'ROADS']);
  });

  it('passes its own sample rows when a department’s name has a comma in it', () => {
    const departments = [{ code: 'RBD', name: 'Roads, Bridges and Drains' }, ...DEPARTMENTS];
    const result = parseComplaintHierarchyExcel(buildComplaintHierarchyTemplate(LEVELS, departments), 'PGR', LEVELS, { departments });
    expect(result.validation.errors).toEqual([]);
    expect(result.leaves.map((leaf) => leaf.department)).toEqual(['RBD', 'RBD', 'SANIT']);
  });

  it('lists the departments on their own sheet, without the founder’s system department', () => {
    const wb = buildComplaintHierarchyTemplate(LEVELS, [...DEPARTMENTS, { code: 'ONBOARDING_ADMIN', name: 'Administration' }]);
    expect(sheetRows(wb, 'Departments')).toEqual([
      ['Department code', 'Department name'],
      ['SANIT', 'Sanitation Services'],
      ['ROADS', 'Roads and Transport'],
    ]);
  });
});
