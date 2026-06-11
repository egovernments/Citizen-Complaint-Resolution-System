import { useEffect, useMemo, useState } from 'react';
import { Search, AlertTriangle, CheckCircle2, Clock, UserX } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { digitClient } from '@/providers/bridge';
import {
  loadEscalationPolicy,
  loadStateSla,
  loadWorkflowStateMapping,
  type MatrixRow,
} from './slaService';
import type { EscalationPolicy } from './escalationTypes';
import { STANDARD_STATE_MAPPINGS } from './standardStateMappings';
import {
  SLA_SOURCE,
  SLA_SOURCE_ORDER,
  resolveSlaPreview,
  type ResolvedSlaPreview,
  type SlaSource,
} from './resolveSlaPreview';
import type { StateDefaults, CellValue } from './types';
import { STATE_LABELS, formatCell, type StateKey } from './types';

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
  /**
   * Winning SLA-resolution layer reported by the server (one of the
   * SLA_SOURCE constants). Optional: null on outcomes decided before SLA
   * resolution runs (MAX_DEPTH_REACHED / NO_LAST_MODIFIED_TIME) and absent
   * entirely on backends that predate the field — the path list falls back
   * to client-estimate labelling in both cases.
   */
  slaSource?: string | null;
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
    escalationLevel?: number;
  };
  error?: string;
}

/** Operator-facing names for the five resolution sources (no schema codes). */
const SOURCE_LABELS: Record<SlaSource, string> = {
  [SLA_SOURCE.categoryLevel]: 'Per-category level SLAs (SLA Matrix → Levels)',
  [SLA_SOURCE.categoryState]: 'Per-category state SLAs (SLA Matrix cells)',
  [SLA_SOURCE.policyLevel]: 'Deployment-wide level SLAs (Escalation Settings)',
  [SLA_SOURCE.stateDefault]: 'Deployment-wide state SLAs (SLA Matrix → Defaults row)',
  [SLA_SOURCE.legacy]: 'Previous SLA settings (Legacy page)',
};

const KNOWN_SOURCES = new Set<string>(SLA_SOURCE_ORDER);

/**
 * Diagnostic dialog for "why will (or won't) escalation fire on THIS
 * complaint right now?". Fans out:
 *
 *   1. POST /pgr-services/escalation/_trigger { serviceRequestIds: [srid],
 *      dryRun: true } to get the scheduler's verdict + reason + winning
 *      slaSource without performing the escalation.
 *   2. GET /pgr-services/v2/request/_search?serviceRequestId=... to pull
 *      the current state + category tuple + escalation level.
 *   3. resolveSlaPreview (shared client mirror of the backend's
 *      resolveSlaHours) annotates every source in the cascade; the WINNER
 *      highlight comes from the server's slaSource when the trigger call
 *      succeeded — server truth, not client guess. When they disagree
 *      (e.g. Strategy-B tenants whose category tuple lives in ServiceDefs,
 *      invisible to this preview) the client values are labelled estimates.
 *
 * On open it loads the tenant's status mapping, escalation policy and
 * state defaults via slaService so the preview reflects what the scheduler
 * actually reads; with no tenant mapping saved it falls back to the
 * built-in table (the backend does NOT — the server verdict wins).
 */
