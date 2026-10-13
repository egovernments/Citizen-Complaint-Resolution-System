import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Save } from 'lucide-react';
import type { MdmsRecord } from '@digit-mcp/data-provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { AccessTitle } from './AccessChrome';
import { toast } from '@/hooks/use-toast';
import { digitClient } from '@/providers/bridge';
import { useMastersCapability } from '@/hooks/useMastersCapability';
import { useApp } from '../App';
import {
  OPERATOR_TEXT, PERSON_ATTRS, RESOURCE_ATTRS, SOURCE_TEXT, VALUE_SOURCES, engineFieldsUnchanged, usedBy, withPickerFields, type AttrRow,
} from './catalogueModel';

const COMPLAINT_SEARCH_URL = '/pgr-services/v2/request/_search';

/**
 * Access › Attributes (design screen 5): what access can be judged on. Complaint attributes from
 * ACCESSCONTROL-RESOURCE.attributes, who uses them (the complaint-search scope), and what is known about the person.
 * An MDMS admin may edit an attribute's name and picker fields; the SQL mapping is shown, never edited here.
 */
export default function AttributesCatalogue() {
  const { state } = useApp();
  const root = state.tenant.split('.')[0];
  const { canEditResource } = useMastersCapability();
  const canEdit = canEditResource('access-roles');
  const [rows, setRows] = useState<MdmsRecord[] | null>(null);
  const [scope, setScope] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<AttrRow>>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [attrs, acts] = await Promise.all([
        digitClient.mdmsSearch(root, RESOURCE_ATTRS, { limit: 500 }),
        digitClient.mdmsSearch(root, 'ACCESSCONTROL-ACTIONS-TEST.actions-test', { limit: 500 }),
      ]);
      setRows(attrs.filter((r) => r.isActive !== false));
      setScope((acts.find((a) => a.data.url === COMPLAINT_SEARCH_URL)?.data as any)?.resource?.complaint?.scope ?? null);
    } catch (e) { setError(String((e as Error).message ?? e)); }
  }, [root]);
  useEffect(() => { void load(); }, [load]);

  const complaint = useMemo(() => (rows ?? []).filter((r) => r.data.resource === 'complaint'), [rows]);
  const current = complaint.find((r) => r.uniqueIdentifier === sel) ?? null;
  const row = current?.data as unknown as AttrRow | undefined;

  const save = async () => {
    if (!current || !row) return;
    setSaving(true);
    try {
      const next = withPickerFields(row, draft);
      if (!engineFieldsUnchanged(row, next)) throw new Error('refused: this screen never changes field, operators or columns');
      const fresh = (await digitClient.mdmsSearch(root, RESOURCE_ATTRS, { uniqueIdentifiers: [current.uniqueIdentifier] }))[0];
      if (!fresh || JSON.stringify(fresh.data) !== JSON.stringify(current.data)) throw new Error('CHANGED_SINCE_LOADED: someone changed this attribute since the page loaded; reload and redo your change');
      await digitClient.mdmsUpdate({ ...fresh, data: next as unknown as Record<string, unknown> }, true);
      toast({ title: 'Attribute saved', description: `${row.attribute}: the pickers use the new name at once; access is unchanged.` });
      setDraft({});
      await load();
    } catch (e) {
      toast({ title: 'Save failed', description: String((e as Error).message ?? e), variant: 'destructive' });
    } finally { setSaving(false); }
  };

  if (error) return <Alert variant="destructive" className="m-6"><AlertDescription>{error}</AlertDescription></Alert>;
  if (!rows) return <div className="flex items-center gap-2 p-6 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading attributes</div>;

  const v = (k: keyof AttrRow) => (draft[k] as string | undefined) ?? ((row?.[k] as string | undefined) ?? '');
  return (
    <div className="flex flex-col gap-6 p-6 lg:flex-row" data-testid="attributes-catalogue">
      <main className="flex min-w-0 flex-1 flex-col gap-6">
        <Card>
          <CardHeader><AccessTitle level={1} className="text-2xl">Complaint attributes</AccessTitle></CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm" data-testid="attr-table">
              <thead><tr className="text-left text-xs uppercase text-muted-foreground"><th className="p-2">Attribute</th><th className="p-2">Values come from</th><th className="p-2">Compare with</th><th className="p-2">Used by</th></tr></thead>
              <tbody>
                {complaint.map((r) => {
                  const d = r.data as unknown as AttrRow;
                  const u = usedBy(d.attribute, scope);
                  return (
                    <tr key={r.uniqueIdentifier} className={`cursor-pointer border-t ${sel === r.uniqueIdentifier ? 'bg-muted' : ''}`} onClick={() => { setSel(r.uniqueIdentifier); setDraft({}); }} data-testid={`attr-${d.attribute}`}>
                      <td className="p-2"><button type="button" className="text-left font-semibold underline-offset-2 hover:underline">{d.label ?? d.attribute}</button><div className="font-mono text-xs text-muted-foreground">{d.attribute}</div></td>
                      <td className="p-2">{d.valueSource ? SOURCE_TEXT[d.valueSource] ?? d.valueSource : <span className="text-muted-foreground">not set</span>}</td>
                      <td className="p-2">{(d.operators ?? []).map((o) => OPERATOR_TEXT[o] ?? o).join(' · ')}</td>
                      <td className="max-w-[220px] break-words p-2">{u.roles.length ? u.roles.join(', ') : u.note}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!complaint.length && <p className="p-2 text-sm text-muted-foreground">No attributes at {root}: the access filter has no attribute map here.</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><AccessTitle level={2}>Who asks: person attributes</AccessTitle></CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {PERSON_ATTRS.map((p) => (
              <div key={p.var} className="rounded-lg border p-3"><div className="text-sm font-semibold">{p.label}</div><div className="text-xs text-muted-foreground">{p.example}</div><div className="mt-1 break-all font-mono text-xs text-muted-foreground">{p.var}</div></div>
            ))}
          </CardContent>
        </Card>
      </main>
      <aside className="flex w-full flex-col gap-4 lg:w-96">
        {row ? (
          <Card className="border-2 border-primary" data-testid="attr-detail">
            <CardHeader><AccessTitle level={2}>{row.label ?? row.attribute}</AccessTitle></CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              <div className="flex flex-col gap-1"><Label htmlFor="attr-label">Name in the pickers</Label><Input id="attr-label" value={v('label')} disabled={!canEdit} onChange={(e) => setDraft({ ...draft, label: e.target.value })} /></div>
              <div className="flex flex-col gap-1"><Label htmlFor="attr-source">Values come from</Label>
                <select id="attr-source" className="h-10 rounded-md border bg-background px-3" value={v('valueSource')} disabled={!canEdit} onChange={(e) => setDraft({ ...draft, valueSource: e.target.value })}>
                  <option value="">not set</option>
                  {VALUE_SOURCES.map((s) => <option key={s} value={s}>{SOURCE_TEXT[s]}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1"><Label htmlFor="attr-var">In conditions</Label><Input id="attr-var" className="font-mono" value={v('conditionVar')} disabled={!canEdit} placeholder="resource.complaint.…" onChange={(e) => setDraft({ ...draft, conditionVar: e.target.value })} /></div>
              <div className="flex flex-col gap-1"><Label htmlFor="attr-match">Matched to the person's</Label><Input id="attr-match" className="font-mono" value={v('personMatch')} disabled={!canEdit} placeholder="user.attributes.…" onChange={(e) => setDraft({ ...draft, personMatch: e.target.value })} /></div>
              <details className="border-t pt-2">
                <summary className="cursor-pointer font-semibold">Technical mapping (read only)</summary>
                <div className="mt-2 flex flex-col gap-1 font-mono text-xs text-muted-foreground">
                  <span>record: {row.field}</span>
                  {Object.entries(row.columns ?? {}).map(([k, c]) => <span key={k}>{k}: {c}</span>)}
                </div>
              </details>
              {canEdit && <Button onClick={save} disabled={saving || !Object.keys(draft).length} data-testid="attr-save">{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save</Button>}
              <p className="text-xs text-muted-foreground">The name and pickers change what the access screens offer. Who sees what is unchanged: the mapping above decides it.</p>
            </CardContent>
          </Card>
        ) : <Card><CardContent className="p-4 text-sm text-muted-foreground">Pick an attribute to see its mapping and who uses it.</CardContent></Card>}
      </aside>
    </div>
  );
}
