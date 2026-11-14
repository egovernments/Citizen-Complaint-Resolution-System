/**
 * ours (cfgreview F28, #1574): what on this tenant needs an administrator, each with where to fix it. Only items with
 * something to do are returned.
 */
import { tenantSubtree } from './cardScope';

export interface AttentionItem { id: string; text: string; to: string; count: number }

type Row = Record<string, unknown>;

const active = (r: Row) => r.isActive !== false && r._isActive !== false && r.active !== false;

/**
 * tenants: every tenant.tenants row (they all live at the state, inactive ones too); only `tenant` and the tenants
 * below it count, so a county is not told about the state's inactive tenants.
 */
export function attentionItems(input: { tenant?: string; categories?: Row[]; employees?: Row[]; tenants?: Row[] }): AttentionItem[] {
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
  const inactive = input.tenant && input.tenants ? tenantSubtree(input.tenant, input.tenants).inactive : 0;
  if (inactive > 0) {
    out.push({ id: 'tenants-inactive', count: inactive, to: '/manage/tenants',
      text: `${inactive} ${inactive === 1 ? 'tenant' : 'tenants'} at ${input.tenant} or below ${inactive === 1 ? 'is' : 'are'} inactive (shown in the Tenants list)` });
  }
  return out;
}