export function TraceBackDialog({ open, onClose, tenantId, rows, stateDefaults }: TraceBackDialogProps) {
  const [srid, setSrid] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TraceResult | null>(null);

  // Tenant escalation config, loaded on open. null mapping = none saved
  // (preview falls back to the built-in table, with a note).
  const [tenantMapping, setTenantMapping] = useState<Record<string, string> | null>(null);
  const [policy, setPolicy] = useState<EscalationPolicy | null>(null);
  const [loadedDefaults, setLoadedDefaults] = useState<StateDefaults | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      // Each load is independently best-effort — a missing schema on this
      // tenant must not take down the trace surface.
      const [m, p, d] = await Promise.all([
        loadWorkflowStateMapping(tenantId).catch(() => ({ mapping: null })),
        loadEscalationPolicy(tenantId).catch(() => ({ policy: null })),
        loadStateSla(tenantId).catch(() => null),
      ]);
      if (cancelled) return;
      setTenantMapping(
        m.mapping && Object.keys(m.mapping.mappings).length > 0 ? m.mapping.mappings : null,
      );
      setPolicy(p.policy);
      setLoadedDefaults(d ? d.defaults : null);
    })();
    return () => { cancelled = true; };
  }, [open, tenantId]);

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
            // dryRun: decision only, no workflow transition — safe on breached complaints
            dryRun: true,
          },
        );
        outcome = triggerResp.details?.[0];
      } catch (err) {
        // If the admin endpoint is unavailable we still want to render the
        // complaint view + resolution path, so swallow + tag.
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
      // Mirrors the backend's getEscalationLevel: only a JSON number counts;
      // anything else (string, missing) resolves at level 0.
      const rawLevel = additionalDetail?.escalationLevel;
      const complaint: TraceResult['complaint'] = {
        serviceRequestId: String((svc as Record<string, unknown>).serviceRequestId ?? trimmed),
        applicationStatus: String((svc as Record<string, unknown>).applicationStatus ?? 'UNKNOWN'),
        serviceCode: (svc as Record<string, unknown>).serviceCode as string | undefined,
        assignee: undefined, // workflow assignees not surfaced by /_search; populated by the trigger detail below
        category: additionalDetail?.category as string | undefined,
        subcategoryL1: additionalDetail?.subcategoryL1 as string | undefined,
        path: additionalDetail?.path as string | undefined,
        escalationLevel: typeof rawLevel === 'number' ? rawLevel : undefined,
      };

      setResult({ outcome, complaint });
    } catch (err) {
      setResult({ error: err instanceof Error ? err.message : 'trace failed' });
    } finally {
      setLoading(false);
    }
  }

  // Client-side resolution preview — recomputed when the tenant config
  // finishes loading so a slow MDMS read still annotates the path list.
  const preview = useMemo<ResolvedSlaPreview | null>(() => {
    if (!result?.complaint) return null;
    return resolveSlaPreview(
      {
        workflowState: result.complaint.applicationStatus,
        escalationLevel: result.complaint.escalationLevel ?? null,
        path: result.complaint.path ?? null,
        category: result.complaint.category ?? null,
        subcategoryL1: result.complaint.subcategoryL1 ?? null,
      },
      {
        rows,
        stateDefaults: loadedDefaults ?? stateDefaults,
        policy,
        stateMapping: tenantMapping ?? STANDARD_STATE_MAPPINGS,
      },
    );
  }, [result, rows, stateDefaults, loadedDefaults, policy, tenantMapping]);

  // Server truth: only trust slaSource from a real trigger response, and
  // only when it names a source this UI knows how to render.
  const serverSource: SlaSource | null =
    result?.outcome &&
    result.outcome.reason !== 'TRIGGER_UNAVAILABLE' &&
    typeof result.outcome.slaSource === 'string' &&
    KNOWN_SOURCES.has(result.outcome.slaSource)
      ? (result.outcome.slaSource as SlaSource)
      : null;

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !loading) handleTrace();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Trace escalation</DialogTitle>
          <DialogDescription>
            Paste a service request ID to see whether the scheduler would
            escalate it right now, which SLA source applies, and the breach
            math. Runs as a test scan (changes nothing) — nothing is
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
          {preview && result?.complaint && (
            <ResolutionPathBlock
              preview={preview}
              serverSource={serverSource}
              status={result.complaint.applicationStatus}
              usingBuiltinMapping={tenantMapping === null}
            />
          )}
          {result?.complaint && (
            <ComplaintBlock
              complaint={result.complaint}
              resolvedSla={preview ? summarizeWinner(preview, serverSource) : undefined}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function OutcomeBlock({ outcome }: { outcome: EscalationOutcome }) {
  // WOULD_ESCALATE is the test-scan analogue of ESCALATED — same success styling.
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

// ---------------------------------------------------------------------------
// ResolutionPathBlock — gate row + the 5 sources, winner highlighted
// ---------------------------------------------------------------------------
function ResolutionPathBlock({
  preview,
  serverSource,
  status,
  usingBuiltinMapping,
}: {
  preview: ResolvedSlaPreview;
  /** Server's slaSource (truth), or null when unavailable → client estimate. */
  serverSource: SlaSource | null;
  status: string;
  usingBuiltinMapping: boolean;
}) {
  const winner = serverSource ?? preview.source;
  const serverConfirmed = serverSource !== null;
  const disagreement = serverConfirmed && serverSource !== preview.source;
  // Strategy-B tenants: the server matched a category source through the
  // service definition, which this preview can't read (no tuple on the
  // complaint) — every client annotation is an estimate there.
  const strategyB =
    preview.unmappedCategory &&
    (serverSource === SLA_SOURCE.categoryLevel || serverSource === SLA_SOURCE.categoryState);

  const columnLabel = preview.stateKey
    ? STATE_LABELS[preview.stateKey as StateKey] ?? preview.stateKey
    : null;

  return (
    <div className="rounded-md border border-border p-3 space-y-2 text-sm">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Resolution path
      </h4>
      <p className="text-xs text-muted-foreground">
        Checked top to bottom — the first source with a value wins.
      </p>

      {/* Gate row — the status mapping decides whether per-state sources apply */}
      <div className="rounded border border-dashed border-border bg-muted/40 px-2 py-1.5 text-xs flex items-center gap-2 flex-wrap">
        <span className="font-medium">Complaint-status mapping</span>
        {columnLabel ? (
          <span className="text-muted-foreground">
            status <Badge variant="outline" className="text-[10px] font-mono">{status}</Badge>{' '}
            → {columnLabel} column
          </span>
        ) : (
          <span className="text-amber-700">
            status <Badge variant="outline" className="text-[10px] font-mono">{status}</Badge>{' '}
            isn't mapped — per-state sources below are skipped
          </span>
        )}
        {usingBuiltinMapping && (
          <span className="text-muted-foreground italic">
            using built-in status mapping — none configured
          </span>
        )}
      </div>

      <ol className="space-y-1">
        {SLA_SOURCE_ORDER.map((src, i) => {
          const annotation = preview.sources.find((s) => s.source === src);
          const isWinner = src === winner;
          const isLegacy = src === SLA_SOURCE.legacy;
          const isClientPick = src === preview.source;
          let valueNode: React.ReactNode;
          if (isLegacy) {
            valueNode = (
              <span className="text-muted-foreground">
                final fallback — value held by the server
              </span>
            );
          } else if (annotation?.blocked) {
            valueNode = (
              <span className="text-muted-foreground italic">
                {src === SLA_SOURCE.categoryLevel || src === SLA_SOURCE.categoryState
                  ? preview.unmappedCategory
                    ? 'no category details on this complaint'
                    : 'status not mapped'
                  : 'status not mapped'}
              </span>
            );
          } else if (annotation && annotation.hours !== null) {
            valueNode = (
              <span className="font-medium">
                {formatCell(annotation.rawValue ?? annotation.hours)}
                {(disagreement || strategyB) && (
                  <span className="ml-1 text-[10px] text-muted-foreground font-normal">estimated</span>
                )}
              </span>
            );
          } else {
            valueNode = <span className="text-muted-foreground">—</span>;
          }
          return (
            <li
              key={src}
              className={`flex items-center gap-2 rounded px-2 py-1.5 text-xs ${
                isWinner ? 'border border-primary/50 bg-primary/5' : 'border border-transparent'
              }`}
            >
              <span className="text-muted-foreground w-4 shrink-0">{i + 1}.</span>
              <span className="flex-1 min-w-0">{SOURCE_LABELS[src]}</span>
              {valueNode}
              {isWinner && (
                <Badge variant="outline" className="text-[10px] uppercase tracking-wider shrink-0">
                  {serverConfirmed ? 'winner' : 'winner — estimate'}
                </Badge>
              )}
              {!isWinner && disagreement && isClientPick && (
                <Badge variant="outline" className="text-[10px] shrink-0 text-muted-foreground">
                  this preview's pick
                </Badge>
              )}
            </li>
          );
        })}
      </ol>

      {strategyB && (
        <p className="text-xs text-muted-foreground">
          The server matched this complaint's category through its service
          definition, which this preview can't see — values above are
          estimates; the highlighted winner is the server's decision.
        </p>
      )}
      {disagreement && !strategyB && (
        <p className="text-xs text-muted-foreground">
          This preview's estimate disagrees with the server — the highlighted
          winner is the server's decision.
        </p>
      )}
      {!serverConfirmed && (
        <p className="text-xs text-muted-foreground">
          The scan didn't report which source it used, so the highlighted
          winner is this preview's estimate.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Winner summary for the complaint pane's "Resolved SLA" row
// ---------------------------------------------------------------------------
interface ResolvedSlaSummary {
  hours: number | null;
  rawValue?: CellValue;
  sourceLabel: string;
  estimated: boolean;
}

function summarizeWinner(preview: ResolvedSlaPreview, serverSource: SlaSource | null): ResolvedSlaSummary {
  const winner = serverSource ?? preview.source;
  if (winner === preview.source) {
    return {
      hours: preview.hours,
      rawValue: preview.rawValue,
      sourceLabel: SOURCE_LABELS[winner],
      estimated: serverSource === null,
    };
  }
  // Server picked a source the client preview didn't — annotate from the
  // per-source list (may be null, e.g. Strategy-B category values).
  const annotation = preview.sources.find((s) => s.source === winner);
  return {
    hours: annotation?.hours ?? null,
    rawValue: annotation?.rawValue,
    sourceLabel: SOURCE_LABELS[winner],
    estimated: true,
  };
}

function ComplaintBlock({
  complaint,
  resolvedSla,
}: {
  complaint: NonNullable<TraceResult['complaint']>;
  resolvedSla?: ResolvedSlaSummary;
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
                <span className="text-muted-foreground">value held by the server</span>
              ) : (
                <span>{formatCell(resolvedSla.rawValue ?? resolvedSla.hours)}</span>
              )}
              <span className="ml-1.5 text-[10px] text-muted-foreground">
                via {resolvedSla.sourceLabel}
                {resolvedSla.estimated ? ' (estimated)' : ''}
              </span>
            </dd>
          </>
        )}
      </dl>
    </div>
  );
}
