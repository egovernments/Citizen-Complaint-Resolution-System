/**
 * ours (#1954, owner 2026-10-15): at a state whose boundaries live in its counties, the state admin manages a county's
 * own tree after choosing the county. Only the counties the admin can enter are offered - the rule of the employee
 * app's File a Complaint picker (#1857): a role at the county or at an ancestor of it.
 */
export interface County { code: string; name: string }
export interface Membership { tenantId?: unknown; roles?: unknown; code?: unknown }

/** True when a membership at `at` lets its holder enter `tenant` (the tenant itself or a descendant of it). */
const covers = (at: string, tenant: string) => tenant === at || tenant.startsWith(`${at}.`);

/**
 * The counties the admin can enter. `memberships` null = no identity session (a form / token sign-in): the server
 * decides on entry, every county is offered.
 */
export function enterableCounties(counties: County[], memberships: Membership[] | null): County[] {
  if (memberships === null) return counties;
  const at = memberships
    .filter((m) => typeof m.tenantId === 'string' && m.tenantId && m.code !== 'DIGIT_ACCOUNT_INACTIVE'
      && (!Array.isArray(m.roles) || m.roles.length > 0))
    .map((m) => String(m.tenantId).toLowerCase());
  return counties.filter((c) => at.some((t) => covers(t, c.code.toLowerCase())));
}

/** The picker shows only at a state root that has counties. */
export function asksForCounty(tenant: string, counties: County[]): boolean {
  return !!tenant && !tenant.includes('.') && counties.length > 0;
}
