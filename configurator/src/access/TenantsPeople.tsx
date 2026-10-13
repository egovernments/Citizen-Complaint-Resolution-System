import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Save, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/hooks/use-toast';
import { digitClient } from '@/providers/bridge';
import { useApp } from '../App';
import { DENIAL_TEXT, areaTree, covered, grantPreview, mayGrant, minimalPicks, peopleRows, withGrant, type AreaNode, type Grant, type GrantPreview } from './grantModel';
import { loadRole } from './roleEditorData';
import { whenItApplies } from './effectTimes';

/**
 * Access › Tenants, people and areas (design screen 2): who holds which role where, and granting a role at a tenant
 * node with the areas the person covers. Writes the existing HRMS employee (role at the node, jurisdictions); the
 * link-role rule is explained before sending and enforced by the server.
 */
const HIERARCHY = 'ADMIN';

function AreaTree({ nodes, picked, onToggle, depth = 0, cover }: { nodes: AreaNode[]; picked: Set<string>; cover: Set<string>; onToggle: (c: string) => void; depth?: number }) {
  return (
    <>
      {nodes.map((n) => {
        const inherited = cover.has(n.code) && !picked.has(n.code);
        return (
          <div key={n.code}>
            <label className="flex items-center gap-2 py-1 text-sm" style={{ paddingLeft: depth * 18 }}>
              <input type="checkbox" checked={cover.has(n.code)} disabled={inherited} onChange={() => onToggle(n.code)} aria-label={n.code} />
              <span>{n.code}</span><span className="text-xs text-muted-foreground">{n.boundaryType}</span>
            </label>
            {depth < 2 && n.children.length > 0 && <AreaTree nodes={n.children} picked={picked} cover={cover} onToggle={onToggle} depth={depth + 1} />}
          </div>
        );
      })}
    </>
  );
}

