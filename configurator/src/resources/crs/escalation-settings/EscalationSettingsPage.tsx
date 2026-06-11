/**
 * Escalation Settings — deployment-wide escalation configurator page.
 *
 * One screen for the two records the SLA Matrix doesn't cover:
 * CRS.EscalationPolicy (behaviour: depth, level defaults, pre-breach
 * warning, manual-escalate comment) and CRS.WorkflowStateMapping (the
 * gate that lets per-state SLAs apply at all). Both live at the
 * STATE-LEVEL tenant only — slaService normalises every read/write and
 * the header says so, because a city-tenant copy would silently
 * split-brain the scheduler (see toStateTenant in slaService.ts).
 *
 * Page anatomy, top to bottom:
 *   - setup banner (only while the status mapping is empty)
 *   - Card 1: the SLA resolution cascade with live chips
 *   - Card 2: escalation behaviour (policy form)
 *   - Card 3: complaint-status mapping
 *   - Card 4: test scan + single-complaint check (TraceBackDialog)
 *   - Recent changes (collapsible audit list)
 */
import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../../App';
import { Settings, AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type { MdmsRecord } from '@digit-mcp/data-provider';
import {
  loadCategorySla,
  loadStateSla,
  loadEscalationPolicy,
  loadWorkflowStateMapping,
  toStateTenant,
  type AuditActor,
  type MatrixRow,
} from '../sla-matrix/slaService';
import { DEFAULT_STATE_DEFAULTS, type StateDefaults } from '../sla-matrix/types';
import type { EscalationPolicy, WorkflowStateMapping } from '../sla-matrix/escalationTypes';
import { TraceBackDialog } from '../sla-matrix/TraceBackDialog';
import { loadLegacyEscalationConfig, type LegacyEscalationConfig } from './legacyConfig';
import { CascadeCard } from './CascadeCard';
import { PolicyCard } from './PolicyCard';
import { StateMappingCard } from './StateMappingCard';
import { VerifyCard } from './VerifyCard';
import { RecentChangesCard } from './RecentChangesCard';

export function EscalationSettingsPage() {
  const { state } = useApp();
  const tenantId = state.targetTenant || state.tenant;
  const stateTenant = toStateTenant(tenantId);
  const actor: AuditActor = { uuid: state.user?.uuid, name: state.user?.name };

  // --- state ---
  const [rows, setRows] = useState<MatrixRow[]>([]);
  const [stateDefaults, setStateDefaults] = useState<StateDefaults>(DEFAULT_STATE_DEFAULTS);
  const [policy, setPolicy] = useState<EscalationPolicy | null>(null);
  const [policyRecord, setPolicyRecord] = useState<MdmsRecord | undefined>();
  const [mapping, setMapping] = useState<WorkflowStateMapping | null>(null);
  const [mappingRecord, setMappingRecord] = useState<MdmsRecord | undefined>();
  const [legacy, setLegacy] = useState<LegacyEscalationConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showTrace, setShowTrace] = useState(false);
  // Bumped per successful load — remounts the form cards (they own their
  // drafts after mount, AddRowDialog-style) so a Reload reseeds them.
  const [loadCount, setLoadCount] = useState(0);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Matrix data loads at the page tenant (same as the matrix page —
      // city searches see root-inherited rows); the two singletons + the
      // legacy record are state-tenant reads (the loaders normalise).
      const [matrixRows, sla, pol, map, legacyCfg] = await Promise.all([
        loadCategorySla(tenantId),
        loadStateSla(tenantId),
        loadEscalationPolicy(tenantId),
        loadWorkflowStateMapping(tenantId),
        loadLegacyEscalationConfig(toStateTenant(tenantId)),
      ]);
      setRows(matrixRows);
      setStateDefaults(sla.defaults);
      setPolicy(pol.policy);
      setPolicyRecord(pol.record);
      setMapping(map.mapping);
      setMappingRecord(map.record);
      setLegacy(legacyCfg);
      setLoadCount((n) => n + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load escalation settings');
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const mappingCount = Object.keys(mapping?.mappings ?? {}).length;
  const mappingEmpty = mappingCount === 0;

  function jumpToMapping() {
    document.getElementById('status-mapping')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <div className="space-y-4 max-w-4xl">
      {/* Header */}
      <header className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-condensed font-bold tracking-tight flex items-center gap-2">
            <Settings className="w-6 h-6 text-primary" />
            Escalation Settings
          </h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            These settings apply to the whole deployment (tenant: {stateTenant}).
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={reload} disabled={loading}>
          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
          Reload
        </Button>
      </header>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="w-4 h-4" />
          <AlertTitle>Couldn't load escalation settings</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading && !error && (
        <p className="text-sm text-muted-foreground text-center py-12">Loading…</p>
      )}

      {!loading && !error && (
        <>
          {/* Setup banner — only while the gate is open */}
          {mappingEmpty && (
            <Alert variant="warning">
              <AlertTriangle className="w-4 h-4" />
              <AlertTitle>Complaint statuses aren't mapped yet</AlertTitle>
              <AlertDescription>
                Per-state SLAs (the SLA Matrix) have no effect until you map them below.{' '}
                <button onClick={jumpToMapping} className="underline font-medium">
                  Go to status mapping
                </button>
              </AlertDescription>
            </Alert>
          )}

          <CascadeCard
            rows={rows}
            stateDefaults={stateDefaults}
            policy={policy}
            legacy={legacy}
            mappingCount={mappingCount}
            onJumpToMapping={jumpToMapping}
          />

          <PolicyCard
            key={`policy-${loadCount}`}
            tenantId={tenantId}
            actor={actor}
            policy={policy}
            record={policyRecord}
            legacy={legacy}
            onSaved={(p, rec) => {
              setPolicy(p);
              setPolicyRecord(rec);
            }}
          />

          <StateMappingCard
            key={`mapping-${loadCount}`}
            tenantId={tenantId}
            actor={actor}
            mapping={mapping}
            record={mappingRecord}
            onSaved={(m, rec) => {
              setMapping(m);
              setMappingRecord(rec);
            }}
          />

          <VerifyCard stateTenant={stateTenant} onOpenTrace={() => setShowTrace(true)} />

          <RecentChangesCard stateTenant={stateTenant} />
        </>
      )}

      <TraceBackDialog
        open={showTrace}
        onClose={() => setShowTrace(false)}
        tenantId={tenantId}
        rows={rows}
        stateDefaults={stateDefaults}
      />
    </div>
  );
}
