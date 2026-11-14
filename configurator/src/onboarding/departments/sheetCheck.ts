import type { DepartmentExcelRow, DesignationExcelRow } from '@/api/types';
import { englishT, type OnboardingT } from '../i18n';
import { CODE_PATTERN, type MasterInput } from './mastersApi';

/**
 * The bulk sheet's rows held to what the add dialog holds a record to, before
 * anything is saved: codes of capitals, digits and underscores (D-2), and a
 * designation's departments that exist, in the workspace or on this sheet's
 * Department tab (#2807). A row that fails is named in the preview and left
 * out of the import until the sheet is fixed.
 */
export function checkSheet(
  departmentRows: DepartmentExcelRow[],
  designationRows: DesignationExcelRow[],
  existingDepartments: Set<string>,
  t: OnboardingT = englishT,
): { departments: MasterInput[]; designations: MasterInput[]; problems: string[] } {
  const problems: string[] = [];
  const rowProblem = (row: number | undefined, problem: string) =>
    problems.push(row ? t('common.row_problem', 'Row %{row}: %{problem}', { row, problem }) : problem);

  const departments: MasterInput[] = [];
  for (const row of departmentRows.filter((r) => r.active !== false)) {
    if (!CODE_PATTERN.test(row.code)) {
      rowProblem(
        row.row,
        t('departments.bulk.bad_department_code', 'department code “%{code}” can only use capital letters, digits and underscores.', { code: row.code }),
      );
      continue;
    }
    departments.push({ code: row.code, name: row.name });
  }

  const known = new Set([...existingDepartments, ...departments.map((department) => department.code)]);
  const designations: MasterInput[] = [];
  for (const row of designationRows.filter((r) => r.active !== false)) {
    if (!CODE_PATTERN.test(row.code)) {
      rowProblem(
        row.row,
        t('departments.bulk.bad_designation_code', 'designation code “%{code}” can only use capital letters, digits and underscores.', { code: row.code }),
      );
      continue;
    }
    const linked = row.department ?? [];
    const unknown = linked.filter((code) => !known.has(code));
    if (unknown.length === 1) {
      rowProblem(
        row.row,
        t('departments.bulk.unknown_department_one', 'department %{codes} doesn’t exist. Add it to the Department sheet, or use one you already have.', {
          codes: unknown[0],
        }),
      );
      continue;
    }
    if (unknown.length > 1) {
      rowProblem(
        row.row,
        t('departments.bulk.unknown_department_other', 'departments %{codes} don’t exist. Add them to the Department sheet, or use ones you already have.', {
          codes: unknown.join(', '),
        }),
      );
      continue;
    }
    designations.push({ code: row.code, name: row.name, departments: linked });
  }
  return { departments, designations, problems };
}
