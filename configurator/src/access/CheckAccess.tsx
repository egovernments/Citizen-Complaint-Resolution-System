import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle2, Loader2, Search, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { AccessTitle } from './AccessChrome';
import { digitClient } from '@/providers/bridge';
import { useApp } from '../App';
import {
  ACTION_CHOICES, EXPLAIN_PATH, buildExplainBody, checkSentence, headline, layerRows, reasonText, ruleText,
  type ActionChoice, type ExplainAnswer,
} from './explainModel';

/**
 * Access › Check access (design screen 3): may this person do this, here, on this complaint, and why. One call to
 * pgr-services' read-only explain API (OPA's answer, each layer's answer, the MDMS rows behind it, the person's counts).
 * Admins only (the API refuses anyone else with 403); nothing is written.
 */
export default function CheckAccess() {
  const { state } = useApp();
  const [params, setParams] = useSearchParams();
  const [person, setPerson] = useState(params.get('person') ?? '');
  const [action, setAction] = useState<ActionChoice>((params.get('action') as ActionChoice) || 'view');
  const [tenantId, setTenantId] = useState(params.get('tenant') ?? state.tenant);
  const [srid, setSrid] = useState(params.get('complaint') ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState<ExplainAnswer | null>(null);
  const [resolved, setResolved] = useState<string | null>(null);

  /** An employee code or a user uuid -> the uuid (HRMS by code, at the tenant asked about). */
  const subjectUuid = async (who: string): Promise<string> => {
    const v = who.trim();
    if (/^[0-9a-f-]{36}$/i.test(v)) return v;
    const emps = await digitClient.employeeSearch(tenantId, { codes: [v], limit: 1 });
    const uuid = (emps[0] as any)?.user?.uuid ?? (emps[0] as any)?.uuid;
    if (!uuid) throw new Error(`No employee ${v} at ${tenantId}`);
    return uuid;
  };

  const check = async () => {
    setBusy(true); setError(null); setAnswer(null);
    try {
      const uuid = await subjectUuid(person);
      setResolved(uuid);
      const body = buildExplainBody({ subjectUuid: uuid, action, tenantId, serviceRequestId: srid }, digitClient.buildRequestInfo() as unknown as Record<string, unknown>);
      setAnswer(await digitClient.request<ExplainAnswer>(EXPLAIN_PATH, body));
      setParams({ person, action, tenant: tenantId, ...(srid ? { complaint: srid } : {}) }, { replace: true });
    } catch (e) {
      const msg = String((e as Error).message ?? e);
      setError(/403|NOT_AN_ADMIN_HERE|Forbidden/i.test(msg) ? reasonText('NOT_AN_ADMIN_HERE') : msg);
    } finally {
      setBusy(false);
    }
  };
  // a link with the whole question (from the Role editor or a support ticket) answers it at once
  useEffect(() => { if (params.get('person') && params.get('autorun') === '1') void check(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const head = answer ? headline(answer) : null;
  return (
    <div className="flex flex-col gap-6 p-6" data-testid="check-access">
      <Card>
        <CardHeader><AccessTitle level={1} className="text-2xl">Check access</AccessTitle></CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-5">
          <div className="flex flex-col gap-2 md:col-span-2">
            <Label htmlFor="ca-person">Person (employee code or user id)</Label>
            <Input id="ca-person" value={person} onChange={(e) => setPerson(e.target.value)} placeholder="EMP-…" />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="ca-action">Action</Label>
            <select id="ca-action" className="h-10 rounded-md border bg-background px-3" value={action} onChange={(e) => setAction(e.target.value as ActionChoice)}>
              {ACTION_CHOICES.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="ca-tenant">Tenant</Label>
            <Input id="ca-tenant" value={tenantId} onChange={(e) => setTenantId(e.target.value.trim())} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="ca-complaint">Complaint number</Label>
            <Input id="ca-complaint" value={srid} onChange={(e) => setSrid(e.target.value)} placeholder={action === 'search' ? 'optional' : 'KE-PGR-…'} className="font-mono" />
          </div>
          <div className="md:col-span-5">
            <Button onClick={check} disabled={busy || !person.trim()} data-testid="ca-check">
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}Check
            </Button>
          </div>
        </CardContent>
      </Card>

      {error && <Alert variant="destructive"><AlertDescription data-testid="ca-error">{error}</AlertDescription></Alert>}

      {answer && head && (
        <>
          <Card data-testid="ca-verdict">
            <CardHeader className="flex flex-row flex-wrap items-center gap-3">
              <span className={`rounded-md px-3 py-1.5 text-sm font-bold ${head.ok ? 'bg-green-100 text-green-900' : 'bg-red-100 text-red-900'}`} data-testid="ca-decision">{head.ok ? 'Allowed' : 'Denied'}</span>
              <AccessTitle level={2} className="text-xl">{head.ok ? 'Every layer allows it' : head.text}</AccessTitle>
            </CardHeader>
            <CardContent>
              {(answer.checks ?? []).length === 0 && <p className="text-sm text-muted-foreground">No complaint-level checks: {reasonText(answer.layers?.pgr?.reason)}</p>}
              <ol className="flex flex-col gap-3">
                {(answer.checks ?? []).map((c, i) => (
                  <li key={`${c.id}-${i}`} className={`flex gap-3 ${c.ok ? '' : 'text-red-900'}`} data-testid={`ca-check-${c.id}`}>
                    {c.ok ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-700" /> : <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-700" />}
                    <div className="min-w-0">
                      <div className="font-medium">{checkSentence(c)}</div>
                      <div className="text-xs text-muted-foreground">
                        {ruleText(c.rule)}{c.src?.length ? `${c.rule ? ' · ' : ''}${c.src.map((s) => `${s.schema} ${s.id}`).join(', ')}` : ''}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><AccessTitle level={2}>Each layer</AccessTitle></CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm" data-testid="ca-layers">
                <thead><tr className="text-left text-xs uppercase text-muted-foreground"><th className="p-2">Layer</th><th className="p-2">Answer</th><th className="p-2">Detail</th></tr></thead>
                <tbody>
                  {layerRows(answer).map((r) => (
                    <tr key={r.layer} className="border-t">
                      <td className="p-2">{r.layer}</td>
                      <td className={`p-2 font-semibold ${r.ok === null ? '' : r.ok ? 'text-green-800' : 'text-red-800'}`}>{r.answer}</td>
                      <td className="p-2 text-muted-foreground">{r.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {answer.layers?.gateway?.src?.length ? (
                <p className="mt-3 text-xs text-muted-foreground">Gateway rows: {answer.layers.gateway.src.map((s) => `${s.schema} ${s.id}`).join(', ')}</p>
              ) : null}
            </CardContent>
          </Card>

          {answer.counts && !answer.counts.error && (
            <Card>
              <CardHeader><AccessTitle level={2}>What this person sees at {tenantId}</AccessTitle></CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-3" data-testid="ca-counts">
                <div className="rounded-lg border p-4"><div className="text-3xl font-bold tabular-nums">{answer.counts.inScope ?? '–'}</div><div className="text-sm text-muted-foreground">complaints in their scope</div></div>
                <div className="rounded-lg border p-4"><div className="text-3xl font-bold tabular-nums">{answer.counts.ownAssigned ?? '–'}</div><div className="text-sm text-muted-foreground">assigned to them</div></div>
                <div className="rounded-lg border p-4"><div className="text-3xl font-bold tabular-nums">{answer.counts.total ?? '–'}</div><div className="text-sm text-muted-foreground">complaints at the tenant in all</div></div>
              </CardContent>
            </Card>
          )}
          <p className="text-xs text-muted-foreground">Person {resolved} · policy revision {answer.policyRevision ?? 'unknown'}</p>
        </>
      )}
    </div>
  );
}