export default function TenantsPeople() {
  const { state } = useApp();
  const root = state.tenant.split('.')[0];
  const [tenants, setTenants] = useState<{ code: string; name: string }[]>([]);
  const [tenant, setTenant] = useState(state.tenant);
  const [people, setPeople] = useState<ReturnType<typeof peopleRows> | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  const [tree, setTree] = useState<AreaNode[]>([]);
  const [error, setError] = useState<string | null>(null);
  // the grant form
  const [personCode, setPersonCode] = useState('');
  const [employee, setEmployee] = useState<any | null>(null);
  const [role, setRole] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    Promise.all([digitClient.mdmsSearch(root, 'tenant.tenants', { limit: 500 }), digitClient.mdmsSearch(root, 'ACCESSCONTROL-ROLES.roles', { limit: 500 })])
      .then(([t, r]) => {
        setTenants(t.filter((x) => x.isActive !== false).map((x) => ({ code: String(x.data.code), name: String(x.data.name ?? x.data.code) })).sort((a, b) => a.code.localeCompare(b.code)));
        setRoles(r.filter((x) => x.isActive !== false).map((x) => String(x.data.code)).sort());
      }).catch((e) => setError(String((e as Error).message ?? e)));
  }, [root]);

  const loadTenant = useCallback(async (t: string) => {
    setPeople(null); setError(null);
    try {
      const [emps, tb] = await Promise.all([
        digitClient.employeeSearch(t, { limit: 200 }),
        digitClient.boundaryRelationshipSearch(t, HIERARCHY).catch(() => []),
      ]);
      setPeople(peopleRows(emps, t));
      // the nearest tree: this tenant's, else the state's
      setTree(areaTree(tb.length ? tb : await digitClient.boundaryRelationshipSearch(root, HIERARCHY).catch(() => []), HIERARCHY));
    } catch (e) { setError(String((e as Error).message ?? e)); }
  }, [root]);
  useEffect(() => { void loadTenant(tenant); }, [tenant, loadTenant]);

  const cover = useMemo(() => covered(tree, picked), [tree, picked]);

  // what the grant means, before Save: the role's rows + the complaints the chosen areas hold (no simulation)
  const [preview, setPreview] = useState<GrantPreview | null>(null);
  useEffect(() => {
    setPreview(null);
    if (!employee || !role) return;
    let stale = false;
    (async () => {
      const l = await loadRole(digitClient, root, role);
      let count: number | null = null;
      const localities = [...cover];
      if (localities.length) {
        const q = new URLSearchParams({ tenantId: tenant, locality: localities.join(',') });
        const r = await digitClient.request<{ count?: number }>(`${digitClient.endpoint('PGR_COUNT')}?${q}`, { RequestInfo: digitClient.buildRequestInfo() }).catch(() => null);
        count = typeof r?.count === 'number' ? r.count : null;
      }
      if (!stale) setPreview(grantPreview(l, role, tenant, minimalPicks(tree, picked), count));
    })().catch(() => { if (!stale) setPreview(null); });
    return () => { stale = true; };
  }, [employee, role, tenant, cover, picked, tree, root]);
  const myGrants: Grant[] = ((digitClient.getAuthInfo().user as any)?.roles ?? []).map((r: any) => ({ code: r.code, tenantId: r.tenantId }));
  // the session may carry role codes without their tenants: then only the server can decide
  const decision = role && myGrants.length && myGrants.every((g) => g.tenantId) ? mayGrant(myGrants, role, tenant) : null;

  const findPerson = async () => {
    setEmployee(null);
    const e = (await digitClient.employeeSearch(tenant, { codes: [personCode.trim()], limit: 1 }))[0]
      ?? (tenant !== root ? (await digitClient.employeeSearch(root, { codes: [personCode.trim()], limit: 1 }))[0] : undefined);
    if (!e) { toast({ title: 'No such employee', description: `${personCode} at ${tenant}`, variant: 'destructive' }); return; }
    setEmployee(e);
    setPicked(new Set(((e as any).jurisdictions ?? []).filter((j: any) => j.isActive !== false && j.tenantId === tenant).map((j: any) => j.boundary)));
  };

  const grant = async () => {
    if (!employee || !role) return;
    setSaving(true);
    try {
      const fresh = (await digitClient.employeeSearch(employee.tenantId, { codes: [employee.code], limit: 1 }))[0] as any;
      if (!fresh || JSON.stringify(fresh.auditDetails ?? null) !== JSON.stringify(employee.auditDetails ?? null)) throw new Error('This employee changed since you opened them; find them again.');
      const { next, changes } = withGrant(fresh, { role, tenantId: tenant, areas: [...picked], hierarchyType: HIERARCHY }, tree);
      if (!changes.length) { toast({ title: 'Nothing to change' }); return; }
      await digitClient.employeeUpdate(fresh.tenantId, [next]);
      toast({ title: 'Granted', description: `${changes.join('; ')}. ${whenItApplies('grant')}` });
      setEmployee(null); setPersonCode(''); setRole(''); setPicked(new Set());
      await loadTenant(tenant);
    } catch (e) {
      const msg = String((e as Error).message ?? e);
      toast({ title: 'Not granted', description: /ROLE_ESCALATION_FORBIDDEN|403/.test(msg) ? `The server refused: ${msg}` : msg, variant: 'destructive' });
    } finally { setSaving(false); }
  };

  return (
    <div className="flex flex-col gap-6 p-6 lg:flex-row" data-testid="tenants-people">
      <Card className="w-full lg:w-72 lg:self-start">
        <CardHeader><CardTitle className="text-base">Tenants</CardTitle></CardHeader>
        <CardContent className="flex max-h-[70vh] flex-col gap-1 overflow-auto">
          {tenants.map((t) => (
            <button key={t.code} type="button" onClick={() => setTenant(t.code)} data-testid={`tenant-${t.code}`}
              className={`flex justify-between rounded px-2 py-1.5 text-left text-sm ${t.code === tenant ? 'bg-primary/10 font-semibold' : 'hover:bg-muted'}`}
              style={{ paddingLeft: 8 + (t.code.split('.').length - 1) * 14 }}>
              <span className="truncate">{t.name}</span><span className="font-mono text-xs text-muted-foreground">{t.code}</span>
            </button>
          ))}
        </CardContent>
      </Card>

      <main className="flex min-w-0 flex-1 flex-col gap-6">
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        <Card>
          <CardHeader><CardTitle className="text-2xl">{tenant}: who can do what</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto">
            {!people ? <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading</div> : (
              <>
              <Input aria-label="Filter people" placeholder="Filter by name, code, role or area" value={filter} onChange={(e) => setFilter(e.target.value)} className="mb-3 max-w-sm" />
              <div className="max-h-[480px] overflow-auto">
              <table className="w-full min-w-[640px] text-sm" data-testid="people-table">
                <thead><tr className="text-left text-xs uppercase text-muted-foreground"><th className="p-2">Person</th><th className="p-2">Roles (granted at)</th><th className="p-2">Areas</th><th className="p-2">Departments</th></tr></thead>
                <tbody>
                  {people.filter((p) => !filter.trim() || JSON.stringify(p).toLowerCase().includes(filter.trim().toLowerCase())).map((p) => (
                    <tr key={p.code} className="border-t" data-testid={`person-${p.code}`}>
                      <td className="p-2">{p.name}<div className="font-mono text-xs text-muted-foreground">{p.code}</div></td>
                      <td className="p-2">{p.grants.map((g) => `${g.code} (${g.tenantId})`).join(', ')}</td>
                      <td className="p-2">{p.areas.length ? p.areas.join(', ') : <span className="text-muted-foreground">none</span>}</td>
                      <td className="p-2">{p.departments.join(', ') || '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
              </>
            )}
            {people && people.length === 200 && <p className="mt-2 text-xs text-muted-foreground">Showing the first 200 employees at {tenant}; find a person by code below.</p>}
          </CardContent>
        </Card>

        <Card className="border-2 border-primary">
          <CardHeader><CardTitle>Grant a role</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1"><Label htmlFor="g-person">Person (employee code)</Label><Input id="g-person" value={personCode} onChange={(e) => setPersonCode(e.target.value)} /></div>
              <Button variant="outline" onClick={findPerson} disabled={!personCode.trim()} data-testid="g-find"><Search className="mr-2 h-4 w-4" />Find</Button>
              {employee && <span className="text-sm" data-testid="g-found">{employee.user?.name} · {employee.code} · home {employee.tenantId}</span>}
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="flex flex-col gap-1"><Label htmlFor="g-role">Role</Label>
                <select id="g-role" className="h-10 rounded-md border bg-background px-3" value={role} onChange={(e) => setRole(e.target.value)}>
                  <option value="">choose a role</option>
                  {roles.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1"><Label>Granted at</Label><div className="flex h-10 items-center rounded-md border bg-muted px-3 font-mono text-sm">{tenant} and below</div></div>
            </div>
            {decision && !decision.ok && <Alert variant="destructive"><AlertDescription data-testid="g-denied">{DENIAL_TEXT[decision.reason]}</AlertDescription></Alert>}
            <div>
              <Label>Areas this person covers at {tenant}</Label>
              <p className="text-xs text-muted-foreground">Areas belong to the person: every role they hold here uses them. Covering a sub-county includes its wards.</p>
              <div className="mt-2 max-h-80 overflow-auto rounded border p-2" data-testid="g-areas">
                {tree.length ? <AreaTree nodes={tree} picked={picked} cover={cover} onToggle={(c) => { const n = new Set(picked); if (n.has(c)) n.delete(c); else n.add(c); setPicked(n); }} />
                  : <span className="text-sm text-muted-foreground">No {HIERARCHY} area tree for {tenant}.</span>}
              </div>
            </div>
            <div>
              <Button onClick={grant} disabled={!employee || !role || saving || (decision !== null && !decision.ok)} data-testid="g-save">
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Grant
              </Button>
            </div>
            {preview && (
              <div className="rounded-md border bg-muted/40 p-3 text-sm" data-testid="g-preview">
                <div className="mb-1 font-semibold">What this means for {employee?.user?.name ?? 'the person'}</div>
                <ul className="list-disc pl-5">
                  <li data-testid="g-preview-complaints">{preview.complaints}</li>
                  <li>{preview.can}</li>
                  <li>{preview.workflow}</li>
                  <li data-testid="g-preview-masked">{preview.masked}</li>
                </ul>
                <div className="mt-2 text-xs text-muted-foreground" data-testid="g-when">{whenItApplies('grant')}</div>
              </div>
            )}
            <p className="text-xs text-muted-foreground">You can grant only roles you may grant here (ACCOUNT_ADMIN at this tenant or above; an administrative role only if you hold it). The server checks again.</p>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
