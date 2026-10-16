import { WORKSPACE_HIERARCHY_TYPE } from '@/api/services/boundary';

/**
 * Records the platform provisions for the founder and nobody picks: their
 * Administration department, their Workspace administrator designation, and
 * the WORKSPACE boundary hierarchy that roots them. The workspace step checks
 * ignore them too, so offering them would let someone route complaints to a
 * department that never counts.
 */
export const SYSTEM_DEPARTMENT = 'ONBOARDING_ADMIN';
export const SYSTEM_DESIGNATION = 'ONBOARDING_FOUNDER';

const SYSTEM_CODES = new Set([SYSTEM_DEPARTMENT, SYSTEM_DESIGNATION, WORKSPACE_HIERARCHY_TYPE]);

export function isSystemRecordCode(code: unknown): boolean {
  return typeof code === 'string' && SYSTEM_CODES.has(code);
}

/** Choices for a picker: system records dropped, unless one is already the value. */
export function pickerChoices<T>(items: readonly T[] | undefined, codeOf: (item: T) => unknown, current: Iterable<unknown> = []): T[] {
  const keep = new Set(current);
  return (items ?? []).filter((item) => !isSystemRecordCode(codeOf(item)) || keep.has(codeOf(item)));
}

/**
 * The roles an employee can be given while setting up: the complaint roles of
 * the PGR seed plus EMPLOYEE, which every staff sign-in needs. Platform and
 * admin roles (SUPERUSER, MDMS_ADMIN, ACCOUNT_ADMIN, …) are granted elsewhere.
 * In this order, which is roughly how often they're needed.
 */
export const EMPLOYEE_ROLE_ALLOWLIST = ['EMPLOYEE', 'GRO', 'DGRO', 'PGR_LME', 'SUPERVISOR', 'CSR', 'CFC', 'PGR_VIEWER'] as const;

export function allowedEmployeeRoles<T extends { code: string }>(roles: readonly T[]): T[] {
  const rank = new Map<string, number>(EMPLOYEE_ROLE_ALLOWLIST.map((code, index) => [code, index]));
  return roles.filter((role) => rank.has(role.code)).sort((a, b) => (rank.get(a.code) ?? 0) - (rank.get(b.code) ?? 0));
}
