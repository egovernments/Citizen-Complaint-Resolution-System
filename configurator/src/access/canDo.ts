import { CAPABILITIES, capabilityState, type ActionRow } from './policyModel';

/** Short names for the role list's "Can do" column (the Role editor shows the long ones). */
export const SHORT: Record<string, string> = {
  search: 'View', update: 'Act', create: 'File', dashboard: 'Dashboard', employees: 'Look up staff', manageEmployees: 'Manage staff',
};

export interface GrantRow { rolecode?: unknown; actionid?: unknown; active?: boolean }

/**
 * Per role: the complaint capabilities it holds, as the Role editor counts them (every action of the capability
 * granted = on; some = partial, shown with "(part)"). Inactive role-action rows do not count.
 */
export function canDoByRole(actions: ActionRow[], grants: GrantRow[]): Map<string, string[]> {
  const held = new Map<string, Set<number>>();
  for (const g of grants) {
    if (g.active === false) continue;
    const role = String(g.rolecode ?? '');
    const id = Number(g.actionid);
    if (!role || !Number.isFinite(id)) continue;
    if (!held.has(role)) held.set(role, new Set());
    held.get(role)!.add(id);
  }
  const out = new Map<string, string[]>();
  for (const [role, ids] of held) {
    const caps: string[] = [];
    for (const c of CAPABILITIES) {
      const st = capabilityState(c.id, actions, ids);
      if (st === 'on') caps.push(SHORT[c.id] ?? c.label);
      else if (st === 'partial') caps.push(`${SHORT[c.id] ?? c.label} (part)`);
    }
    out.set(role, caps);
  }
  return out;
}
