import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { parseDepartmentExcel, parseDesignationExcel } from '@/utils/excelParser';
import { checkSheet, type SheetContext } from './sheetCheck';

function workbook(departments: Record<string, unknown>[], designations: Record<string, unknown>[]): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(departments), 'Department');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(designations), 'Designation');
  return wb;
}

const check = (wb: XLSX.WorkBook, workspace: Partial<Record<keyof SheetContext, string[]>> = {}) =>
  checkSheet(
    parseDepartmentExcel(wb).data,
    parseDesignationExcel(wb).data,
    {
      departments: new Set(workspace.departments),
      designations: new Set(workspace.designations),
      linkable: new Set(workspace.linkable),
    },
  );

describe('checkSheet', () => {
  it('names a designation linked to a department that does not exist, and leaves it out (#2807)', () => {
    const wb = workbook(
      [{ code: 'ROADS', name: 'Roads' }],
      [
        { code: 'CLERK', name: 'Clerk', department: 'ROADS' },
        { code: 'GRO_OFF', name: 'Grievance Officer', department: 'ROADS,NOPE' },
      ],
    );
    const result = check(wb);
    expect(result.problems).toEqual(['Row 3: department NOPE doesn’t exist. Add it to the Department sheet, or use one you already have.']);
    expect(result.designations.map((row) => row.code)).toEqual(['CLERK']);
    expect(result.departments).toEqual([{ code: 'ROADS', name: 'Roads' }]);
  });

  it('counts departments on the sheet and in the workspace as known', () => {
    const wb = workbook([{ code: 'ROADS', name: 'Roads' }], [{ code: 'ENG', name: 'Engineer', department: 'ROADS, WATER' }]);
    expect(check(wb, { departments: ['WATER'], linkable: ['WATER'] })).toEqual({
      departments: [{ code: 'ROADS', name: 'Roads' }],
      designations: [{ code: 'ENG', name: 'Engineer', departments: ['ROADS', 'WATER'] }],
      problems: [],
    });
  });

  it('counts the departments the city inherits from the state, and the system ones, as known', () => {
    const wb = workbook(
      [],
      [
        { code: 'ENG', name: 'Engineer', department: 'DEPT_1' },
        { code: 'ADMIN_ASST', name: 'Admin assistant', department: 'ONBOARDING_ADMIN' },
      ],
    );
    const result = check(wb, { linkable: ['DEPT_1', 'ONBOARDING_ADMIN'] });
    expect(result.problems).toEqual([]);
    expect(result.designations.map((row) => row.code)).toEqual(['ENG', 'ADMIN_ASST']);
  });

  it('lists every missing department on the row', () => {
    const wb = workbook([], [{ code: 'ENG', name: 'Engineer', department: 'NOPE,GHOST' }]);
    expect(check(wb).problems).toEqual([
      'Row 2: departments NOPE, GHOST don’t exist. Add them to the Department sheet, or use ones you already have.',
    ]);
  });

  it('does not count a department row that is switched off or refused', () => {
    const wb = workbook(
      [
        { code: 'OFF', name: 'Off', active: false },
        { code: 'BAD CODE!', name: 'Bad' },
      ],
      [{ code: 'ENG', name: 'Engineer', department: 'OFF' }],
    );
    const result = check(wb);
    expect(result.departments).toEqual([]);
    expect(result.designations).toEqual([]);
    expect(result.problems).toEqual([
      'Row 3: department code “BAD CODE!” can only use capital letters, digits and underscores.',
      'Row 2: department OFF doesn’t exist. Add it to the Department sheet, or use one you already have.',
    ]);
  });

  it('refuses codes the add dialog refuses (D-2)', () => {
    const wb = workbook([{ code: 'roads', name: 'Roads' }], [{ code: 'Ward Officer', name: 'Ward officer' }]);
    expect(check(wb).problems).toEqual([
      'Row 2: department code “roads” can only use capital letters, digits and underscores.',
      'Row 2: designation code “Ward Officer” can only use capital letters, digits and underscores.',
    ]);
  });

  it('keeps a designation with no departments', () => {
    const wb = workbook([], [{ code: 'CLERK', name: 'Clerk' }]);
    expect(check(wb).designations).toEqual([{ code: 'CLERK', name: 'Clerk', departments: [] }]);
  });

  it('passes rows whose code the workspace has without checking them: the import skips them', () => {
    const wb = workbook(
      [{ code: 'roads', name: 'Roads' }],
      [
        { code: 'OLD', name: 'Old post', department: 'GONE' },
        { code: 'old_clerk', name: 'Old clerk' },
      ],
    );
    const result = check(wb, { departments: ['roads'], designations: ['OLD', 'old_clerk'] });
    expect(result.problems).toEqual([]);
    expect(result.departments).toEqual([{ code: 'roads', name: 'Roads' }]);
    expect(result.designations).toEqual([
      { code: 'OLD', name: 'Old post', departments: ['GONE'] },
      { code: 'old_clerk', name: 'Old clerk', departments: [] },
    ]);
  });
});
