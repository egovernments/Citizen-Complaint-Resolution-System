/**
 * Card 4 — "Check your configuration".
 *
 * Runs the escalation scan as a test (POST /pgr-services/escalation/
 * _trigger with dryRun:true at the STATE tenant — the scheduler's own
 * scope) and renders ONLY the aggregate fields. details[] is deliberately
 * ignored: it can hold thousands of per-complaint entries; the
 * single-complaint path goes through TraceBackDialog instead.
 */
import { useState } from 'react';
import { FlaskConical, Search } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { digitClient } from '@/providers/bridge';
import { ApiClientError } from '@digit-mcp/data-provider';
import { ADVISORY_LABEL, SKIP_REASON_COPY, UNKNOWN_SKIP_REASON } from './skipReasonCopy';

interface VerifyCardProps {
  /** State-level tenant — the scan must run where the scheduler runs. */
  stateTenant: string;
  /** Opens the existing TraceBackDialog (owned by the page). */
  onOpenTrace: () => void;
}

/** Aggregate slice of EscalationTriggerResponse — details[] is never read. */
interface ScanAggregates {
  scanned: number;
  wouldEscalate: number;
  preBreachWarnings: number;
  skipped: number;
  skipBreakdown: Record<string, number>;
}

export function VerifyCard({ stateTenant, onOpenTrace }: VerifyCardProps) {
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<ScanAggregates | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<number | null>(null);

  async function runScan() {
    setScanning(true);
    setScanError(null);
    try {
      const resp = await digitClient.request<Partial<ScanAggregates>>(
        '/pgr-services/escalation/_trigger',
        {
          RequestInfo: digitClient.buildRequestInfo(),
          tenantId: stateTenant,
          // Test scan: decision counting only, nothing escalates or persists.
          dryRun: true,
        },
      );
      setResult({
        scanned: resp.scanned ?? 0,
        wouldEscalate: resp.wouldEscalate ?? 0,
        preBreachWarnings: resp.preBreachWarnings ?? 0,
        skipped: resp.skipped ?? 0,
        skipBreakdown: resp.skipBreakdown ?? {},
      });
      setLastRun(Date.now());
    } catch (err) {
      if (
        err instanceof ApiClientError &&
        (err.statusCode === 403 || err.errors.some((e) => (e.code ?? '').includes('UNAUTHORIZED')))
      ) {
        setScanError('Your account needs the SUPERUSER role to run test scans.');
      } else {
        setScanError('The scan service is unavailable.');
      }
    } finally {
      setScanning(false);
    }
  }

  const notDueYet = result?.skipBreakdown['SLA_NOT_BREACHED'] ?? 0;
  // SLA_NOT_BREACHED has its own tile; SUCCESS is a sentinel, not a skip.
  const attentionEntries = Object.entries(result?.skipBreakdown ?? {}).filter(
    ([code]) => code !== 'SLA_NOT_BREACHED' && code !== 'SUCCESS',
  );
  const needsAttention = attentionEntries.reduce((sum, [, count]) => sum + count, 0);

  return (
    // The id is the scroll target for PolicyCard's "Run a test scan
    // first" nudge in the role-escalation enable flow.
    <Card id="verify-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FlaskConical className="w-4 h-4 text-primary" />
          Check your configuration
        </CardTitle>
        <CardDescription>
          Runs the escalation check across all open complaints without changing anything, so you can
          see what your settings would do right now.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={runScan} disabled={scanning}>
            <FlaskConical className="w-3.5 h-3.5 mr-1.5" />
            {scanning ? 'Scanning…' : 'Run a test scan (changes nothing)'}
          </Button>
          <Button size="sm" variant="outline" onClick={onOpenTrace}>
            <Search className="w-3.5 h-3.5 mr-1.5" />
            Check a single complaint…
          </Button>
          {lastRun && (
            <span className="text-xs text-muted-foreground ml-auto">
              Last run {new Date(lastRun).toLocaleString()}
            </span>
          )}
        </div>

        {scanError && (
          <Alert variant="warning">
            <AlertTitle>Scan didn't run</AlertTitle>
            <AlertDescription>{scanError}</AlertDescription>
          </Alert>
        )}

        {result && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              <Tile label="Open complaints scanned" value={result.scanned} />
              <Tile label="Would escalate now" value={result.wouldEscalate} />
              <Tile label="In warning window" value={result.preBreachWarnings} />
              <Tile label="Not due yet" value={notDueYet} />
              <Tile label="Needs attention" value={needsAttention} highlight={needsAttention > 0} />
            </div>
            <p className="text-xs text-muted-foreground">
              Counts can overlap — a complaint can be both "not due yet" and "in warning window", and advisory rows count complaints that were still processed, so they also appear in the other tiles.
            </p>
            {attentionEntries.length > 0 && (
              <div className="rounded-md border border-border p-3 space-y-1.5">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Needs attention — by reason
                </h4>
                {attentionEntries.map(([code, count]) => {
                  const copy = SKIP_REASON_COPY[code] ?? UNKNOWN_SKIP_REASON;
                  return (
                    <div key={code} className="flex flex-wrap items-center gap-2 text-xs">
                      <Badge variant="outline" className="font-mono text-[10px] text-muted-foreground">
                        {code}
                      </Badge>
                      <span className="font-medium">{count}</span>
                      <span className="text-muted-foreground">{copy.explanation}</span>
                      {copy.advisory && (
                        <Badge variant="outline" className="bg-slate-50 text-slate-600 text-[10px]">
                          {ADVISORY_LABEL}
                        </Badge>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Tile({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div
      className={`rounded-md border p-3 ${
        highlight ? 'border-amber-200 bg-amber-50' : 'border-border bg-background'
      }`}
    >
      <p className="text-2xl font-semibold leading-tight">{value}</p>
      <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
    </div>
  );
}
