import { useEffect, useState } from 'react';
import { Eye, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { digitClient } from '@/providers/bridge';
import { useApp } from '../App';
import { AccessTitle } from './AccessChrome';
import { PREVIEW_PATH, previewBody, previewError, previewSentence, type PreviewAnswer } from './rolePreviewModel';

/**
 * ours (cfgreview F12 / PM 5, #1558): a read-only "Preview at a tenant" panel in the Role editor. It asks pgr-services
 * what someone holding the SAVED role at the chosen tenant (with the chosen areas) would see: the count and 3 sample
 * complaints, masked as that role and as you. Nothing is granted or written.
 */
export function RolePreview({ role }: { role: string }) {
  const { state } = useApp();
  const home = state.tenant;
  const [tenants, setTenants] = useState<{ code: string; name: string }[]>([]);
  const [tenantId, setTenantId] = useState(home);
  const [areas, setAreas] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState<PreviewAnswer | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      const out: { code: string; name: string }[] = [];
      for (let offset = 0; offset < 20_000; offset += 500) {
        const page = await digitClient.mdmsSearch(home.split('.')[0], 'tenant.tenants', { limit: 500, offset, isActive: true });
        for (const r of page) {
          const d = r.data as { code?: string; name?: string };
          const code = String(d.code ?? '').trim();
          if (code && (code === home || code.startsWith(`${home}.`)) && !out.some((o) => o.code === code)) out.push({ code, name: d.name?.trim() || code });
        }
        if (page.length < 500) break;
      }
      if (live) setTenants(out.sort((a, b) => a.code.localeCompare(b.code)));
    })().catch(() => { /* the working tenant stays the one choice */ });
    return () => { live = false; };
  }, [home]);
  const choices = tenants.some((t) => t.code === tenantId) ? tenants : [{ code: tenantId, name: tenantId }, ...tenants];

  const run = async () => {
    setBusy(true); setError(null); setAnswer(null);
    try {
      const body = previewBody({ tenantId, role, areas: areas.split(/[\s,]+/) }, digitClient.buildRequestInfo() as unknown as Record<string, unknown>);
      setAnswer(await digitClient.request<PreviewAnswer>(PREVIEW_PATH, body));
    } catch (e) {
      setError(previewError(String((e as Error).message ?? e)));
    } finally { setBusy(false); }
  };

  return (
    <Card data-testid="role-preview">
      <CardHeader><AccessTitle level={2} className="text-base">Preview at a tenant</AccessTitle></CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <p className="text-xs text-muted-foreground">What someone holding the saved role would see. Nothing is granted or written.</p>
        <div className="flex min-w-0 flex-col gap-1">
          <Label htmlFor="rp-tenant">Tenant</Label>
          <select id="rp-tenant" className="h-10 w-full min-w-0 rounded-md border bg-background px-3" value={tenantId} onChange={(e) => setTenantId(e.target.value)} data-testid="rp-tenant">
            {choices.map((t) => <option key={t.code} value={t.code}>{t.name === t.code ? t.code : `${t.name} (${t.code})`}</option>)}
          </select>
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <Label htmlFor="rp-areas">Areas they cover (optional, boundary codes)</Label>
          <Input id="rp-areas" value={areas} onChange={(e) => setAreas(e.target.value)} placeholder="e.g. BOMET_BOMET_CENTRAL" />
        </div>
        <Button variant="outline" onClick={run} disabled={busy} data-testid="rp-run">
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Eye className="mr-2 h-4 w-4" />}Preview
        </Button>
        {error && <Alert variant="destructive"><AlertDescription data-testid="rp-error">{error}</AlertDescription></Alert>}
        {answer && (
          <div className="flex flex-col gap-2" data-testid="rp-answer">
            <p data-testid="rp-sentence">{previewSentence(answer)}</p>
            {answer.samples.length > 0 && (
              <ul className="flex flex-col gap-2">
                {answer.samples.map((s) => (
                  <li key={s.serviceRequestId} className="rounded border p-2 text-xs" data-testid="rp-sample">
                    <div className="font-mono">{s.serviceRequestId}</div>
                    <div>{[s.serviceCode, s.applicationStatus, s.locality].filter(Boolean).join(' · ')}</div>
                    <div>{[s.citizen?.name, s.citizen?.mobileNumber].filter(Boolean).join(' · ')}</div>
                    {(s.maskedForRole ?? []).length > 0 && <div className="text-muted-foreground">Hidden from this role: {s.maskedForRole!.join(', ')}</div>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
