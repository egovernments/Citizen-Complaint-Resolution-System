import { useState } from 'react';
import { Search, AlertTriangle, CheckCircle2, Clock, UserX } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { digitClient } from '@/providers/bridge';
import type { MatrixRow } from './slaService';
import type { StateDefaults, CellValue } from './types';
import { effectiveHours, formatCell, type StateKey } from './types';

interface TraceBackDialogProps {
  open: boolean;
  onClose: () => void;
  tenantId: string;
  rows: MatrixRow[];
  stateDefaults: StateDefaults;
}

interface EscalationOutcome {
  serviceRequestId: string;
  action: 'ESCALATED' | 'WOULD_ESCALATE' | 'SKIPPED' | string;
  reason: string;
  detail: string;
}

interface TraceResult {
  outcome?: EscalationOutcome;
  complaint?: {
    serviceRequestId: string;
    applicationStatus: string;
    serviceCode?: string;
    assignee?: string;
    category?: string;
    subcategoryL1?: string;
    path?: string;
  };
  resolvedSla?: { source: 'CategorySLA' | 'StateSLA'; hours: number | null; rawValue?: CellValue };
  error?: string;
}

const STATE_TO_KEY: Record<string, StateKey> = {
  // Map DIGIT PGR workflow states → schema state keys. Conservative: only
  // the six states the schema's slaHoursByState keys cover. Anything else
  // falls back to null (and the resolvedSla pane shows "no matching state
  // column").
  // KNOWN GAP: this table duplicates the CRS.WorkflowStateMapping MDMS
  // master (which the backend scheduler reads). It should be replaced by
  // an MDMS fetch so both stay in sync — out of scope here.
  PENDINGFORASSIGNMENT: 'new',
  PENDINGATLME: 'forwarded',
  PENDING_AT_LME: 'forwarded',
  IN_TRIAGE: 'triage',
  TRIAGE: 'triage',
  FORWARDED: 'forwarded',
  UNDER_INVESTIGATION: 'investigation',
  INVESTIGATION: 'investigation',
  AWAITING_INFORMATION: 'awaiting',
  AWAITING: 'awaiting',
  RESOLVED: 'resolved',
};

/**
 * Diagnostic drawer for "why will (or won't) escalation fire on THIS
 * complaint right now?". Fans out:
 *
 *   1. POST /pgr-services/escalation/_trigger { serviceRequestIds: [srid],
 *      dryRun: true } to get the scheduler's verdict + reason without
 *      performing the escalation.
 *   2. GET /pgr-services/v2/request/_search?serviceRequestId=... to pull
 *      the current state + assignee.
 *   3. Resolves the matching SLA row from the matrix passed in by the
 *      parent (CategorySLA → StateSLA fallback) — mirrors the same
 *      precedence the backend scheduler uses, so the preview agrees with
 *      the scheduler's verdict for unbreached complaints.
 *
 * Runs the scheduler as a dry-run: decision only, no workflow transition —
 * safe to point at production complaints, even breached ones.
 */
