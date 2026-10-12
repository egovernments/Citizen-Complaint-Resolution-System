import type { MdmsRecord } from '@digit-mcp/data-provider';
import { ACTIONS, ROLEACTIONS, ROLES, ConcurrentChangeError, applySave, loadRole, planSave, type MdmsClient } from './roleEditorData';
import { PRESETS } from './policyModel';

const rec = (schemaCode: string, uniqueIdentifier: string, data: Record<string, unknown>, isActive = true, t = 1): MdmsRecord =>
  ({ id: `${schemaCode}:${uniqueIdentifier}`, tenantId: 'ke', schemaCode, uniqueIdentifier, data, isActive, auditDetails: { createdBy: 'a', createdTime: 1, lastModifiedBy: 'a', lastModifiedTime: t } });

function fakeMdms(rows: MdmsRecord[]) {
  const db = new Map(rows.map((r) => [`${r.schemaCode}|${r.uniqueIdentifier}`, r]));
  const calls: string[] = [];
  const c: MdmsClient = {
    async mdmsSearch(_t, schema, o) {
      const all = [...db.values()].filter((r) => r.schemaCode === schema && (!o?.uniqueIdentifiers || o.uniqueIdentifiers.includes(r.uniqueIdentifier)));
      return all.slice(o?.offset ?? 0, (o?.offset ?? 0) + (o?.limit ?? 100));
    },
    async mdmsCreate(_t, schema, uid, data) {
      calls.push(`create ${schema} ${uid}`);
      if (db.has(`${schema}|${uid}`)) throw new Error('MDMS_DUPLICATE');
      const r = rec(schema, uid, data); db.set(`${schema}|${uid}`, r); return r;
    },
    async mdmsUpdate(r, isActive) {
      calls.push(`update ${r.schemaCode} ${r.uniqueIdentifier} ${isActive}`);
      const n = { ...r, isActive, auditDetails: { ...r.auditDetails!, lastModifiedTime: (r.auditDetails?.lastModifiedTime ?? 0) + 1 } };
      db.set(`${r.schemaCode}|${r.uniqueIdentifier}`, n); return n;
    },
  };
  return { c, db, calls };
}

const seed = () => [
  rec(ACTIONS, '2008', { id: 2008, url: '/pgr-services/v2/request/_search', resource: { complaint: { scope: { axes: ['department', 'jurisdiction'], roleScopes: { GRO: { department: 'OWN', jurisdiction: 'OWN' } }, default: { department: 'OWN', jurisdiction: 'OWN' } } } } }),
  rec(ACTIONS, '2009', { id: 2009, url: '/pgr-services/v2/request/_count' }),
  rec(ACTIONS, '2031', { id: 2031, url: '/pgr-services/v2/request/_update' }),
  rec(ROLES, 'GRO', { code: 'GRO', name: 'Grievance officer' }),
  rec(ROLEACTIONS, 'GRO.2008', { rolecode: 'GRO', actionid: 2008, tenantId: 'ke' }),
];

const edited = {
  code: 'SUBCOUNTY_GRO', name: 'Sub-county grievance officer', description: 'test',
  caps: { search: true, update: true }, scope: { jurisdiction: 'OWN' as const, department: 'ALL' as const },
  fields: { 'citizen.mobileNumber': { clause: PRESETS.find((p) => p.id === 'assigned')!.clause, onDeny: { strategy: 'MASK_SHOW_LAST_N' as const, n: 3, maskChar: 'X' } } },
};

