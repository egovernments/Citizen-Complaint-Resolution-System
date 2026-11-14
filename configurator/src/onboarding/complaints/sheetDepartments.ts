import { englishT, type OnboardingT } from '../i18n';

/** A department a complaint type can be sent to. */
export interface DepartmentChoice {
  code: string;
  name?: string;
}

/** What one cell value of the complaints sheet's department column resolves to. */
export type DepartmentMatch =
  | { ok: true; code: string }
  | { ok: false; message: string };

/** Lower case with runs of spaces folded, so " sanitation  services" matches "Sanitation Services". */
const fold = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();

/** How many departments an error lists before it trails off. */
const LISTED = 8;

/** "Sanitation Services (SANIT), Roads (ROADS), …": names first, the code as small print. */
export function departmentList(departments: DepartmentChoice[]): string {
  const shown = departments.slice(0, LISTED).map((d) => (d.name && d.name !== d.code ? `${d.name} (${d.code})` : d.code));
  return departments.length > LISTED ? `${shown.join(', ')}, …` : shown.join(', ');
}

/** A blank department cell. */
export function noDepartmentMessage(row: number, t: OnboardingT = englishT): string {
  return t('complaints.sheet_no_department', 'Row %{row}: no department. Every complaint type needs one.', { row });
}

/**
 * One department cell value, by code first, then by name, ignoring case and extra spaces. A
 * value that matches nothing, or a name two departments share, comes back as the message the
 * preview shows for its row.
 */
export function matchDepartment(
  value: string,
  row: number,
  departments: DepartmentChoice[],
  t: OnboardingT = englishT,
): DepartmentMatch {
  const wanted = fold(value);
  const byCode = departments.find((d) => fold(d.code) === wanted);
  if (byCode) return { ok: true, code: byCode.code };
  const byName = departments.filter((d) => d.name && fold(d.name) === wanted);
  if (byName.length === 1) return { ok: true, code: byName[0].code };
  if (byName.length > 1) {
    return {
      ok: false,
      message: t(
        'complaints.sheet_department_ambiguous',
        'Row %{row}: more than one department is called “%{value}”. Use its code instead: %{codes}.',
        { row, value, codes: byName.map((d) => d.code).join(', ') },
      ),
    };
  }
  if (departments.length === 0) {
    return {
      ok: false,
      message: t(
        'complaints.sheet_department_none_yet',
        'Row %{row}: department “%{value}” doesn’t exist. This workspace has no departments yet: add them in the Departments step first.',
        { row, value },
      ),
    };
  }
  return {
    ok: false,
    message: t('complaints.sheet_department_unknown', 'Row %{row}: department “%{value}” doesn’t exist. Use one of: %{choices}.', {
      row,
      value,
      choices: departmentList(departments),
    }),
  };
}
