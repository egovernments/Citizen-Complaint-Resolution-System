/**
 * ours (#1945): the words of the "overridden in a county" notice. At a state root, a county that holds its own row of a
 * county-scoped master (or its own boundary tree) uses that, never the state's: an edit here does not reach it.
 */
export interface OverrideTenant { tenantId: string; name: string; uniqueIdentifier?: string }

/** "Bomet", "Bomet and Nairobi", "Bomet, Kericho and Nairobi". */
export function namesText(tenants: OverrideTenant[]): string {
  const names = tenants.map((t) => t.name || t.tenantId);
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** On one record (edit / show). */
export function recordNotice(tenants: OverrideTenant[]): string {
  return `Overridden in ${namesText(tenants)}: this value isn't used there.`;
}

/** On a boundary tree. */
export function treeNotice(tenants: OverrideTenant[], hierarchyType: string): string {
  return `Overridden in ${namesText(tenants)}: ${tenants.length > 1 ? 'they use their own' : 'it uses its own'} ${hierarchyType} boundary tree, so changes here aren't used there.`;
}

/** On a list: how many of the rows here are overridden somewhere below. */
export function listNotice(overridden: number, total: number): string {
  return `${overridden} of the ${total} record${total === 1 ? '' : 's'} shown ${overridden === 1 ? 'is' : 'are'} overridden in a county: ` +
    `${overridden === 1 ? 'that value isn\'t' : 'those values aren\'t'} used there.`;
}

/** The path that opens the county's own record of the same resource. */
export function recordPath(resource: string, t: OverrideTenant): string {
  return `/manage/${resource}/${encodeURIComponent(t.uniqueIdentifier ?? '')}/show`;
}

const AFTER_SWITCH_KEY = 'configurator:after-switch';

/** Remember where to land once the tenant switch has reloaded /manage (one shot). */
export function rememberLanding(path: string): void {
  try { sessionStorage.setItem(AFTER_SWITCH_KEY, path); } catch { /* storage blocked: the switch lands on /manage */ }
}

/** The remembered landing, consumed; only a /manage path is honoured. */
export function takeLanding(): string | null {
  try {
    const p = sessionStorage.getItem(AFTER_SWITCH_KEY);
    sessionStorage.removeItem(AFTER_SWITCH_KEY);
    return p && /^\/manage\//.test(p) ? p : null;
  } catch { return null; }
}