describe('role editor save', () => {
  it('creates a role, its grants and its branch of action 2008, action first', async () => {
    const { c, db, calls } = fakeMdms(seed());
    const l = await loadRole(c, 'ke', null);
    const plan = planSave(l, edited);
    expect(plan.map((w) => `${w.kind} ${w.op} ${w.uid}`)).toEqual([
      'role create SUBCOUNTY_GRO', 'grant create SUBCOUNTY_GRO.2008', 'grant create SUBCOUNTY_GRO.2009', 'grant create SUBCOUNTY_GRO.2031', 'action update 2008',
    ]);
    await applySave(c, l, plan);
    expect(calls[0]).toBe(`update ${ACTIONS} 2008 true`);
    const a = db.get(`${ACTIONS}|2008`)!.data as any;
    expect(a.resource.complaint.scope.roleScopes).toEqual({ GRO: { department: 'OWN', jurisdiction: 'OWN' }, SUBCOUNTY_GRO: { department: 'ALL', jurisdiction: 'OWN' } });
    expect(a.resource.complaint.attributes['citizen.mobileNumber'].onDeny).toEqual({ strategy: 'MASK_SHOW_LAST_N', n: 3, maskChar: 'X' });
    expect(db.get(`${ROLEACTIONS}|SUBCOUNTY_GRO.2031`)!.data).toEqual({ rolecode: 'SUBCOUNTY_GRO', actionid: 2031, actioncode: '', tenantId: 'ke' });
  });

  it('a second save with nothing changed writes nothing', async () => {
    const { c } = fakeMdms(seed());
    await applySave(c, await loadRole(c, 'ke', null), planSave(await loadRole(c, 'ke', null), edited));
    const l2 = await loadRole(c, 'ke', 'SUBCOUNTY_GRO');
    expect(planSave(l2, edited)).toEqual([]);
  });

  it('turning a capability off deactivates (never deletes) its grants; on again reactivates', async () => {
    const { c, db } = fakeMdms(seed());
    await applySave(c, await loadRole(c, 'ke', null), planSave(await loadRole(c, 'ke', null), edited));
    let l = await loadRole(c, 'ke', 'SUBCOUNTY_GRO');
    await applySave(c, l, planSave(l, { ...edited, caps: { update: false } }));
    expect(db.get(`${ROLEACTIONS}|SUBCOUNTY_GRO.2031`)!.isActive).toBe(false);
    l = await loadRole(c, 'ke', 'SUBCOUNTY_GRO');
    expect(planSave(l, { ...edited, caps: { update: true } }).map((w) => `${w.op} ${w.uid}`)).toEqual(['activate SUBCOUNTY_GRO.2031']);
  });

  it('refuses when action 2008 changed after the page loaded, and writes nothing', async () => {
    const { c, db, calls } = fakeMdms(seed());
    const l = await loadRole(c, 'ke', null);
    const other = db.get(`${ACTIONS}|2008`)!;
    db.set(`${ACTIONS}|2008`, { ...other, data: { ...other.data, displayName: 'changed elsewhere' }, auditDetails: { ...other.auditDetails!, lastModifiedTime: 99 } });
    await expect(applySave(c, l, planSave(l, edited))).rejects.toBeInstanceOf(ConcurrentChangeError);
    expect(calls).toEqual([]);
  });

  it('validates the code and name', async () => {
    const { c } = fakeMdms(seed());
    const l = await loadRole(c, 'ke', null);
    expect(() => planSave(l, { ...edited, code: 'bad code' })).toThrow(/ROLE_CODE/);
    expect(() => planSave(l, { ...edited, name: ' ' })).toThrow(/ROLE_NAME/);
  });
});

