import { deactivateAndRemove, employeeUuid, requiredEmail, type MemberEmployee } from '@/identity/memberActions';
import { linkMember, removeMember, updateMemberEmail } from '@/identity/api';
import { apiClient } from '@/api/client';
import { boundaryService, hrmsService, localizationService, mdmsService } from '@/api';
import type { Employee, EmployeeJurisdiction } from '@/api/types';
import { listMasters, recordDepartments, recordName } from '../departments/mastersApi';
import { readLocales } from '../labelLocales';
import { allowedEmployeeRoles } from '@/lib/systemRecords';
import { MessageError } from '../i18n';
import type { InviteStatus } from './inviteStatus';

/**
 * Employees for the Employees step: the choices the add dialog offers (from
 * the steps before it), the workspace's employees, adding one and removing one.
 */

export interface Choice {
  code: string;
  name: string;
}

export interface BoundaryChoice extends Choice {
  boundaryType: string;
  hierarchyType: string;
  /** Position of its level in the hierarchy, 0 at the top. */
  depth: number;
}

export interface EmployeeOptions {
  departments: Choice[];
  designations: (Choice & { departments: string[] })[];
  roles: Choice[];
  boundaries: BoundaryChoice[];
  /** The workspace's own mobile rule (common-masters.MobileNumberValidation). */
  mobilePattern: RegExp;
}

export interface NewEmployee {
  code: string;
  name: string;
  mobileNumber: string;
  emailId?: string;
  department: string;
  designation: string;
  roles: string[];
  jurisdictions: string[];
}

/** Used when the workspace has no mobile rule of its own. */
const FALLBACK_MOBILE = /^\d{9,10}$/;

/**
 * Every boundary the workspace's hierarchies hold, named, shallowest level
 * first. Each hierarchy's boundaries and labels load at the same time as the
 * others'.
 */
async function loadBoundaryChoices(tenantId: string): Promise<BoundaryChoice[]> {
  const hierarchies = await boundaryService.getHierarchies(tenantId).catch(() => []);
  const perHierarchy = await Promise.all(
    hierarchies.map(async (hierarchy) => {
      const levels = (hierarchy.boundaryHierarchy ?? []).map((level) => level.boundaryType);
      // Relationship search returns codes only; a boundary's name is its label in
      // rainmaker-boundary-<hierarchy>, keyed by the code, as Geography writes it.
      // Active UI locale first, en_IN as the fallback.
      const labelModule = `rainmaker-boundary-${hierarchy.hierarchyType.toLowerCase()}`;
      const [found, ...labelSets] = await Promise.all([
        boundaryService.searchBoundaries(tenantId, { hierarchyType: hierarchy.hierarchyType }).catch(() => []),
        ...readLocales().map((locale) => localizationService.searchMessages(tenantId, locale, labelModule).catch(() => [])),
      ]);
      const nameOf = new Map(labelSets.reverse().flat().map((label) => [label.code, label.message]));
      return found.map(
        (boundary): BoundaryChoice => ({
          code: boundary.code,
          name: boundary.name || nameOf.get(boundary.code) || boundary.code,
          boundaryType: boundary.boundaryType,
          hierarchyType: hierarchy.hierarchyType,
          depth: Math.max(0, levels.indexOf(boundary.boundaryType)),
        }),
      );
    }),
  );
  return perHierarchy.flat().sort((a, b) => a.depth - b.depth || a.name.localeCompare(b.name));
}

export async function loadEmployeeOptions(tenantId: string): Promise<EmployeeOptions> {
  // The boundaries need the hierarchies first. That chain runs beside the other
  // lookups rather than after all of them.
  const [departments, designations, roles, boundaries, mobileRule] = await Promise.all([
    listMasters(tenantId, 'department'),
    listMasters(tenantId, 'designation'),
    mdmsService.getRoles(tenantId).catch(() => []),
    loadBoundaryChoices(tenantId),
    mdmsService.getMobileValidation(tenantId).catch(() => null),
  ]);

  let mobilePattern = FALLBACK_MOBILE;
  if (mobileRule?.mobileNumberRegex) {
    try {
      mobilePattern = new RegExp(mobileRule.mobileNumberRegex);
    } catch {
      // A malformed rule falls back rather than blocking every number.
    }
  }

  return {
    departments: departments.map((record) => ({ code: record.uniqueIdentifier, name: recordName(record) })),
    designations: designations.map((record) => ({
      code: record.uniqueIdentifier,
      name: recordName(record),
      departments: recordDepartments(record),
    })),
    roles: allowedEmployeeRoles(roles.map((role) => ({ code: role.code, name: role.name || role.code }))),
    boundaries,
    mobilePattern,
  };
}

