/**
 * ours (cfgreview F04, #1551): which tenants the header's switcher offers. The admin's HOME tenant (where they first
 * worked in this browser) and every active tenant below it, in tree order, labelled by name.
 */
export interface TenantRow { code?: unknown; name?: unknown }
export interface TenantOption { code: string; name: string; depth: number }

export function subtreeOptions(rows: TenantRow[], home: string): TenantOption[] {
  const base = home.split('.').length;
  const seen = new Set<string>();
  const out: TenantOption[] = [];
  for (const r of rows) {
    const code = String(r.code ?? '').trim();
    if (!code || seen.has(code)) continue;
    if (code !== home && !code.startsWith(`${home}.`)) continue;
    seen.add(code);
    const name = typeof r.name === 'string' && r.name.trim() ? r.name.trim() : code;
    out.push({ code, name, depth: code.split('.').length - base });
  }
  if (!seen.has(home)) out.push({ code: home, name: home, depth: 0 });
  return out.sort((a, b) => a.code.localeCompare(b.code));
}

/** The name of a tenant for the header, else its code. */
export function tenantLabel(options: TenantOption[], code: string): string {
  return options.find((o) => o.code === code)?.name ?? code;
}

export interface MembershipRow { tenantId?: unknown; roles?: unknown; code?: unknown }
const ADMIN_ROLES = new Set(['ACCOUNT_ADMIN', 'SUPERUSER']);

/**
 * The admin's home tenant from their identity memberships (the tenants they may enter, with roles): the highest tenant
 * (fewest code segments) where they hold ACCOUNT_ADMIN / SUPERUSER; else the highest tenant they may enter. Null when
 * the session has no memberships (no identity session) - callers then fall back to homeTenant().
 */
export function adminHome(memberships: MembershipRow[]): string | null {
  const usable = memberships
    .filter((m) => typeof m.tenantId === 'string' && m.tenantId && m.code !== 'DIGIT_ACCOUNT_INACTIVE')
    .map((m) => ({ tenant: String(m.tenantId), roles: Array.isArray(m.roles) ? (m.roles as unknown[]).map(String) : [] }));
  if (!usable.length) return null;
  const depth = (t: string) => t.split('.').length;
  const pick = (rows: typeof usable) =>
    rows.sort((a, b) => depth(a.tenant) - depth(b.tenant) || a.tenant.localeCompare(b.tenant))[0]?.tenant ?? null;
  return pick(usable.filter((u) => u.roles.some((r) => ADMIN_ROLES.has(r)))) ?? pick(usable);
}

/** One option's text: an em-dash per level (a native select collapses leading spaces), then name and code. */
export function optionText(o: TenantOption): string {
  return `${'— '.repeat(o.depth)}${o.name} (${o.code})`;
}

const HOME_KEY = (user: string) => `configurator:home-tenant:${user}`;

/** The admin's home tenant: remembered the first time a user works in this browser, so a switch never shrinks the list. */
export function homeTenant(user: string, current: string): string {
  try {
    const saved = localStorage.getItem(HOME_KEY(user));
    // a saved home that the current tenant is not under (another account, a new login elsewhere) is replaced
    if (saved && (current === saved || current.startsWith(`${saved}.`))) return saved;
    localStorage.setItem(HOME_KEY(user), current);
  } catch { /* storage blocked: the current tenant is the home */ }
  return current;
}
