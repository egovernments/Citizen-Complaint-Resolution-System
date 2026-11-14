import { hrmsService, mdmsService } from '@/api';
import type { Employee, MdmsRecord } from '@/api/types';
import { englishT, MessageError, type OnboardingT } from '../i18n';
import { listMasters, recordDepartments, recordName } from './mastersApi';

/**
 * What still points at a department: employees, designations and complaint
 * categories (#2797). Removing a department in use left its employees
 * uneditable (HRMS checks every assignment's department on each save, past
 * ones included) and its complaints routed to a department nobody can join.
 */

const HIERARCHY_SCHEMA = 'RAINMAKER-PGR.ComplaintHierarchy';

/** The names of what uses a department, by kind. */
export interface DepartmentUses {
  employees: string[];
  designations: string[];
  categories: string[];
}

export interface UsageSources {
  employees: Employee[];
  designations: { name: string; departments: string[] }[];
  /** The complaint categories people file against, and the department each goes to. */
  categories: { name: string; department: string }[];
}

export const hasUses = (uses: DepartmentUses) => uses.employees.length + uses.designations.length + uses.categories.length > 0;

/**
 * Everything in `from` that names a department `matches` picks, and the
 * departments it named. Removed employees don't count: nobody edits them.
 */
export function findUses(matches: (department: string) => boolean, from: UsageSources): DepartmentUses & { departments: string[] } {
  const departments = new Set<string>();
  const hit = (department: string | undefined) => {
    if (!department || !matches(department)) return false;
    departments.add(department);
    return true;
  };
  const distinct = (names: string[]) => Array.from(new Set(names));
  const employees = from.employees
    .filter((employee) => employee.isActive !== false)
    // Every assignment, not only the current one: each is checked again on the next save.
    .filter((employee) => (employee.assignments ?? []).map((assignment) => hit(assignment.department)).some(Boolean))
    .map((employee) => employee.user?.name || employee.code || '');
  const designations = from.designations
    .filter((designation) => designation.departments.map(hit).some(Boolean))
    .map((designation) => designation.name);
  const categories = from.categories.filter((category) => hit(category.department)).map((category) => category.name);
  return {
    employees: distinct(employees.filter(Boolean)),
    designations: distinct(designations),
    categories: distinct(categories),
    departments: Array.from(departments),
  };
}

/** The workspace's own active complaint category rows that route somewhere. */
export function categoryRoutes(records: MdmsRecord[], tenantId: string): UsageSources['categories'] {
  return records
    .filter((record) => record.tenantId === tenantId && record.isActive !== false)
    .map((record) => record.data as { code?: unknown; name?: unknown; department?: unknown; active?: unknown })
    .filter((data) => data.active !== false && typeof data.department === 'string' && data.department !== '')
    .map((data) => ({
      name: (typeof data.name === 'string' && data.name) || (typeof data.code === 'string' ? data.code : ''),
      department: data.department as string,
    }));
}

/** What uses one department now, read fresh. Throws when any of it can't be read. */
export async function loadDepartmentUses(tenantId: string, code: string): Promise<DepartmentUses> {
  const [employees, designations, hierarchy] = await Promise.all([
    hrmsService.searchEmployees(tenantId, { limit: 500 }),
    listMasters(tenantId, 'designation', { ownOnly: true }),
    mdmsService.searchRecords(tenantId, HIERARCHY_SCHEMA, { limit: 5000 }),
  ]);
  const found = findUses((department) => department === code, {
    employees,
    designations: designations.map((record) => ({ name: recordName(record), departments: recordDepartments(record) })),
    categories: categoryRoutes(hierarchy, tenantId),
  });
  return { employees: found.employees, designations: found.designations, categories: found.categories };
}

/** "Amina, Brian, Chen and 2 more": the first three names, then how many others. */
function names(list: string[], t: OnboardingT): string {
  const shown = list.slice(0, 3).join(', ');
  return list.length > 3 ? t('common.names_more', '%{names} and %{count} more', { names: shown, count: list.length - 3 }) : shown;
}

/** "1 employee (Amina) and 2 complaint categories (Potholes, Street lights)". */
export function describeUses(uses: DepartmentUses, t: OnboardingT = englishT): string {
  const params = (list: string[]) => ({ count: list.length, names: names(list, t) });
  const { employees, designations, categories } = uses;
  const parts = [
    employees.length === 1 && t('departments.uses_employee_one', '%{count} employee (%{names})', params(employees)),
    employees.length > 1 && t('departments.uses_employee_other', '%{count} employees (%{names})', params(employees)),
    designations.length === 1 && t('departments.uses_designation_one', '%{count} designation (%{names})', params(designations)),
    designations.length > 1 && t('departments.uses_designation_other', '%{count} designations (%{names})', params(designations)),
    categories.length === 1 && t('departments.uses_category_one', '%{count} complaint category (%{names})', params(categories)),
    categories.length > 1 && t('departments.uses_category_other', '%{count} complaint categories (%{names})', params(categories)),
  ].filter((text): text is string => !!text);
  if (parts.length <= 1) return parts.join('');
  return t('common.list_and', '%{first} and %{last}', { first: parts.slice(0, -1).join(', '), last: parts[parts.length - 1] });
}

/** Why a department can't be removed, and what to do about it. */
export function inUseMessage(name: string, uses: DepartmentUses, t: OnboardingT = englishT): string {
  return t('departments.in_use', '%{name} can’t be removed: it’s used by %{uses}. Move them to another department first.', {
    name,
    uses: describeUses(uses, t),
  });
}

/**
 * Resolves when nothing uses the department; otherwise throws what to tell the person. A department
 * whose uses can't be read isn't removed either: removing it unchecked is what broke workspaces.
 */
export async function checkRemovable(tenantId: string, code: string, name: string, t: OnboardingT = englishT): Promise<void> {
  let uses: DepartmentUses;
  try {
    uses = await loadDepartmentUses(tenantId, code);
  } catch {
    throw new MessageError('departments.in_use_check_failed', 'Couldn’t check what uses %{name}, so it wasn’t removed. Try again.', { name });
  }
  if (hasUses(uses)) throw new Error(inUseMessage(name, uses, t));
}
