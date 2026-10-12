import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Copy, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/hooks/use-toast';
import { digitClient } from '@/providers/bridge';
import { useApp } from '../App';
import { loadRole } from './roleEditorData';
import { policyRows, type RowSection } from './policyRowsModel';

/**
 * Access › Roles › <role> › Policy rows (design screen 4): the MDMS JSON the Role editor writes and the engines read,
 * read only. It answers "what exactly is stored for this role" without a database or API client.
 */
export default function PolicyRows() {
  const { code } = useParams();
  const { state } = useApp();
  const root = state.tenant.split('.')[0];
  const [sections, setSections] = useState<RowSection[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadRole(digitClient, root, code!).then((l) => {
      if (!l.role) throw new Error(`No role ${code} at ${root}`);
      setSections(policyRows(l, code!));
    }).catch((e) => setError(String((e as Error).message ?? e)));
  }, [code, root]);

  const copy = async (json: unknown) => {
    try { await navigator.clipboard.writeText(JSON.stringify(json, null, 2)); toast({ title: 'Copied' }); }
    catch { toast({ title: 'Copy failed', description: 'Select the text instead.', variant: 'destructive' }); }
  };

  if (error) return <Alert variant="destructive" className="m-6"><AlertDescription>{error}</AlertDescription></Alert>;
  if (!sections) return <div className="flex items-center gap-2 p-6 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading the rows</div>;
  return (
    <div className="flex flex-col gap-4 p-6" data-testid="policy-rows">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">The rows behind {code}</h1>
        <span className="flex-1" />
        <Link to={`/manage/access/roles/${encodeURIComponent(code!)}`} className="text-sm underline">Back to the Role editor</Link>
      </div>
      <p className="max-w-3xl text-sm text-muted-foreground">Read only. These are the MDMS rows the Role editor writes; the access engines are built from exactly these rows.</p>
      {sections.map((s) => (
        <Card key={`${s.schema}-${s.title}`} data-testid={`rows-${s.schema}`}>
          <CardHeader className="flex flex-row flex-wrap items-center gap-2">
            <CardTitle className="text-base">{s.title}</CardTitle>
            <span className="font-mono text-xs text-muted-foreground">{s.schema} · {s.id}</span>
            <span className="flex-1" />
            <Button variant="outline" size="sm" onClick={() => copy(s.json)} aria-label={`Copy ${s.title}`}><Copy className="h-4 w-4" /></Button>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {s.note && <p className="text-xs text-muted-foreground">{s.note}</p>}
            <pre className="max-h-[480px] overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-3 font-mono text-xs">{JSON.stringify(s.json, null, 2)}</pre>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