export type EmployeeRecord = Employee & { isActive?: boolean };

export interface EmployeeList {
  /** The employees who can sign in: what the step lists. */
  active: Employee[];
  /** Every code HRMS holds, removed employees' included: none can be given out again. */
  codes: string[];
}

export async function listEmployees(tenantId: string): Promise<EmployeeList> {
  const employees = (await hrmsService.searchEmployees(tenantId, { limit: 500 })) as EmployeeRecord[];
  return {
    active: employees.filter((employee) => employee.isActive !== false),
    codes: employees.map((employee) => employee.code).filter((code): code is string => !!code),
  };
}

/** The highest number among EMP_0001-style codes, or 0. */
function highestEmployeeNumber(codes: string[]): number {
  return codes.reduce((max, code) => {
    const match = /^EMP_(\d+)$/.exec(code);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
}

/**
 * One past the highest EMP_0001-style code HRMS holds, removed employees'
 * included, so a removed employee's code is never offered again.
 */
export function suggestEmployeeCode(codes: string[]): string {
  return hrmsService.generateEmployeeCode('EMP', highestEmployeeNumber(codes) + 1);
}

/**
 * Codes for a bulk upload's rows: a row's own code as given, a blank one the
 * next free EMP_ code past the highest HRMS holds (removed employees included)
 * and the highest on the sheet. Numbering from the row index took codes in use,
 * the founder's EMP_0001 among them (#2456).
 */
export function planEmployeeCodes(existing: string[], given: string[]): string[] {
  let next = highestEmployeeNumber([...existing, ...given]);
  return given.map((code) => code || hrmsService.generateEmployeeCode('EMP', ++next));
}

/** An email as HRMS and the sheet are compared on it: trimmed, any case. */
const emailKey = (value: unknown) => (typeof value === 'string' ? value.trim().toLowerCase() : '');

/**
 * A bulk sheet's rows with every blank code filled in. A blank-code row with the
 * email of someone HRMS holds, active, takes that person's code: the same person
 * codeProblem names as existing, so a re-upload of a sheet without codes shows
 * them as already added when matchesSheetRow agrees, and refuses them otherwise,
 * rather than giving them a new code and adding them again (#2799). Any other
 * blank code gets planEmployeeCodes' next free EMP_ code, past `reserved` too:
 * the codes on rows the parser refused, which a fixed re-upload still asks for.
 */
export function withEmployeeCodes<T extends { employeeCode: string; emailId?: string }>(
  rows: T[],
  existing: Map<string, EmployeeRecord>,
  reserved: string[] = [],
): T[] {
  const byEmail = new Map<string, string>();
  for (const [code, holder] of existing) {
    const email = emailKey(holder.user?.emailId);
    if (holder.isActive !== false && email && !byEmail.has(email)) byEmail.set(email, code);
  }
  const given = rows.map((row) => row.employeeCode || byEmail.get(emailKey(row.emailId)) || '');
  const codes = planEmployeeCodes([...existing.keys(), ...reserved], given);
  return rows.map((row, index) => ({ ...row, employeeCode: codes[index] }));
}

/** HRMS search page size for employeesByCode, and the most pages it reads before giving up. */
const EMPLOYEE_PAGE = 500;
const EMPLOYEE_MAX_PAGES = 100;

/**
 * Every employee HRMS holds, removed ones included, by code: what a bulk upload's
 * codes are checked against. Read page by page to the end: with only the first
 * page, anyone past it looked new, was counted as created again, and left their
 * code free for a blank row (#2798). A list that doesn't end is an error, never a
 * partial map.
 */
export async function employeesByCode(tenantId: string): Promise<Map<string, EmployeeRecord>> {
  const employees: EmployeeRecord[] = [];
  for (let page = 0; page < EMPLOYEE_MAX_PAGES; page++) {
    const rows = (await hrmsService.searchEmployees(tenantId, { limit: EMPLOYEE_PAGE, offset: page * EMPLOYEE_PAGE })) as EmployeeRecord[];
    employees.push(...rows);
    if (rows.length < EMPLOYEE_PAGE) {
      return new Map(employees.filter((employee) => employee.code).map((employee): [string, EmployeeRecord] => [employee.code, employee]));
    }
  }
  throw new Error(`HRMS employee search still had rows after ${EMPLOYEE_MAX_PAGES} pages; refusing a partial list`);
}

/**
 * Why a bulk row's code can't be used as a new employee's, or null (#2456). A code
 * on two rows folds two people into one; anyone else's, or a removed employee's,
 * fails at create; the founder holds EMP_0001. The same active person's (same
 * email) is `exists`: a bulk upload never changes an employee, and creating would
 * leave the record as it is while counting it as created (#2798), so the caller
 * skips the row when matchesSheetRow says it holds what HRMS has, and refuses it
 * otherwise. `sheet` is every row of the upload, the ones the parser refused
 * included: their codes are still asked for, by the fixed re-upload.
 */
export function codeProblem(
  row: { employeeCode: string; emailId?: string },
  sheet: { employeeCode: string }[],
  existing: Map<string, EmployeeRecord>,
): { repeated: true } | { takenBy: string } | { exists: EmployeeRecord } | null {
  if (sheet.filter((other) => other.employeeCode === row.employeeCode).length > 1) return { repeated: true };
  const holder = existing.get(row.employeeCode);
  if (!holder) return null;
  const same = holder.isActive !== false && emailKey(row.emailId) !== '' && emailKey(row.emailId) === emailKey(holder.user?.emailId);
  return same ? { exists: holder } : { takenBy: holder.user?.name || row.employeeCode };
}

/**
 * Whether a bulk row holds what HRMS already has for that employee: name, mobile,
 * departments (the first the current one), designation, every role it lists, and
 * the same active jurisdictions. Such a row was added already, by an earlier
 * upload of the same sheet for instance, and is skipped (#2799). `boundaryCode`
 * turns a jurisdiction cell (a code or a name) into its boundary code. Date of
 * birth, gender and appointment date aren't compared: the step doesn't show them.
 */
export function matchesSheetRow(
  row: { name: string; mobileNumber: string; department: string; designation: string; roles: string; jurisdictions: string },
  holder: EmployeeRecord,
  boundaryCode: (cell: string) => string | undefined,
): boolean {
  const text = (value: unknown) => String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
  const list = (value: string) => value.split(',').map((item) => item.trim()).filter(Boolean);
  const current = currentAssignment(holder);
  const departments = list(row.department);
  const held = new Set((holder.user?.roles ?? []).map((role) => role.code));
  const places = new Set(list(row.jurisdictions).map((cell) => boundaryCode(cell) ?? cell));
  const heldPlaces = new Set((holder.jurisdictions ?? []).filter((place) => place.isActive !== false).map((place) => place.boundary));
  const mobile = String(holder.user?.mobileNumber ?? '').trim();
  return (
    text(row.name) === text(holder.user?.name) &&
    // A masked number can't be compared; the code and email already name the person.
    (mobile.includes('*') || row.mobileNumber.trim() === mobile) &&
    departments[0] === current?.department &&
    departments.every((code) => (holder.assignments ?? []).some((assignment) => assignment.department === code)) &&
    row.designation === current?.designation &&
    list(row.roles || 'EMPLOYEE').every((code) => held.has(code)) &&
    places.size === heldPlaces.size &&
    [...places].every((code) => heldPlaces.has(code))
  );
}

/**
 * Whether a bulk row is someone HRMS already holds, just as the row describes
 * them: the row is skipped as already added, never counted as created (#2799).
 * A jurisdiction cell is taken as a boundary code unless `boundaryCode` says
 * otherwise.
 */
export function alreadyAdded(
  row: Parameters<typeof codeProblem>[0] & Parameters<typeof matchesSheetRow>[0],
  sheet: { employeeCode: string }[],
  existing: Map<string, EmployeeRecord>,
  boundaryCode: (cell: string) => string | undefined = (cell) => cell,
): boolean {
  const clash = codeProblem(row, sheet, existing);
  return !!clash && 'exists' in clash && matchesSheetRow(row, clash.exists, boundaryCode);
}

export async function addEmployee(tenantId: string, input: NewEmployee, options: EmployeeOptions): Promise<Employee> {
  const boundaryByCode = new Map(options.boundaries.map((boundary) => [boundary.code, boundary]));
  const roleByCode = new Map(options.roles.map((role) => [role.code, role]));
  const employee = hrmsService.buildEmployee({
    tenantId,
    code: input.code,
    name: input.name.trim(),
    // HRMS makes every employee's username their code (enrichUser), whatever is sent.
    userName: input.code,
    mobileNumber: input.mobileNumber,
    emailId: requiredEmail(input.emailId),
    department: input.department,
    designation: input.designation,
    roles: input.roles.map((code) => ({ code, name: roleByCode.get(code)?.name ?? code })),
    jurisdictions: input.jurisdictions.map((code) => {
      const boundary = boundaryByCode.get(code);
      return {
        boundary: code,
        boundaryType: boundary?.boundaryType ?? '',
        hierarchyType: boundary?.hierarchyType ?? 'ADMIN',
      };
    }),
  });
  return hrmsService.createEmployee(employee);
}

/** What the Employees step can change on someone already added. The code never changes. */
export interface EmployeeChanges {
  name: string;
  mobileNumber: string;
  emailId: string;
  department: string;
  designation: string;
  roles: string[];
  jurisdictions: string[];
}

/**
 * Apply an edit to the freshly read HRMS record, keeping what the step doesn't
 * show: roles not offered here, earlier assignments, and the record ids HRMS
 * needs. The main department and designation change on the current
 * assignment. A dropped jurisdiction is switched off (HRMS keeps it). The email
 * is written only with `writeEmail`: a joined member's new email reaches HRMS
 * from the BFF once they confirm it.
 */
export function applyEmployeeChanges(fresh: Employee, changes: EmployeeChanges, options: EmployeeOptions, writeEmail = false): Employee {
  const tenantId = fresh.tenantId;
  const offered = new Set(options.roles.map((role) => role.code));
  const roleName = new Map(options.roles.map((role) => [role.code, role.name]));
  const keptRoles = (fresh.user.roles ?? []).filter((role) => !offered.has(role.code) || (role.tenantId ?? tenantId) !== tenantId);
  const roles = [...keptRoles, ...changes.roles.map((code) => ({ code, name: roleName.get(code) ?? code, tenantId }))];

  const current = (fresh.assignments ?? []).some((assignment) => assignment.isCurrentAssignment);
  const assignments = current
    ? fresh.assignments.map((assignment) =>
        assignment.isCurrentAssignment ? { ...assignment, department: changes.department, designation: changes.designation } : assignment,
      )
    : [...(fresh.assignments ?? []), { department: changes.department, designation: changes.designation, fromDate: Date.now(), isCurrentAssignment: true }];

  const chosen = new Set(changes.jurisdictions);
  const boundaryByCode = new Map(options.boundaries.map((boundary) => [boundary.code, boundary]));
  const jurisdictions: EmployeeJurisdiction[] = (fresh.jurisdictions ?? []).map((jurisdiction) => ({
    ...jurisdiction,
    isActive: chosen.has(jurisdiction.boundary),
  }));
  for (const code of changes.jurisdictions) {
    if (jurisdictions.some((jurisdiction) => jurisdiction.boundary === code)) continue;
    const boundary = boundaryByCode.get(code);
    const hierarchyType = boundary?.hierarchyType ?? 'ADMIN';
    // HRMS reads `hierarchy`; the type and the rest of DIGIT say `hierarchyType`.
    jurisdictions.push({ boundary: code, boundaryType: boundary?.boundaryType ?? '', hierarchyType, hierarchy: hierarchyType, isActive: true } as EmployeeJurisdiction);
  }

  const user = {
    ...fresh.user,
    name: changes.name.trim(),
    mobileNumber: changes.mobileNumber.trim(),
    roles,
    ...(writeEmail && { emailId: requiredEmail(changes.emailId) }),
  };
  delete (user as { password?: string }).password;
  const reActivateEmployee = (fresh as Employee & { reActivateEmployee?: boolean }).reActivateEmployee ?? false;
  return { ...fresh, user, assignments, jurisdictions, reActivateEmployee } as Employee;
}

/** What happened to a new email: confirmed by a link, a new invitation, or saved for the next one. */
export type EmailOutcome = 'unchanged' | 'verification_sent' | 'invited' | 'saved';

/**
 * Save an edit. A new email goes the way the member's sign-in state allows
 * (identity-bff §3.6): a joined member confirms it by a link
 * (_updateEmail), a pending invitation is withdrawn and sent again to the new
 * address, and anyone not invited just has it saved for their next invitation.
 * An unknown state (`null`, the member list didn't load) is treated as joined.
 */
export async function updateEmployeeDetails(
  employee: Employee,
  changes: EmployeeChanges,
  options: EmployeeOptions,
  status: InviteStatus | null = null,
): Promise<{ email: EmailOutcome }> {
  const rows = await hrmsService.searchEmployees(employee.tenantId, { codes: [employee.code] });
  // Never another workspace's employee with the same code (#2456).
  const fresh = rows.find((row) => row.code === employee.code && row.tenantId === employee.tenantId);
  if (!fresh) throw new MessageError('employees.gone', 'This employee no longer exists. Reload and try again.');
  const email = requiredEmail(changes.emailId);
  // An invitation still at an older address (a move that stopped halfway) counts as a change.
  const current = status?.kind === 'invited' && status.email ? status.email : fresh.user.emailId;
  const changed = email !== (current ?? '').trim().toLowerCase();
  const joined = !status || status.kind === 'active';
  await hrmsService.updateEmployee(applyEmployeeChanges(fresh, changes, options, changed && !joined));
  if (!changed) return { email: 'unchanged' };
  const uuid = employeeUuid(fresh as unknown as MemberEmployee);
  if (joined) {
    await updateMemberEmail(employee.tenantId, uuid, email);
    return { email: 'verification_sent' };
  }
  if (status.kind !== 'invited') return { email: 'saved' };
  await removeMember(employee.tenantId, uuid);
  try {
    await linkMember(employee.tenantId, uuid, email, true);
  } catch (error) {
    const reason = error instanceof Error ? error.message : '';
    throw reason
      ? new MessageError(
          'employees.invite_move_failed_reason',
          'The old invitation was withdrawn, but the new one didn’t go out. Use Invite again to send it. %{reason}',
          { reason },
        )
      : new MessageError('employees.invite_move_failed', 'The old invitation was withdrawn, but the new one didn’t go out. Use Invite again to send it.');
  }
  return { email: 'invited' };
}

/** Deactivate, as management's delete does: HRMS keeps the record, marked inactive. */
export async function removeEmployee(employee: Employee): Promise<void> {
  // By uuid, never by code: another workspace's employee can share the code (#2456). A uuid search keeps
  // HRMS's tenant filter.
  const uuid = employee.user?.uuid || employee.uuid;
  if (!uuid) throw new MessageError('members.no_account_id', 'HRMS did not return the employee account identifier. Reload and retry.');
  await deactivateAndRemove(
    async () => {
      const rows = await hrmsService.searchEmployees(employee.tenantId, { uuids: [uuid] });
      const fresh = rows.find(row => (row.user?.uuid || row.uuid) === uuid && row.tenantId === employee.tenantId);
      if (!fresh) throw new MessageError('employees.gone_from_hrms', 'Employee no longer exists in HRMS.');
      return fresh as unknown as MemberEmployee;
    },
    row => hrmsService.updateEmployee(row as unknown as Employee),
    apiClient.getAuth().user?.uuid,
  );
}

export function currentAssignment(employee: Employee) {
  return employee.assignments?.find((assignment) => assignment.isCurrentAssignment) ?? employee.assignments?.[0];
}
