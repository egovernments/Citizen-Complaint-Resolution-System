/**
 * Role editor I/O: reads the rows behind one role, turns the edited state into a save PLAN (what will be written,
 * shown to the admin as a diff before anything is sent) and applies it. Writes go through the existing mdms-v2
 * create/update only, at the state root where these shared masters live.
 *
 * Safe writes: the complaint-search action row is shared by every role, so it is re-read right before the write;
 * if anyone changed it since the screen loaded it (lastModifiedTime differs), nothing more is written and the admin
 * is asked to reload. Only this role's keys change (policyModel.withRoleScope / withRoleFieldRule).
 */
import type { MdmsRecord } from '@digit-mcp/data-provider';
import {
  actionsOf, changedPaths, roleActionUid, withRoleFieldRule, withRoleScope,
  type ActionRow, type Clause, type OnDeny, type RoleScope, type VarDef, BASE_VARS,
} from './policyModel';
import { roleGrid, sameDefinition, withRoleActions, type BusinessService, type WfEdit } from './workflowModel';
import { WORKFLOW_CAPABILITIES } from './policyModel';

export const ROLES = 'ACCESSCONTROL-ROLES.roles';
export const ROLEACTIONS = 'ACCESSCONTROL-ROLEACTIONS.roleactions';
export const ACTIONS = 'ACCESSCONTROL-ACTIONS-TEST.actions-test';
export const RESOURCE_ATTRS = 'ACCESSCONTROL-RESOURCE.attributes';
export const COMPLAINT_SEARCH_URL = '/pgr-services/v2/request/_search';
export const ROLE_CODE = /^[A-Z][A-Z0-9_]{1,63}$/;

/** The part of DigitApiClient this module uses (a fake in tests). */
export interface MdmsClient {
  mdmsSearch(tenantId: string, schemaCode: string, options?: { limit?: number; offset?: number; uniqueIdentifiers?: string[]; isActive?: boolean }): Promise<MdmsRecord[]>;
  mdmsCreate(tenantId: string, schemaCode: string, uniqueIdentifier: string, data: Record<string, unknown>): Promise<MdmsRecord>;
  mdmsUpdate(record: MdmsRecord, isActive: boolean): Promise<MdmsRecord>;
  /** the PGR workflow definition (workflow actions by status); optional so a reader without it still loads */
  workflowBusinessServiceSearch?(tenantId: string, businessServices?: string[]): Promise<Record<string, unknown>[]>;
  workflowBusinessServiceUpdate?(businessService: Record<string, unknown>): Promise<Record<string, unknown>>;
  /** generic call (DigitApiClient.request), used for pgr's access refresh */
  request?<T = unknown>(path: string, body: Record<string, unknown>): Promise<T>;
  buildRequestInfo?(): unknown;
}

export const ACCESS_REFRESH_PATH = '/pgr-services/v2/access/_refresh';
export type RefreshOutcome = 'refreshed' | 'unavailable' | 'not needed';

/**
 * After an action / role-action write: pgr clears its access-control cache and asks for an OPA bundle rebuild
 * (cms-access #1504), so the change reaches searches at once instead of after the cache expires. Best effort: a stack
 * without the endpoint (or a refusal) never fails the save; the caller says which delay applies.
 */
