/**
 * ours (cfgreview F28, #1574): what on this tenant needs an administrator, each with where to fix it. Only items with
 * something to do are returned.
 */
export interface AttentionItem { id: string; text: string; to: string; count: number }

type Row = Record<string, unknown>;

const active = (r: Row) => r.isActive !== false && r._isActive !== false && r.active !== false;

export function attentionItems(input: { categories?: Row[]; employees?: Row[]; tenantsListed?: number; tenantsActive?: number }): AttentionItem[] {
  const out: AttentionItem[] = [];
  const noSla = (input.categories ?? []).filter((c) => active(c) && !(Number(c.slaHours) > 0));
  if (noSla.length) {
    out.push({ id: 'categories-no-sla', count: noSla.length, to: '/manage/complaint-hierarchy',
      text: `${noSla.length} complaint ${noSla.length === 1 ? 'category has' : 'categories have'} no resolution time (SLA)` });
  }
  const noAreas = (input.employees ?? []).filter((e) => active(e) &&
    !((e.jurisdictions as Row[] | undefined) ?? []).some((j) => j && j.isActive !== false && j.boundary));
  if (noAreas.length) {
    out.push({ id: 'employees-no-areas', count: noAreas.length, to: '/manage/employees',
      text: `${noAreas.length} active ${noAreas.length === 1 ? 'employee covers' : 'employees cover'} no area, so they see no complaints` });
  }
  const inactive = (input.tenantsListed ?? 0) - (input.tenantsActive ?? 0);
  if (input.tenantsListed !== undefined && input.tenantsActive !== undefined && inactive > 0) {
    out.push({ id: 'tenants-inactive', count: inactive, to: '/manage/tenants',
      text: `${inactive} ${inactive === 1 ? 'tenant is' : 'tenants are'} inactive (shown in the Tenants list)` });
  }
  return out;
}
