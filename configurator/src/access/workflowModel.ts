/**
 * Workflow actions by complaint status for one role (design screen 1, last section): the PGR business service's
 * states x actions, and whether the role is in that action's `roles`. Edits change ONLY this role's membership in
 * `action.roles`; states, transitions, SLAs and every other role stay byte-identical. Written back over the workflow
 * service's businessservice/_update (as patch 11's Edit Workflow Roles).
 */

export interface WfAction { action: string; roles?: string[]; nextState?: string; [k: string]: unknown }
export interface WfState { state?: string | null; applicationStatus?: string | null; actions?: WfAction[] | null; [k: string]: unknown }
export interface BusinessService { businessService: string; tenantId: string; states: WfState[]; [k: string]: unknown }

/** Actions a person never takes in an employee's role (the citizen's own, the system's). */
export const NOT_FOR_STAFF = new Set(['APPLY', 'COMMENT', 'RATE']);

const STATUS_LABEL: Record<string, string> = {
  PENDINGFORASSIGNMENT: 'Pending for assignment', PENDINGFORREASSIGNMENT: 'Pending for reassignment', PENDINGATLME: 'Pending at field officer',
  REJECTED: 'Rejected', RESOLVED: 'Resolved', CLOSEDAFTERREJECTION: 'Closed after rejection', CLOSEDAFTERRESOLUTION: 'Closed after resolution', CANCELLED: 'Cancelled',
};
export const statusLabel = (s: string) => STATUS_LABEL[s] ?? s;

export interface Grid { statuses: string[]; actions: string[]; cell: (status: string, action: string) => 'on' | 'off' | null }

export function roleGrid(bs: BusinessService | null, role: string): Grid {
  const states = (bs?.states ?? []).filter((s) => s.state && (s.actions ?? []).some((a) => !NOT_FOR_STAFF.has(a.action)));
  const actions = [...new Set(states.flatMap((s) => (s.actions ?? []).map((a) => a.action)).filter((a) => !NOT_FOR_STAFF.has(a)))];
  return {
    statuses: states.map((s) => s.state as string),
    actions,
    cell: (status, action) => {
      const a = states.find((s) => s.state === status)?.actions?.find((x) => x.action === action);
      return a ? ((a.roles ?? []).includes(role) ? 'on' : 'off') : null;
    },
  };
}

export type WfEdit = Record<string, boolean>; // `${status}|${action}` -> wanted
export const cellKey = (status: string, action: string) => `${status}|${action}`;

/** A copy with this role added to / removed from the edited actions' roles; null when nothing changes. */
export function withRoleActions(bs: BusinessService, role: string, edits: WfEdit): { next: BusinessService; changes: { status: string; action: string; on: boolean }[] } | null {
  const next = JSON.parse(JSON.stringify(bs)) as BusinessService;
  const changes: { status: string; action: string; on: boolean }[] = [];
  for (const [key, on] of Object.entries(edits)) {
    const [status, action] = key.split('|');
    const a = next.states.find((s) => s.state === status)?.actions?.find((x) => x.action === action);
    if (!a) throw new Error(`WORKFLOW_NO_SUCH_ACTION: ${action} is not an action in ${status}`);
    const roles = a.roles ?? [];
    const has = roles.includes(role);
    if (on && !has) a.roles = [...roles, role];
    else if (!on && has) a.roles = roles.filter((r) => r !== role);
    else continue;
    changes.push({ status, action, on });
  }
  return changes.length ? { next, changes } : null;
}

/** The workflow service answers with audit fields and computed ids; compare what an edit can change. */
export function sameDefinition(a: BusinessService | null | undefined, b: BusinessService | null | undefined): boolean {
  const norm = (bs: BusinessService | null | undefined) => JSON.stringify((bs?.states ?? []).map((s) => [s.state, (s.actions ?? []).map((x) => [x.action, x.nextState, [...(x.roles ?? [])].sort()])]));
  return norm(a) === norm(b);
}