export async function refreshAccess(c: MdmsClient, plan: Write[]): Promise<RefreshOutcome> {
  if (!plan.some((w) => w.kind === 'action' || w.kind === 'grant')) return 'not needed';
  if (!c.request) return 'unavailable';
  try {
    const r = await c.request<{ accesscontrolCache?: string }>(ACCESS_REFRESH_PATH, { RequestInfo: c.buildRequestInfo?.() ?? {} });
    return r?.accesscontrolCache === 'cleared' ? 'refreshed' : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

export const WORKFLOW = 'PGR';

export async function searchAll(c: MdmsClient, tenant: string, schema: string, extra: { isActive?: boolean } = {}): Promise<MdmsRecord[]> {
  const out: MdmsRecord[] = [];
  for (let offset = 0; offset < 20_000; offset += 500) {
    const page = await c.mdmsSearch(tenant, schema, { limit: 500, offset, ...extra });
    out.push(...page);
    if (page.length < 500) return out;
  }
  throw new Error(`${schema}: more than 20000 rows, refusing a partial read`);
}

export interface Loaded {
  root: string;
  role: MdmsRecord | null;                 // null = a new role
  actions: ActionRow[];
  grants: MdmsRecord[];                    // this role's role-action rows (active and inactive)
  searchAction: MdmsRecord | null;         // the complaint-search action row (scope + field rules)
  catalogue: Record<string, unknown>[];    // ACCESSCONTROL-RESOURCE.attributes rows (optional master)
  workflow: BusinessService | null;        // the PGR business service at the root (null: not readable here)
  mastersActions?: MdmsRecord[];           // actions carrying resource.masters conditions (Policy rows, read only)
}

export async function loadRole(c: MdmsClient, root: string, code: string | null): Promise<Loaded> {
  const [roles, actionRecs, grants, catalogue, workflows] = await Promise.all([
    code ? c.mdmsSearch(root, ROLES, { uniqueIdentifiers: [code] }) : Promise.resolve([]),
    searchAll(c, root, ACTIONS),
    code ? searchAll(c, root, ROLEACTIONS) : Promise.resolve([]),
    searchAll(c, root, RESOURCE_ATTRS).catch(() => [] as MdmsRecord[]),
    c.workflowBusinessServiceSearch ? c.workflowBusinessServiceSearch(root, [WORKFLOW]).catch(() => []) : Promise.resolve([]),
  ]);
  const actions = actionRecs.map((r) => ({ id: Number(r.data.id), url: String(r.data.url ?? ''), displayName: r.data.displayName as string | undefined }))
    .filter((a) => Number.isFinite(a.id));
  return {
    root,
    role: roles.find((r) => r.data.code === code) ?? null,
    actions,
    grants: grants.filter((g) => g.data.rolecode === code),
    searchAction: actionRecs.find((r) => r.data.url === COMPLAINT_SEARCH_URL && r.isActive !== false) ?? null,
    catalogue: catalogue.filter((r) => r.isActive !== false).map((r) => r.data),
    mastersActions: actionRecs.filter((r) => (r.data as any)?.resource?.masters && r.isActive !== false),
    workflow: ((workflows as unknown[]).find((b: any) => b?.businessService === WORKFLOW) as BusinessService | undefined) ?? null,
  };
}

export interface Edited {
  code: string;
  name: string;
  description: string;
  caps: Record<string, boolean>;                         // capability id -> wanted (absent = unchanged)
  scope: RoleScope | null;                               // null = leave the role's scope as it is
  fields: Record<string, { clause: Clause | null; onDeny?: OnDeny } | undefined>; // path -> the role's branch (undefined = unchanged)
  workflow?: WfEdit;                                     // `${status}|${action}` -> the role takes it (absent = unchanged)
}

export type Write =
  | { kind: 'role'; op: 'create' | 'update'; uid: string; data: Record<string, unknown> }
  | { kind: 'grant'; op: 'create'; uid: string; data: Record<string, unknown> }
  | { kind: 'grant'; op: 'activate' | 'deactivate'; uid: string; record: MdmsRecord }
  | { kind: 'action'; op: 'update'; uid: string; data: Record<string, unknown>; changes: ReturnType<typeof changedPaths> }
  | { kind: 'workflow'; op: 'update'; uid: string; role: string; next: BusinessService; changes: { status: string; action: string; on: boolean }[] };

export function planSave(l: Loaded, e: Edited, vocab: VarDef[] = BASE_VARS): Write[] {
  if (!ROLE_CODE.test(e.code)) throw new Error('ROLE_CODE: upper case letters, digits and _ (2 to 64), starting with a letter');
  if (!e.name.trim()) throw new Error('ROLE_NAME: a role needs a name');
  const writes: Write[] = [];
  const roleData = { code: e.code, name: e.name.trim(), ...(e.description.trim() ? { description: e.description.trim() } : {}) };
  if (!l.role) writes.push({ kind: 'role', op: 'create', uid: e.code, data: roleData });
  else if (changedPaths({ ...l.role.data }, { ...l.role.data, ...roleData }).length) writes.push({ kind: 'role', op: 'update', uid: e.code, data: { ...l.role.data, ...roleData } });

  const byAction = new Map(l.grants.map((g) => [Number(g.data.actionid), g]));
  const wantIds = new Map<number, boolean>();
  for (const [cap, want] of Object.entries(e.caps)) for (const a of actionsOf(cap, l.actions)) {
    // an action shared by two capabilities stays granted while either wants it
    wantIds.set(a.id, (wantIds.get(a.id) ?? false) || want);
  }
  for (const [id, want] of [...wantIds].sort((a, b) => a[0] - b[0])) {
    const g = byAction.get(id);
    const uid = roleActionUid(e.code, id);
    if (want && !g) writes.push({ kind: 'grant', op: 'create', uid, data: { rolecode: e.code, actionid: id, actioncode: '', tenantId: l.root } });
    else if (want && g && g.isActive === false) writes.push({ kind: 'grant', op: 'activate', uid, record: g });
    else if (!want && g && g.isActive !== false) writes.push({ kind: 'grant', op: 'deactivate', uid, record: g });
  }

  const fieldEdits = Object.entries(e.fields).filter(([, f]) => f !== undefined);
  if (e.scope || fieldEdits.length) {
    if (!l.searchAction) throw new Error('NO_SEARCH_ACTION: the complaint search action is missing at this tenant');
    let data = l.searchAction.data;
    if (e.scope) data = withRoleScope(data, e.code, e.scope);
    for (const [path, f] of fieldEdits) data = withRoleFieldRule(data, path, e.code, f!.clause, f!.onDeny, vocab);
    const changes = changedPaths(l.searchAction.data, data);
    if (changes.length) writes.push({ kind: 'action', op: 'update', uid: l.searchAction.uniqueIdentifier, data, changes });
  }
  const wfEdits = workflowEdits(l, e);
  if (Object.keys(wfEdits).length) {
    if (!l.workflow) throw new Error(`NO_WORKFLOW: the ${WORKFLOW} workflow is not readable at ${l.root}`);
    const w = withRoleActions(l.workflow, e.code, wfEdits);
    if (w) writes.push({ kind: 'workflow', op: 'update', uid: WORKFLOW, role: e.code, next: w.next, changes: w.changes });
  }
  return writes;
}

/**
 * The workflow ticks to write: the grid's own edits, plus, when a capability that the workflow's actions need is
 * switched OFF (WORKFLOW_CAPABILITIES, e.g. "act on complaints"), every action the role holds is unticked in the same
 * save, so the app stops offering an action the gateway now refuses. A capability off always wins over a tick.
 */
export function workflowEdits(l: Loaded, e: Edited): WfEdit {
  const out: WfEdit = { ...(e.workflow ?? {}) };
  const off = WORKFLOW_CAPABILITIES.some((cap) => e.caps[cap] === false);
  if (off && l.workflow) {
    const g = roleGrid(l.workflow, e.code);
    for (const st of g.statuses) for (const a of g.actions) {
      const k = `${st}|${a}`;
      if (g.cell(st, a) === 'on' || out[k] === true) out[k] = false;
    }
  }
  return out;
}

export class ConcurrentChangeError extends Error {
  constructor(what: string) { super(`CHANGED_SINCE_LOADED: ${what} was changed by someone else since this page loaded; reload and redo your change`); }
}

/**
 * Applies a plan in order: the shared action row FIRST (it is the one that can conflict, and nothing else has been
 * written when it does), then the role, then its grants. Returns what was written.
 */
export async function applySave(c: MdmsClient, l: Loaded, plan: Write[]): Promise<string[]> {
  const done: string[] = [];
  const action = plan.find((w) => w.kind === 'action') as Extract<Write, { kind: 'action' }> | undefined;
  const wf = plan.find((w) => w.kind === 'workflow') as Extract<Write, { kind: 'workflow' }> | undefined;
  // the shared rows (every role's): re-read BOTH and refuse on any change since load, before writing anything
  const freshAction = action ? (await c.mdmsSearch(l.root, ACTIONS, { uniqueIdentifiers: [action.uid] }))[0] : undefined;
  if (action && (!freshAction || freshAction.auditDetails?.lastModifiedTime !== l.searchAction?.auditDetails?.lastModifiedTime
      || JSON.stringify(freshAction.data) !== JSON.stringify(l.searchAction?.data))) {
    throw new ConcurrentChangeError(`action ${action.uid} (complaint search)`);
  }
  const freshWf = wf && c.workflowBusinessServiceSearch
    ? ((await c.workflowBusinessServiceSearch(l.root, [WORKFLOW])) as unknown as BusinessService[]).find((b) => b.businessService === WORKFLOW) : undefined;
  if (wf && (!freshWf || !sameDefinition(freshWf, l.workflow))) throw new ConcurrentChangeError(`the ${WORKFLOW} workflow`);
  if (action && freshAction) {
    await c.mdmsUpdate({ ...freshAction, data: action.data }, true);
    done.push(`action ${action.uid}`);
  }
  if (wf && freshWf) {
    const next = withRoleActions(freshWf, wf.role, Object.fromEntries(wf.changes.map((x) => [`${x.status}|${x.action}`, x.on])));
    if (next) await c.workflowBusinessServiceUpdate!(next.next as unknown as Record<string, unknown>);
    done.push(`workflow ${WORKFLOW}`);
  }
  for (const w of plan) {
    if (w.kind === 'role') {
      if (w.op === 'create') await c.mdmsCreate(l.root, ROLES, w.uid, w.data);
      else await c.mdmsUpdate({ ...l.role!, data: w.data }, true);
      done.push(`role ${w.uid}`);
    } else if (w.kind === 'grant') {
      if (w.op === 'create') await c.mdmsCreate(l.root, ROLEACTIONS, w.uid, w.data);
      else await c.mdmsUpdate(w.record, w.op === 'activate');
      done.push(`grant ${w.uid} ${w.op}`);
    }
  }
  return done;
}