describe('role editor save: workflow actions by status', () => {
  const pgr = () => ({ businessService: 'PGR', tenantId: 'ke', states: [
    { state: 'PENDINGFORASSIGNMENT', actions: [{ action: 'ASSIGN', roles: ['GRO'], nextState: 'PENDINGATLME' }, { action: 'REJECT', roles: ['GRO'], nextState: 'REJECTED' }] },
    { state: 'PENDINGATLME', actions: [{ action: 'RESOLVE', roles: ['PGR_LME'], nextState: 'RESOLVED' }] },
  ] });
  const withWorkflow = (store: { bs: any }) => {
    const f = fakeMdms(seed());
    const updates: any[] = [];
    f.c.workflowBusinessServiceSearch = async () => [JSON.parse(JSON.stringify(store.bs))];
    f.c.workflowBusinessServiceUpdate = async (b) => { updates.push(b); store.bs = b; return b; };
    return { ...f, updates };
  };
  it('writes only this role into the ticked actions, with the role', async () => {
    const store = { bs: pgr() };
    const { c, updates } = withWorkflow(store);
    const l = await loadRole(c, 'ke', null);
    const plan = planSave(l, { ...edited, workflow: { 'PENDINGFORASSIGNMENT|ASSIGN': true, 'PENDINGFORASSIGNMENT|REJECT': true } });
    expect(plan.find((w) => w.kind === 'workflow')).toMatchObject({ role: 'SUBCOUNTY_GRO', changes: [{ action: 'ASSIGN', on: true }, { action: 'REJECT', on: true }] });
    await applySave(c, l, plan);
    expect(updates).toHaveLength(1);
    expect(store.bs.states[0].actions.map((a: any) => a.roles)).toEqual([['GRO', 'SUBCOUNTY_GRO'], ['GRO', 'SUBCOUNTY_GRO']]);
    expect(store.bs.states[1].actions[0].roles).toEqual(['PGR_LME']);
  });
  it('"act on complaints" off also unticks every workflow action of the role, in the same save', async () => {
    const store = { bs: pgr() };
    store.bs.states[0].actions[0].roles.push('GRO2'); store.bs.states[1].actions[0].roles.push('GRO2');
    const { c, updates } = withWorkflow(store);
    const l = await loadRole(c, 'ke', 'GRO');
    // even a tick left on in the grid loses to the capability switched off
    const plan = planSave(l, { code: 'GRO', name: 'Grievance officer', description: '', caps: { update: false }, scope: null, fields: {}, workflow: { 'PENDINGATLME|RESOLVE': true } });
    expect(plan.find((w) => w.kind === 'workflow')).toMatchObject({ changes: [{ action: 'ASSIGN', on: false }, { action: 'REJECT', on: false }] });
    await applySave(c, l, plan);
    expect(updates).toHaveLength(1);
    expect(store.bs.states.flatMap((s: any) => s.actions.flatMap((a: any) => a.roles))).not.toContain('GRO');
    expect(store.bs.states[0].actions[0].roles).toContain('GRO2'); // other roles untouched
  });
  it('one re-read covers both shared rows: a changed workflow refuses before action 2008 is written', async () => {
    const store = { bs: pgr() };
    const { c, calls, updates } = withWorkflow(store);
    const l = await loadRole(c, 'ke', 'GRO');
    store.bs.states[1].actions[0].roles.push('SOMEONE_ELSE');
    const plan = planSave(l, { code: 'GRO', name: 'Grievance officer', description: '', caps: {}, scope: { jurisdiction: 'ALL' }, fields: {}, workflow: { 'PENDINGATLME|RESOLVE': true } });
    expect(plan.map((w) => w.kind)).toEqual(['action', 'workflow']);
    await expect(applySave(c, l, plan)).rejects.toBeInstanceOf(ConcurrentChangeError);
    expect(calls).toEqual([]);
    expect(updates).toEqual([]);
  });
  it('refuses when the workflow changed after the page loaded (nothing written to it)', async () => {
    const store = { bs: pgr() };
    const { c, updates } = withWorkflow(store);
    const l = await loadRole(c, 'ke', 'GRO');
    store.bs.states[1].actions[0].roles.push('SOMEONE_ELSE');
    await expect(applySave(c, l, planSave(l, { code: 'GRO', name: 'Grievance officer', description: '', caps: {}, scope: null, fields: {}, workflow: { 'PENDINGATLME|RESOLVE': true } })))
      .rejects.toBeInstanceOf(ConcurrentChangeError);
    expect(updates).toEqual([]);
  });
});
