import { deactivateAndRemove, employeeUuid, requiredEmail, type MemberEmployee } from '@/identity/memberActions';
import { linkMember, removeMember, updateMemberEmail } from '@/identity/api';
import { apiClient } from '@/api/client';
import { boundaryService, hrmsService, localizationService, mdmsService } from '@/api';
import type { Employee, EmployeeJurisdiction } from '@/api/types';
import { listMasters, recordDepartments, recordName } from '../departments/mastersApi';
import { readLocales } from '../labelLocales';
import { allowedEmployeeRoles } from '@/lib/systemRecords';
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
  departments: string[];
  designation: string;
  roles: string[];
  jurisdictions: string[];
}

/** Used when the workspace has no mobile rule of its own. */
const FALLBACK_MOBILE = /^\d{9,10}$/;

export async function loadEmployeeOptions(tenantId: string): Promise<EmployeeOptions> {
  const [departments, designations, roles, hierarchies, mobileRule] = await Promise.all([
    listMasters(tenantId, 'department'),
    listMasters(tenantId, 'designation'),
    mdmsService.getRoles(tenantId).catch(() => []),
    boundaryService.getHierarchies(tenantId).catch(() => []),
    mdmsService.getMobileValidation(tenantId).catch(() => null),
  ]);

  const boundaries: BoundaryChoice[] = [];
  for (const hierarchy of hierarchies) {
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
    for (const boundary of found) {
      boundaries.push({
        code: boundary.code,
        name: boundary.name || nameOf.get(boundary.code) || boundary.code,
        boundaryType: boundary.boundaryType,
        hierarchyType: hierarchy.hierarchyType,
        depth: Math.max(0, levels.indexOf(boundary.boundaryType)),
      });
    }
  }
  boundaries.sort((a, b) => a.depth - b.depth || a.name.localeCompare(b.name));

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

type EmployeeRecord = Employee & { isActive?: boolean };

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

/**
 * One past the highest EMP_0001-style code HRMS holds, removed employees'
 * included, so a removed employee's code is never offered again.
 */
export function suggestEmployeeCode(codes: string[]): string {
  const highest = codes.reduce((max, code) => {
    const match = /^EMP_(\d+)$/.exec(code);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return hrmsService.generateEmployeeCode('EMP', highest + 1);
}

export async function addEmployee(tenantId: string, input: NewEmployee, options: EmployeeOptions): Promise<Employee> {
  const boundaryByCode = new Map(options.boundaries.map((boundary) => [boundary.code, boundary]));
  const roleByCode = new Map(options.roles.map((role) => [role.code, role]));
  // The username comes from the name; two people can share a name, so a taken
  // one gets the (unique) employee code added.
  const base = hrmsService.generateUsername(input.name.trim());
  const userName = (await hrmsService.checkUsernameAvailable(tenantId, base))
    ? base
    : `${base}.${input.code.toLowerCase()}`;
  const employee = hrmsService.buildEmployee({
    tenantId,
    code: input.code,
    name: input.name.trim(),
    userName,
    mobileNumber: input.mobileNumber,
    emailId: requiredEmail(input.emailId),
    // buildEmployee makes the first the current assignment and the rest history.
    department: input.departments.join(','),
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
  const fresh = rows.find((row) => row.code === employee.code);
  if (!fresh) throw new Error('This employee no longer exists. Reload and try again.');
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
    throw new Error(`The old invitation was withdrawn, but the new one didn’t go out. Use Invite again to send it. ${error instanceof Error ? error.message : ''}`.trim());
  }
  return { email: 'invited' };
}

/** Deactivate, as management's delete does: HRMS keeps the record, marked inactive. */
export async function removeEmployee(employee: Employee): Promise<void> {
  await deactivateAndRemove(
    async () => {
      const rows = await hrmsService.searchEmployees(employee.tenantId, { codes: [employee.code] });
      const fresh = rows.find(row => row.uuid === employee.uuid || row.code === employee.code);
      if (!fresh) throw new Error('Employee no longer exists in HRMS.');
      return fresh as unknown as MemberEmployee;
    },
    row => hrmsService.updateEmployee(row as unknown as Employee),
    apiClient.getAuth().user?.uuid,
  );
}

export function currentAssignment(employee: Employee) {
  return employee.assignments?.find((assignment) => assignment.isCurrentAssignment) ?? employee.assignments?.[0];
}
