import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, Loader2, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { toast } from '@/hooks/use-toast';
import { digitClient } from '@/providers/bridge';
import { useApp } from '../App';
import { AccessBreadcrumb, AccessTitle } from './AccessChrome';
import { useMastersCapability } from '@/hooks/useMastersCapability';
import {
  AXES, CAPABILITIES, KNOWN_FIELDS, PRESETS, WORKFLOW_CAPABILITIES, actionsOf, capabilityState, describeClause, effectiveScope, maskPreview,
  parseFieldRule, plainWords, scopeBlockOf, unavailableVars, vocabulary,
  type Axis, type Clause, type CatalogueRow, type Level, type OnDeny, type RoleScope,
} from './policyModel';
import { ConcurrentChangeError, applySave, loadRole, planSave, refreshAccess, type Edited, type Loaded, type Write } from './roleEditorData';
import { whenItApplies, whenItAppliesAll, type ChangeKind } from './effectTimes';
import { RolePreview } from './RolePreview';

/** Which kinds of change a save plan makes (for "when it applies"). */
export function planKinds(plan: Write[]): ChangeKind[] {
  const k: ChangeKind[] = [];
  for (const w of plan) {
    if (w.kind === 'grant') k.push('calls');
    if (w.kind === 'workflow') k.push('workflow');
    if (w.kind === 'action') for (const c of w.changes) k.push(c.path.includes('.scope.') ? 'scope' : 'fields');
  }
  return [...new Set(k)];
}
import { AVAILABLE_CONDITION_VARS } from './engineVars';
import { cellKey, roleGrid, statusLabel, type WfEdit } from './workflowModel';

/**
 * Access › Roles › <role>: the Role editor (design screen 1, owner 2026-10-12). What the role may do (role-actions),
 * which complaints (its scope on the complaint-search action), which fields it sees (masking) and, from the same rows,
 * a plain-words summary. Every write goes to the existing MDMS rows (roleEditorData.ts); nothing else stores policy.
 */
type FieldEdit = { clause: Clause | null; onDeny?: OnDeny };

const AXIS_TEXT: Record<Axis, { legend: string; own: string; all: string; help: string }> = {
  jurisdiction: { legend: 'Area', own: 'Only areas the person covers', all: 'Every area in the tenant', help: 'Covering a sub-county includes all its wards.' },
  department: { legend: 'Department', own: "Only the person's departments", all: 'Every department', help: 'Granted at a department node, it narrows to that department.' },
};

