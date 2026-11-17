import { englishT, type OnboardingT } from '../i18n';

/** A department a complaint type can be sent to. */
export interface DepartmentChoice {
  code: string;
  name?: string;
}

/** What one cell value of the complaints sheet's department column resolves to. */
export type DepartmentMatch =
  | { ok: true; code: string }
  /** `ambiguous`: the value names more than one department, rather than none. */
  | { ok: false; message: string; ambiguous?: true };

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
 * One department cell value, by code or by name, ignoring case and extra spaces. A value that
 * matches nothing, a name two departments share, or one department's code that is another's
 * name, comes back as the message the preview shows for its row.
 */
export function matchDepartment(
  value: string,
  row: number,
  departments: DepartmentChoice[],
  t: OnboardingT = englishT,
): DepartmentMatch {
  const wanted = fold(value);
  const byCode = departments.find((d) => fold(d.code) === wanted);
  const byName = departments.filter((d) => d.name && fold(d.name) === wanted);
  // Another department's name too: the cell could mean either, so neither is picked silently.
  const alsoNamed = byName.filter((d) => d !== byCode);
  if (byCode && alsoNamed.length === 0) return { ok: true, code: byCode.code };
  if (byCode) {
    return {
      ok: false,
      ambiguous: true,
      message: t(
        'complaints.sheet_department_code_or_name',
        'Row %{row}: “%{value}” is the code of one department and the name of another: %{choices}. Use a name or code that only one of them has.',
        { row, value, choices: departmentList([byCode, ...alsoNamed]) },
      ),
    };
  }
  if (byName.length === 1) return { ok: true, code: byName[0].code };
  if (byName.length > 1) {
    return {
      ok: false,
      ambiguous: true,
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