export function TraceBackDialog({ open, onClose, tenantId, rows, stateDefaults }: TraceBackDialogProps) {
  const [srid, setSrid] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TraceResult | null>(null);

  function reset() {
    setSrid('');
    setResult(null);
    setLoading(false);
  }

  function handleClose() {
    if (loading) return;
    reset();
    onClose();
  }

  function resolveSla(complaint: TraceResult['complaint']): TraceResult['resolvedSla'] {
    if (!complaint) return undefined;
    const stateKey = STATE_TO_KEY[complaint.applicationStatus] ?? null;
    if (!stateKey) {
      return { source: 'StateSLA', hours: null };
    }
    // CategorySLA hit?
    const matchRow = rows.find(
      (r) => r.isActive && r.category === complaint.category && r.subcategoryL1 === complaint.subcategoryL1 && r.path === complaint.path,
    );
    if (matchRow) {
      const raw = matchRow.slaHoursByState[stateKey];
      if (raw !== null && raw !== undefined) {
        return { source: 'CategorySLA', hours: effectiveHours(raw), rawValue: raw };
      }
    }
    // Fall back to StateSLA
    return { source: 'StateSLA', hours: stateDefaults[stateKey] ?? null };
  }

  async function handleTrace() {
    const trimmed = srid.trim();
    if (!trimmed) return;
    setLoading(true);
    setResult(null);
    try {
      // 1. Scheduler invocation
      let outcome: EscalationOutcome | undefined;
      try {
        const triggerResp = await digitClient.request<{ details?: EscalationOutcome[] }>(
          '/pgr-services/escalation/_trigger',
          {
            RequestInfo: digitClient.buildRequestInfo(),
            tenantId,
            serviceRequestIds: [trimmed],
            // dry-run: decision only, no workflow transition — safe on breached complaints
            dryRun: true,
          },
        );
        outcome = triggerResp.details?.[0];
      } catch (err) {
        // If the admin endpoint is unavailable we still want to render the
        // complaint view + resolved-SLA panel, so swallow + tag.
        const msg = err instanceof Error ? err.message : 'trigger failed';
        outcome = {
          serviceRequestId: trimmed,
          action: 'SKIPPED',
          reason: 'TRIGGER_UNAVAILABLE',
          detail: msg,
        };
      }

      // 2. Complaint fetch
      const wrappers = await digitClient.pgrSearch(tenantId, { serviceRequestId: trimmed, limit: 1 });
      const wrapper = wrappers[0] as { service?: Record<string, unknown> } | undefined;
      const svc = wrapper?.service ?? {};
      const additionalDetail = (svc as Record<string, unknown>).additionalDetail as Record<string, unknown> | undefined;
      const complaint: TraceResult['complaint'] = {
        serviceRequestId: String((svc as Record<string, unknown>).serviceRequestId ?? trimmed),
        applicationStatus: String((svc as Record<string, unknown>).applicationStatus ?? 'UNKNOWN'),
        serviceCode: (svc as Record<string, unknown>).serviceCode as string | undefined,
        assignee: undefined, // workflow assignees not surfaced by /_search; populated by the trigger detail below
        category: additionalDetail?.category as string | undefined,
        subcategoryL1: additionalDetail?.subcategoryL1 as string | undefined,
        path: additionalDetail?.path as string | undefined,
      };

      const resolvedSla = resolveSla(complaint);
      setResult({ outcome, complaint, resolvedSla });
    } catch (err) {
      setResult({ error: err instanceof Error ? err.message : 'trace failed' });
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !loading) handleTrace();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Trace escalation</DialogTitle>
          <DialogDescription>
            Paste a service request ID to see whether the scheduler would
            escalate it right now, the resolved SLA, and the breach math.
            Runs the scheduler as a dry-run — decision only, nothing is
            escalated or persisted.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="trace-srid">Service request ID</Label>
            <div className="flex gap-2">
              <Input
                id="trace-srid"
                value={srid}
                onChange={(e) => setSrid(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="e.g. PGR-2026-04-21-001234"
                disabled={loading}
              />
              <Button onClick={handleTrace} disabled={loading || !srid.trim()}>
                <Search className="w-4 h-4 mr-1.5" />
                {loading ? 'Tracing…' : 'Trace'}
              </Button>
            </div>
          </div>

          {result?.error && (
            <Alert variant="destructive">
              <AlertTriangle className="w-4 h-4" />
              <AlertTitle>Trace failed</AlertTitle>
              <AlertDescription>{result.error}</AlertDescription>
            </Alert>
          )}

          {result?.outcome && <OutcomeBlock outcome={result.outcome} />}
          {result?.complaint && (
            <ComplaintBlock complaint={result.complaint} resolvedSla={result.resolvedSla} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function OutcomeBlock({ outcome }: { outcome: EscalationOutcome }) {
  // WOULD_ESCALATE is the dry-run analogue of ESCALATED — same success styling.
  const isEscalation = outcome.action === 'ESCALATED' || outcome.action === 'WOULD_ESCALATE';
  const variant: 'success' | 'warning' | 'info' = isEscalation
    ? 'success'
    : outcome.reason === 'SLA_NOT_BREACHED' ? 'info' : 'warning';
  const Icon = isEscalation
    ? CheckCircle2
    : outcome.reason === 'NO_ASSIGNEES'
      ? UserX
      : outcome.reason === 'SLA_NOT_BREACHED'
        ? Clock
        : AlertTriangle;
  const actionLabel = outcome.action === 'WOULD_ESCALATE' ? 'Would escalate' : outcome.action;
  return (
    <Alert variant={variant}>
      <Icon className="w-4 h-4" />
      <AlertTitle className="flex items-center gap-2">
        Scheduler verdict
        <Badge variant="outline" className="text-[10px] uppercase tracking-wider">{actionLabel}</Badge>
        <Badge variant="outline" className="text-[10px]">{outcome.reason}</Badge>
      </AlertTitle>
      <AlertDescription>
        <code className="text-xs">{outcome.detail || '(no detail)'}</code>
      </AlertDescription>
    </Alert>
  );
}

function ComplaintBlock({
  complaint,
  resolvedSla,
}: {
  complaint: NonNullable<TraceResult['complaint']>;
  resolvedSla?: TraceResult['resolvedSla'];
}) {
  return (
    <div className="rounded-md border border-border p-3 space-y-2 text-sm">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Complaint
      </h4>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">SR ID</dt>
        <dd className="font-mono">{complaint.serviceRequestId}</dd>
        <dt className="text-muted-foreground">Status</dt>
        <dd><Badge variant="outline">{complaint.applicationStatus}</Badge></dd>
        {complaint.serviceCode && (
          <>
            <dt className="text-muted-foreground">Service code</dt>
            <dd className="font-mono">{complaint.serviceCode}</dd>
          </>
        )}
        {complaint.path && (
          <>
            <dt className="text-muted-foreground">Path</dt>
            <dd>{complaint.path}</dd>
          </>
        )}
        {complaint.category && (
          <>
            <dt className="text-muted-foreground">Category</dt>
            <dd>{complaint.category}</dd>
          </>
        )}
        {complaint.subcategoryL1 && (
          <>
            <dt className="text-muted-foreground">Subcategory L1</dt>
            <dd>{complaint.subcategoryL1}</dd>
          </>
        )}
        {resolvedSla && (
          <>
            <dt className="text-muted-foreground">Resolved SLA</dt>
            <dd>
              {resolvedSla.hours === null ? (
                <span className="text-muted-foreground">no matching state column</span>
              ) : (
                <span>
                  {formatCell(resolvedSla.rawValue ?? resolvedSla.hours)}
                  <span className="ml-1.5 text-[10px] text-muted-foreground">via {resolvedSla.source}</span>
                </span>
              )}
            </dd>
          </>
        )}
      </dl>
    </div>
  );
}