export default function RoleEditor() {
  const { code: codeParam } = useParams();
  const isNew = !codeParam || codeParam === 'new';
  const navigate = useNavigate();
  const { canEditResource } = useMastersCapability();
  const canEdit = canEditResource('access-roles') && canEditResource('action-mappings');
  // shared masters (roles, role-actions, actions) live at the state root of the signed-in admin's tenant
  const { state: appState } = useApp();
  const root = appState.tenant.split('.')[0];

  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [caps, setCaps] = useState<Record<string, boolean>>({});
  const [scope, setScope] = useState<RoleScope | null>(null);
  const [fields, setFields] = useState<Record<string, FieldEdit | undefined>>({});
  const [wf, setWf] = useState<WfEdit>({});
  const [plan, setPlan] = useState<Write[] | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoaded(null); setLoadError(null); setPlan(null); setCaps({}); setScope(null); setFields({}); setWf({});
    try {
      const l = await loadRole(digitClient, root, isNew ? null : codeParam!);
      if (!isNew && !l.role) throw new Error(`No role ${codeParam} at ${root}`);
      setLoaded(l);
      setCode(isNew ? '' : String(l.role!.data.code));
      setName(isNew ? '' : String(l.role!.data.name ?? ''));
      setDescription(isNew ? '' : String(l.role!.data.description ?? ''));
    } catch (e) {
      setLoadError(String((e as Error).message ?? e));
    }
  }, [codeParam, isNew, root]);
  useEffect(() => { void load(); }, [load]);

  const vocab = useMemo(() => vocabulary((loaded?.catalogue ?? []) as unknown as CatalogueRow[], AVAILABLE_CONDITION_VARS), [loaded]);
  const roleCode = isNew ? code : codeParam!;
  // a role's own branch of a field rule is guarded by user.roles: until the engines carry it, it could never hold
  const perRoleRules = !vocab.find((x) => x.var === 'user.roles')?.requires;
  const held = useMemo(() => new Set((loaded?.grants ?? []).filter((g) => g.isActive !== false).map((g) => Number(g.data.actionid))), [loaded]);
  const block = scopeBlockOf(loaded?.searchAction?.data);
  const current = effectiveScope(block, roleCode);
  const levels = { ...current.levels, ...(scope ?? {}) } as Record<Axis, Level>;
  const capOn = (id: string) => caps[id] ?? capabilityState(id, loaded?.actions ?? [], held) === 'on';

  const attrs = ((loaded?.searchAction?.data as any)?.resource?.complaint?.attributes ?? {}) as Record<string, any>;
  const fieldRows = useMemo(() => {
    const paths = [...new Set([...KNOWN_FIELDS.map((f) => f.path), ...Object.keys(attrs)])];
    return paths.map((path) => {
      const known = KNOWN_FIELDS.find((f) => f.path === path);
      const parsed = parseFieldRule(attrs[path]);
      const edit = fields[path];
      const roleClause = edit ? edit.clause : (parsed.perRole[roleCode] ?? null);
      const onDeny = edit?.onDeny ?? parsed.onDeny;
      return { path, label: known?.label ?? path, sample: known?.sample ?? 'sample', exists: !!attrs[path], parsed, roleClause, onDeny };
    });
  }, [attrs, fields, roleCode]);

  const edited: Edited = { code: roleCode, name, description, caps, scope, fields, workflow: wf };
  const grid = roleGrid(loaded?.workflow ?? null, roleCode);
  const summary = plainWords({
    caps: CAPABILITIES.filter((c) => capOn(c.id)).map((c) => c.id),
    levels,
    fields: fieldRows.filter((f) => f.exists || f.roleClause).map((f) => ({
      label: f.label,
      // what holds for THIS role: its own branch, or the shared branches every role gets
      when: [...(f.roleClause ? [f.roleClause] : []), ...f.parsed.shared].map((c) => describeClause(c, vocab)).join(' or ') || null,
      onDeny: f.onDeny,
    })),
  });

  const review = () => {
    setPlanError(null);
    try { setPlan(planSave(loaded!, edited, vocab)); } catch (e) { setPlan(null); setPlanError(String((e as Error).message)); }
  };
  const save = async () => {
    if (!plan || !loaded) return;
    setSaving(true);
    try {
      const done = await applySave(digitClient, loaded, plan);
      const refreshed = await refreshAccess(digitClient as never, plan);
      toast({ title: 'Role saved', description: [`${done.length} change(s) written.`, ...whenItAppliesAll(planKinds(plan), refreshed === 'refreshed')].join(' ') });
      if (isNew) navigate(`/manage/access/roles/${roleCode}`, { replace: true }); else await load();
    } catch (e) {
      const msg = String((e as Error).message ?? e);
      toast({ title: e instanceof ConcurrentChangeError ? 'Changed by someone else' : 'Save failed', description: msg, variant: 'destructive' });
      setPlanError(msg);
    } finally {
      setSaving(false);
    }
  };

  if (loadError) return <Alert variant="destructive" className="m-6"><AlertDescription>{loadError}</AlertDescription></Alert>;
  if (!loaded) return <div className="flex items-center gap-2 p-6 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading the role</div>;

  const dirty = Object.keys(caps).length > 0 || scope !== null || Object.values(fields).some(Boolean) || Object.keys(wf).length > 0
    || (!isNew && (name !== String(loaded.role?.data.name ?? '') || description !== String(loaded.role?.data.description ?? '')))
    || (isNew && !!code);

  return (
    <div className="flex flex-col gap-6 p-6 lg:flex-row" data-testid="role-editor">
      <main className="flex min-w-0 flex-1 flex-col gap-6">
        <AccessBreadcrumb trail={[{ label: 'Roles', to: '/manage/access-roles' }, { label: isNew ? 'New role' : roleCode }]} />
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <AccessTitle level={1} className="text-2xl">{isNew ? 'New role' : name || roleCode}</AccessTitle>
              {!isNew && <span className="font-mono text-sm text-muted-foreground">{roleCode}</span>}
            </div>
            <div className="flex gap-2">
              {!isNew && <Button variant="outline" onClick={() => navigate(`/manage/access/roles/${encodeURIComponent(roleCode)}/rows`)} data-testid="role-rows">Policy rows</Button>}
              {canEdit && <Button onClick={review} disabled={!dirty} data-testid="role-review"><Save className="mr-2 h-4 w-4" />Save role</Button>}
            </div>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            {isNew && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="role-code">Code</Label>
                <Input id="role-code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="SUBCOUNTY_GRO" disabled={!canEdit} />
              </div>
            )}
            <div className="flex flex-col gap-2">
              <Label htmlFor="role-name">Name</Label>
              <Input id="role-name" value={name} onChange={(e) => setName(e.target.value)} disabled={!canEdit} />
            </div>
            <div className="flex flex-col gap-2 md:col-span-2">
              <Label htmlFor="role-description">Description</Label>
              <Input id="role-description" value={description} onChange={(e) => setDescription(e.target.value)} disabled={!canEdit} />
            </div>
            {!canEdit && <p className="text-sm text-muted-foreground md:col-span-2">Read only: changing a role needs MDMS_ADMIN at {root}.</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><AccessTitle level={2}>What it may do</AccessTitle></CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm md:min-w-[560px]">
              <thead className="hidden md:table-header-group"><tr className="text-left text-xs uppercase text-muted-foreground"><th className="p-2">Allowed</th><th className="p-2">Capability</th><th className="p-2">APIs it opens</th></tr></thead>
              <tbody>
                {CAPABILITIES.map((c) => {
                  const acts = actionsOf(c.id, loaded.actions);
                  const st = capabilityState(c.id, loaded.actions, held);
                  return (
                    <tr key={c.id} className="flex flex-wrap border-t md:table-row">
                      <td className="p-2">
                        <input type="checkbox" aria-label={c.label} checked={capOn(c.id)} disabled={!canEdit || st === 'none'}
                          ref={(el) => { if (el) el.indeterminate = caps[c.id] === undefined && st === 'partial'; }}
                          onChange={(e) => {
                            setCaps({ ...caps, [c.id]: e.target.checked });
                            // switching off what the workflow's actions need unticks them here too (same reviewed save)
                            if (!e.target.checked && WORKFLOW_CAPABILITIES.includes(c.id)) {
                              const off: WfEdit = { ...wf };
                              for (const st of grid.statuses) for (const a of grid.actions) if (grid.cell(st, a) !== null) off[cellKey(st, a)] = false;
                              setWf(off);
                            }
                          }} />
                      </td>
                      <td className="flex-1 p-2">{c.label}{st === 'partial' && caps[c.id] === undefined && <span className="ml-2 text-xs text-amber-700">(some granted)</span>}</td>
                      <td className="basis-full break-all p-2 pt-0 font-mono text-xs text-muted-foreground md:pt-2">{acts.length ? acts.map((a) => a.url).join(', ') : 'no such action at this install'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><AccessTitle level={2}>Which complaints</AccessTitle></CardHeader>
          <CardContent className="flex flex-col gap-4">
            {!block && <Alert><AlertTriangle className="h-4 w-4" /><AlertDescription>The complaint search action has no scope block at {root}: nobody sees complaints by scope. Adding one changes every role; ask a policy admin.</AlertDescription></Alert>}
            <div className="grid gap-4 md:grid-cols-2">
              {AXES.map((axis) => (
                <fieldset key={axis} className="flex flex-col gap-2 rounded-lg border p-4" data-testid={`scope-${axis}`}>
                  <legend className="px-1 text-sm font-semibold">{AXIS_TEXT[axis].legend}</legend>
                  {(['OWN', 'ALL'] as Level[]).map((lv) => (
                    <label key={lv} className="flex items-center gap-2 text-sm">
                      <input type="radio" name={`scope-${axis}`} checked={levels[axis] === lv} disabled={!canEdit || !block}
                        onChange={() => setScope({ ...current.levels, ...(scope ?? {}), [axis]: lv })} />
                      {lv === 'OWN' ? AXIS_TEXT[axis].own : AXIS_TEXT[axis].all}
                    </label>
                  ))}
                  <span className="text-xs text-muted-foreground">{AXIS_TEXT[axis].help}</span>
                </fieldset>
              ))}
            </div>
            <p className="text-sm text-muted-foreground">
              Complaints assigned to them are always included.
              {!current.stated && block && ' This role has no entry yet: it gets the default until you save.'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><AccessTitle level={2}>Which fields they see</AccessTitle></CardHeader>
          <CardContent className="flex flex-col gap-3 overflow-x-auto">
            {!perRoleRules && <p className="text-sm text-amber-800">A rule for this role alone needs the engines' per-role check, which is not deployed yet. Until then only "Otherwise", which every role shares, can change.</p>}
            <table className="w-full text-sm md:min-w-[640px]" data-testid="field-rules">
              <thead className="hidden md:table-header-group"><tr className="text-left text-xs uppercase text-muted-foreground"><th className="p-2">Field</th><th className="p-2">Shown in full to this role when</th><th className="p-2">Otherwise (every role)</th><th className="p-2">They see</th></tr></thead>
              <tbody>
                {fieldRows.map((f) => {
                  const set = (patch: Partial<FieldEdit>) => setFields({ ...fields, [f.path]: { clause: f.roleClause, onDeny: f.onDeny, ...patch } });
                  const presetId = f.roleClause ? PRESETS.find((p) => JSON.stringify(p.clause) === JSON.stringify(f.roleClause))?.id ?? 'custom' : '';
                  const shared = f.parsed.shared.map((c) => describeClause(c, vocab)).join(' or ');
                  return (
                    <tr key={f.path} className="flex flex-col border-t align-top md:table-row" data-testid={`field-${f.path}`}>
                      <td className="block p-2 md:table-cell"><strong>{f.label}</strong><div className="font-mono text-xs text-muted-foreground">{f.path}</div></td>
                      <td className="block p-2 md:table-cell">
                        <div className="mb-1 text-xs uppercase text-muted-foreground md:hidden">Shown in full to this role when</div>
                        {f.parsed.custom ? <span className="text-xs text-amber-700">Custom condition: see Policy rows</span> : (
                          <>
                            <select aria-label={`${f.label}: shown in full when`} className="w-full max-w-[220px] rounded-md border bg-background p-2" value={presetId} disabled={!canEdit || !perRoleRules}
                              onChange={(e) => set({ clause: e.target.value ? PRESETS.find((p) => p.id === e.target.value)!.clause : null })}>
                              <option value="">no rule for this role</option>
                              {PRESETS.map((p) => {
                                const missing = unavailableVars(p.clause, vocab);
                                return <option key={p.id} value={p.id} disabled={missing.length > 0}>{p.label}{missing.length ? ' (coming soon)' : ''}</option>;
                              })}
                              {presetId === 'custom' && <option value="custom" disabled>{describeClause(f.roleClause!, vocab)}</option>}
                            </select>
                            {f.exists && shared && <div className="mt-1 text-xs text-muted-foreground">Also for everyone: {shared}</div>}
                          </>
                        )}
                      </td>
                      <td className="block p-2 md:table-cell">
                        <div className="mb-1 text-xs uppercase text-muted-foreground md:hidden">Otherwise (every role)</div>
                        <div className="flex flex-wrap items-center gap-3" role="radiogroup" aria-label={`${f.label}: otherwise`}>
                          <label className="flex items-center gap-1"><input type="radio" name={`od-${f.path}`} checked={f.onDeny.strategy === 'REDACT'} disabled={!canEdit || f.parsed.custom} onChange={() => set({ onDeny: { strategy: 'REDACT' } })} />Hide</label>
                          <label className="flex items-center gap-1"><input type="radio" name={`od-${f.path}`} checked={f.onDeny.strategy === 'MASK_SHOW_LAST_N'} disabled={!canEdit || f.parsed.custom} onChange={() => set({ onDeny: { strategy: 'MASK_SHOW_LAST_N', n: 3, maskChar: 'X' } })} />Show last</label>
                          {f.onDeny.strategy === 'MASK_SHOW_LAST_N' && (
                            <>
                              <input type="number" min={0} max={20} aria-label={`${f.label}: characters to show`} className="w-16 rounded-md border bg-background p-1" value={f.onDeny.n ?? 0} disabled={!canEdit}
                                onChange={(e) => set({ onDeny: { ...f.onDeny, n: Number(e.target.value) } })} />
                              <span>characters</span>
                            </>
                          )}
                        </div>
                      </td>
                      <td className="block p-2 font-mono md:table-cell"><span className="mr-2 font-sans text-xs uppercase text-muted-foreground md:hidden">They see</span><span data-testid={`preview-${f.path}`}>{maskPreview(f.sample, f.onDeny) ?? '(empty)'}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="text-xs text-muted-foreground">
              A field rule is shared by every role that searches complaints: "Otherwise" applies to all of them. The rule
              for this role only widens when it is shown in full. The citizen who filed a complaint always sees their own data.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><AccessTitle level={2}>Workflow actions by complaint status</AccessTitle></CardHeader>
          <CardContent className="flex flex-col gap-3 overflow-x-auto">
            {!loaded.workflow ? <p className="text-sm text-muted-foreground">The PGR workflow is not readable at {root}.</p> : (
              <table className="w-full min-w-[560px] text-sm" data-testid="workflow-grid">
                <thead><tr className="text-left text-xs uppercase text-muted-foreground"><th className="p-2">Status</th>{grid.actions.map((a) => <th key={a} className="p-2">{a.charAt(0) + a.slice(1).toLowerCase()}</th>)}</tr></thead>
                <tbody>
                  {grid.statuses.map((st) => (
                    <tr key={st} className="border-t">
                      <td className="p-2">{statusLabel(st)}</td>
                      {grid.actions.map((a) => {
                        const c = grid.cell(st, a);
                        const k = cellKey(st, a);
                        return (
                          <td key={a} className="p-2">
                            {c === null ? <span className="text-muted-foreground">–</span> : (
                              <input type="checkbox" aria-label={`${a} when ${statusLabel(st).toLowerCase()}`} disabled={!canEdit}
                                checked={wf[k] ?? c === 'on'} onChange={(e) => setWf({ ...wf, [k]: e.target.checked })} />
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="text-xs text-muted-foreground">Which actions the employee app offers this role on a complaint in each status. The workflow is shared: only this role's ticks change. An action is still refused on a complaint outside the role's scope.</p>
          </CardContent>
        </Card>

        {(plan || planError) && (
          <Card className="border-2 border-primary" data-testid="role-plan">
            <CardHeader><AccessTitle level={2}>You are about to change</AccessTitle></CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              {planError && <Alert variant="destructive"><AlertDescription>{planError}</AlertDescription></Alert>}
              {plan && plan.length === 0 && <p>Nothing: the rows already say this.</p>}
              {plan && plan.length > 0 && (
                <ul className="flex flex-col gap-2">
                  {plan.map((w) => (
                    <li key={`${w.kind}-${w.uid}`}>
                      {w.kind === 'role' && <>Role <code>{w.uid}</code>: {w.op === 'create' ? 'create' : 'update name / description'} (ACCESSCONTROL-ROLES)</>}
                      {w.kind === 'grant' && <>Grant <code>{w.uid}</code>: {w.op} (ACCESSCONTROL-ROLEACTIONS)</>}
                      {w.kind === 'workflow' && <>Workflow <code>{w.uid}</code>, only {roleCode}: {w.changes.map((c) => `${c.on ? '+' : '-'} ${c.action} when ${statusLabel(c.status).toLowerCase()}`).join(', ')}</>}
                      {w.kind === 'action' && (
                        <>Action <code>{w.uid}</code> (complaint search):
                          {(['role', 'shared'] as const).map((who) => {
                            const cs = w.changes.filter((c) => (/\.onDeny(\.|$)/.test(c.path) ? 'shared' : 'role') === who);
                            if (!cs.length) return null;
                            return (
                              <div key={who} className="mt-2" data-testid={`plan-${who}`}>
                                <div className={who === 'shared' ? 'font-semibold text-amber-800' : 'font-semibold'}>
                                  {who === 'shared' ? 'Applies to EVERY role that searches complaints:' : `Only ${roleCode}:`}
                                </div>
                                <pre className="mt-1 whitespace-pre-wrap break-words rounded bg-muted p-2 font-mono text-xs">{cs.map((c) => `${c.path}\n  - ${JSON.stringify(c.before) ?? '(none)'}\n  + ${JSON.stringify(c.after) ?? '(none)'}`).join('\n')}</pre>
                              </div>
                            );
                          })}
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {plan && plan.length > 0 && planKinds(plan).length > 0 && (
                <div className="rounded-md border bg-muted/40 p-3" data-testid="role-when">
                  <div className="mb-1 font-semibold">When it applies to the people who hold {roleCode}</div>
                  <ul className="list-disc pl-5">{whenItAppliesAll(planKinds(plan)).map((t) => <li key={t}>{t}</li>)}</ul>
                </div>
              )}
              <div className="flex gap-2">
                {plan && plan.length > 0 && <Button onClick={save} disabled={saving} data-testid="role-confirm">{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Confirm and save</Button>}
                <Button variant="outline" onClick={() => { setPlan(null); setPlanError(null); }}>Back</Button>
              </div>
            </CardContent>
          </Card>
        )}
      </main>

      <aside className="flex w-full flex-col gap-4 lg:w-80">
        {/* cfgreview F12 / PM 5 (#1558): what the saved role lets someone see at a tenant */}
        {!isNew && <RolePreview role={codeParam!} />}
        <Card>
          <CardHeader><AccessTitle level={2} className="text-base">In plain words</AccessTitle></CardHeader>
          <CardContent><p className="text-sm leading-relaxed" data-testid="role-plain-words">{summary}</p></CardContent>
        </Card>
        <Card>
          <CardHeader><AccessTitle level={2} className="text-base">After saving</AccessTitle></CardHeader>
          <CardContent>
            <ul className="list-disc pl-5 text-sm text-muted-foreground" data-testid="role-after-saving">
              {(['calls', 'scope', 'workflow'] as ChangeKind[]).map((k) => <li key={k}>{whenItApplies(k)}</li>)}
              <li>Someone given this role gets it at their next sign-in (or when their session refreshes); give it in Roles by tenant.</li>
            </ul>
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}
