/** ours (cfgreview F16, #1562): the employees list's Status and Roles cells. */
type Row = Record<string, unknown>;

const STATUS: Record<string, string> = { EMPLOYED: 'Employed', INACTIVE: 'Inactive', RETIRED: 'Retired', TERMINATED: 'Terminated' };

/** One status: inactive when the user is deactivated, else the HRMS employment status by name. */
export function employeeStatus(r: Row): { active: boolean; label: string } {
  const user = (r.user ?? {}) as Row;
  const deactivated = r.isActive === false || user.active === false;
  const s = String(r.employeeStatus ?? '');
  if (deactivated) return { active: false, label: 'Inactive' };
  return { active: s !== 'INACTIVE', label: STATUS[s] ?? (s ? s.charAt(0) + s.slice(1).toLowerCase() : 'Employed') };
}

/** The person's roles by name (code when unnamed), EMPLOYEE left out (everyone holds it); the first three shown. */
export function employeeRoles(r: Row, max = 3): { all: string[]; shown: string[]; more: number } {
  const roles = (((r.user ?? {}) as Row).roles as Row[] | undefined) ?? [];
  const all = [...new Set(roles
    .filter((x) => x && x.code !== 'EMPLOYEE')
    .map((x) => String((typeof x.name === 'string' && x.name.trim()) || x.code)))];
  return { all, shown: all.slice(0, max), more: Math.max(0, all.length - max) };
}
