import type { DepartmentExcelRow, DesignationExcelRow, ValidationResult } from '@/api/types';
import { englishT, type OnboardingT } from '../i18n';
import { CODE_PATTERN, type MasterInput } from './mastersApi';

/** The template's two tabs, by the names the operator sees on them. */
export type SheetName = 'Department' | 'Designation';

/** "Designation row 3: …": a problem on a numbered row, with the tab it is on. */
export function sheetRowProblem(sheet: SheetName, row: number | undefined, problem: string, t: OnboardingT = englishT): string {
  return row ? t('departments.bulk.sheet_row_problem', '%{sheet} row %{row}: %{problem}', { sheet, row, problem }) : problem;
}

interface ParsedSheet<Row> {
  data: Row[];
  validation: ValidationResult;
}

/** What the workspace already holds, to check a sheet against. */
export interface SheetContext {
  /** The workspace's own department codes. A row with one of them is skipped on import, so it isn't checked. */
  departments: Set<string>;
  /** The same, for designations. */
  designations: Set<string>;
  /**
   * Every department a designation can be linked to: the workspace's own, the ones it inherits
   * from the state root and the system ones. The Employees and Complaints steps take the same.
   */
  linkable: Set<string>;
}

/**
 * The bulk sheet's rows held to what the add dialog holds a record to, before
 * anything is saved: codes of capitals, digits and underscores (D-2), and a
 * designation's departments that exist, in the workspace or on this sheet's
 * Department tab (#2807). A row that fails is named in the preview, with the
 * parser's own problems, and left out of the import until the sheet is fixed.
 */
export function checkSheet(
  sheets: { departments: ParsedSheet<DepartmentExcelRow>; designations: ParsedSheet<DesignationExcelRow> },
  workspace: SheetContext,
  t: OnboardingT = englishT,
): { departments: MasterInput[]; designations: MasterInput[]; problems: string[] } {
  const problems: string[] = [];
  const problem = (sheet: SheetName, row: number | undefined, text: string) => problems.push(sheetRowProblem(sheet, row, text, t));

  for (const error of sheets.departments.validation.errors) problem('Department', error.row, error.message);
  const departments: MasterInput[] = [];
  for (const row of sheets.departments.data.filter((r) => r.active !== false)) {
    if (!workspace.departments.has(row.code) && !CODE_PATTERN.test(row.code)) {
      problem(
        'Department',
        row.row,
        t('departments.bulk.bad_department_code', 'department code “%{code}” can only use capital letters, digits and underscores.', { code: row.code }),
      );
      continue;
    }
    departments.push({ code: row.code, name: row.name });
  }

  for (const error of sheets.designations.validation.errors) problem('Designation', error.row, error.message);
  const known = new Set([...workspace.linkable, ...workspace.departments, ...departments.map((department) => department.code)]);
  const designations: MasterInput[] = [];
  for (const row of sheets.designations.data.filter((r) => r.active !== false)) {
    const linked = row.department ?? [];
    if (!workspace.designations.has(row.code)) {
      if (!CODE_PATTERN.test(row.code)) {
        problem(
          'Designation',
          row.row,
          t('departments.bulk.bad_designation_code', 'designation code “%{code}” can only use capital letters, digits and underscores.', { code: row.code }),
        );
        continue;
      }
      const unknown = linked.filter((code) => !known.has(code));
      if (unknown.length) {
        problem(
          'Designation',
          row.row,
          unknown.length === 1
            ? t('departments.bulk.unknown_department_one', 'department %{codes} doesn’t exist. Add it to the Department sheet, or use one you already have.', {
                codes: unknown[0],
              })
            : t('departments.bulk.unknown_department_other', 'departments %{codes} don’t exist. Add them to the Department sheet, or use ones you already have.', {
                codes: unknown.join(', '),
              }),
        );
        continue;
      }
    }
    designations.push({ code: row.code, name: row.name, departments: linked });
  }
  return { departments, designations, problems };
}
