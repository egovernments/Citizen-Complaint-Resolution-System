/**
 * Policy rows (design screen 4): the MDMS JSON behind one role, read only. Exactly the existing rows the engines
 * compile (rbac-opa build) and pgr reads: nothing here is derived policy, only the rows and the parts of shared rows
 * that name the role. Each section carries its schema and row id so it can be found in MDMS.
 */
import type { Loaded } from './roleEditorData';
import { ROLES, ROLEACTIONS, ACTIONS, RESOURCE_ATTRS } from './roleEditorData';

export interface RowSection { title: string; schema: string; id: string; json: unknown; note?: string }

const mentions = (v: unknown, role: string) => JSON.stringify(v ?? null).includes(`"${role}"`);

export function policyRows(l: Loaded, role: string): RowSection[] {
  const out: RowSection[] = [];
  if (l.role) out.push({ title: 'The role', schema: ROLES, id: l.role.uniqueIdentifier, json: l.role.data });
  const grants = l.grants.filter((g) => g.isActive !== false);
  out.push({
    title: 'What it may call', schema: ROLEACTIONS, id: `${role}.*`,
    json: grants.map((g) => ({ ...g.data, '//': l.actions.find((a) => a.id === Number(g.data.actionid))?.url })),
    note: `${grants.length} active row(s); "//" is the action's URL, for reading (not stored)`,
  });
  const a = l.searchAction;
  const complaint = (a?.data as any)?.resource?.complaint;
  if (a && complaint?.scope) {
    out.push({
      title: `Action ${a.uniqueIdentifier} · which complaints (scope)`, schema: ACTIONS, id: a.uniqueIdentifier,
      json: { axes: complaint.scope.axes, roleScopes: { [role]: complaint.scope.roleScopes?.[role] ?? '(not stated: the default applies)' }, default: complaint.scope.default },
      note: 'only this role\'s entry of roleScopes is shown; the row holds every role\'s',
    });
  }
  if (a && complaint?.attributes) {
    out.push({ title: `Action ${a.uniqueIdentifier} · which fields (masking)`, schema: ACTIONS, id: a.uniqueIdentifier, json: complaint.attributes,
      note: 'shared by every role that searches complaints; a branch {"in":["<ROLE>",{"var":"user.roles"}]} is one role\'s' });
  }
  for (const m of l.mastersActions ?? []) {
    const masters = (m.data as any)?.resource?.masters ?? {};
    const named = Object.fromEntries(Object.entries(masters).filter(([, v]) => mentions(v, role)));
    if (Object.keys(named).length) out.push({ title: `Action ${m.uniqueIdentifier} · which settings (masters)`, schema: ACTIONS, id: m.uniqueIdentifier, json: { masters: named }, note: 'only the masters whose condition names this role' });
  }
  if (l.workflow) {
    // the workflow service stores nextState as the target state's uuid: show the state's name
    const byUuid = new Map((l.workflow.states ?? []).map((s) => [String((s as any).uuid ?? ''), s.state]));
    const steps = (l.workflow.states ?? []).flatMap((s) => (s.actions ?? []).filter((x) => (x.roles ?? []).includes(role))
      .map((x) => ({ state: s.state, action: x.action, nextState: byUuid.get(String(x.nextState)) ?? x.nextState })));
    out.push({ title: `Workflow ${l.workflow.businessService} · actions this role takes`, schema: 'egov-workflow-v2 BusinessService', id: l.workflow.businessService, json: steps, note: steps.length ? undefined : 'none' });
  }
  if (l.catalogue.length) out.push({ title: 'Complaint attributes (the filter\'s vocabulary)', schema: RESOURCE_ATTRS, id: 'complaint.*', json: l.catalogue.filter((c: any) => c.resource === 'complaint') });
  return out;
}
