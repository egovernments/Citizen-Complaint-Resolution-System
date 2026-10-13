/** ours (cfgreview F14, #1560): Roles by tenant shows names (codes second) and finds a person by name or mobile. */

/** "Name (CODE)", or the code alone when no name is known or the name is the code. */
export function named(names: Map<string, string>, code: string): string {
  const n = names.get(code)?.trim();
  return n && n !== code ? `${n} (${code})` : code;
}

/** Employees matching a search: an exact employee code first, else every name / mobile containing the text. */
export function matchPeople(employees: any[], query: string): any[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const active = employees.filter((e) => e && e.isActive !== false);
  const byCode = active.filter((e) => String(e.code ?? '').toLowerCase() === q);
  if (byCode.length) return byCode;
  const digits = q.replace(/\D/g, '');
  return active.filter((e) => {
    const name = String(e.user?.name ?? '').toLowerCase();
    const mobile = String(e.user?.mobileNumber ?? '');
    return name.includes(q) || (digits.length >= 4 && digits === q.replace(/[\s+-]/g, '') && mobile.includes(digits));
  });
}
