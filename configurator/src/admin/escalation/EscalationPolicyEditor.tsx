import { useState, useEffect, useMemo, useCallback } from 'react';
import { useApp } from '@/App';
import { mdmsService } from '@/api/services/mdms';
import { MDMS_SCHEMAS } from '@/api/config';
import { DigitCard } from '@/components/digit/DigitCard';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from "@/hooks/use-toast"

import {
  Sliders,
  FileText,
  Save,
  RefreshCw,
  AlertTriangle,
  Check,
  Copy,
  Layers,
  ShieldAlert,
  Loader2,
} from 'lucide-react';
import type {
  CatalogueItem,
  EscalationConfigData,
  EscalationLevelOverride,
} from './escalationPolicyTypes';
import type { MdmsRecord } from '@/api/types';
import {
  buildHierarchyCatalogue,
  diffEscalationPolicy,
  validateLadder,
} from './escalationPolicyUtils';
import { EscalationLevelTable } from './EscalationLevelTable';
import { ComplaintTypeOverridesTable } from './ComplaintTypeOverridesTable';
import { OverrideEditDialog } from './OverrideEditDialog';
import { SaveConfirmDialog } from './SaveConfirmDialog';

const DEFAULT_POLICY: EscalationConfigData = {
  code: 'DEFAULT',
  maxDepth: 3,
  eligibleStatuses: ['PENDINGATLME'],
  defaultSlaPercentageByLevel: [80, 120, 200],
  defaultSlaByLevel: [3600000, 14400000, 86400000],
  enabledByLevel: [true, true, true],
  overrides: {},
};

export function EscalationPolicyEditor() {
  const { state } = useApp();
  const { toast } = useToast();

  const tenantId = state.tenant || 'ke';
  const rootTenant = tenantId.split('.')[0] || 'ke';
  const isStatePolicy = tenantId === rootTenant;

  const [record, setRecord] = useState<MdmsRecord | null>(null);
  const [draft, setDraft] = useState<EscalationConfigData>(DEFAULT_POLICY);
  const [initialDraft, setInitialDraft] = useState<EscalationConfigData>(DEFAULT_POLICY);
  const [rawHierarchyRecords, setRawHierarchyRecords] = useState<
    Array<{ tenantId?: string; data?: Record<string, unknown> }>
  >([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [inheritedCount, setInheritedCount] = useState<number>(0);
  const [editingItem, setEditingItem] = useState<CatalogueItem | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [copiedJson, setCopiedJson] = useState(false);
  const [statusInput, setStatusInput] = useState('');

  // Initial load
  const loadPolicy = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setSaveError(null);

    try {
      // 1. Fetch EscalationConfig record (own record, or fallback to rootTenant if city has no own record)
      let policyRecord = await mdmsService.getEscalationConfig(tenantId);
      if (!policyRecord && tenantId !== rootTenant) {
        policyRecord = await mdmsService.getEscalationConfig(rootTenant);
      }

      const rawMaxDepth =
        policyRecord?.data?.maxDepth != null ? Number(policyRecord.data.maxDepth) : NaN;
      const initialMaxDepth = Number.isFinite(rawMaxDepth) && rawMaxDepth >= 0 ? rawMaxDepth : 3;

      const rawPcts = Array.isArray(policyRecord?.data?.defaultSlaPercentageByLevel)
        ? (policyRecord.data.defaultSlaPercentageByLevel as number[])
        : undefined;

      const rawFallbacks = Array.isArray(policyRecord?.data?.defaultSlaByLevel)
        ? (policyRecord.data.defaultSlaByLevel as number[])
        : undefined;

      const rawEnabled = Array.isArray(policyRecord?.data?.enabledByLevel)
        ? (policyRecord.data.enabledByLevel as boolean[])
        : undefined;

      const policyData: EscalationConfigData = policyRecord?.data
        ? {
            code: 'DEFAULT',
            maxDepth: initialMaxDepth,
            eligibleStatuses: Array.isArray(policyRecord.data.eligibleStatuses)
              ? (policyRecord.data.eligibleStatuses as string[])
              : ['PENDINGATLME'],
            ...(rawPcts ? { defaultSlaPercentageByLevel: rawPcts } : {}),
            ...(rawFallbacks ? { defaultSlaByLevel: rawFallbacks } : {}),
            ...(rawEnabled ? { enabledByLevel: rawEnabled } : {}),
            overrides:
              (policyRecord.data.overrides as Record<string, EscalationLevelOverride>) || {},
          }
        : DEFAULT_POLICY;

      setRecord(policyRecord);
      setDraft(policyData);
      setInitialDraft(JSON.parse(JSON.stringify(policyData)));

      // 2. Fetch ComplaintHierarchy records using standard searchRecords
      let hierarchy = await mdmsService.searchRecords(
        tenantId,
        MDMS_SCHEMAS.COMPLAINT_HIERARCHY,
        { limit: 5000 }
      );
      hierarchy = hierarchy.filter((r) => r.tenantId === tenantId);

      // If city tenant has no hierarchy rows, fall back to state hierarchy
      if (hierarchy.length === 0 && tenantId !== rootTenant) {
        const rootHierarchy = await mdmsService.searchRecords(
          rootTenant,
          MDMS_SCHEMAS.COMPLAINT_HIERARCHY,
          { limit: 5000 }
        );
        hierarchy = rootHierarchy.filter((r) => r.tenantId === rootTenant);
      }
      setRawHierarchyRecords(hierarchy);

      // 3. Fetch tenants to calculate how many inherit if state policy
      try {
        const tenants = await mdmsService.getTenants(rootTenant);
        const cityTenants = tenants.filter((t) => t.code !== rootTenant);
        setInheritedCount(cityTenants.length);
      } catch {
        setInheritedCount(0);
      }
    } catch (err) {
      setLoadError((err as Error)?.message || 'Failed to load PGR Escalation Policy.');
    } finally {
      setLoading(false);
    }
  }, [tenantId, rootTenant]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadPolicy();
  }, [loadPolicy]);

  // Derived catalogue and orphaned overrides (with normalized defaults)
  const { catalogue, orphanedOverrides } = useMemo(() => {
    return buildHierarchyCatalogue(rawHierarchyRecords, draft.overrides, {
      percentages: draft.defaultSlaPercentageByLevel,
      enabledByLevel: draft.enabledByLevel,
      fallbacks: draft.defaultSlaByLevel,
    });
  }, [
    rawHierarchyRecords,
    draft.overrides,
    draft.defaultSlaPercentageByLevel,
    draft.enabledByLevel,
    draft.defaultSlaByLevel,
  ]);

  // Validate current default ladder
  const ladderValidation = useMemo(() => {
    if (draft.maxDepth === 0) {
      return { valid: true, pctErrors: [], fallbackErrors: [] };
    }
    return validateLadder(
      draft.defaultSlaPercentageByLevel || [],
      draft.defaultSlaByLevel || []
    );
  }, [draft.maxDepth, draft.defaultSlaPercentageByLevel, draft.defaultSlaByLevel]);

  // Handle maxDepth change
  const handleMaxDepthChange = (newDepth: number) => {
    if (isNaN(newDepth) || !Number.isInteger(newDepth) || newDepth < 0 || newDepth > 5) return;
    const depth = newDepth;
    if (depth === 0) {
      setDraft((prev) => ({
        ...prev,
        maxDepth: 0,
      }));
      return;
    }

    const nextPcts = draft.defaultSlaPercentageByLevel
      ? [...draft.defaultSlaPercentageByLevel]
      : [80, 120, 200];
    const nextEnabled = draft.enabledByLevel ? [...draft.enabledByLevel] : [true, true, true];
    const nextFallbacks = draft.defaultSlaByLevel
      ? [...draft.defaultSlaByLevel]
      : [3600000, 14400000, 86400000];

    while (nextPcts.length < depth) {
      const lastPct = nextPcts[nextPcts.length - 1] ?? 80;
      if (lastPct >= 200) break;
      nextPcts.push(Math.min(200, lastPct + 40));
    }
    while (nextEnabled.length < depth) {
      const lastEn = nextEnabled[nextEnabled.length - 1] ?? true;
      nextEnabled.push(lastEn);
    }
    while (nextFallbacks.length < depth) {
      const lastFb = nextFallbacks[nextFallbacks.length - 1] ?? 3600000;
      nextFallbacks.push(lastFb + 28800000);
    }

    setDraft((prev) => ({
      ...prev,
      maxDepth: depth,
      defaultSlaPercentageByLevel: nextPcts.slice(0, depth),
      enabledByLevel: nextEnabled.slice(0, depth),
      defaultSlaByLevel: nextFallbacks.slice(0, depth),
    }));
  };

  // Add / Remove Level
  const handleAddLevel = () => {
    if (draft.maxDepth >= 5) return;
    const currentPcts = draft.defaultSlaPercentageByLevel || [];
    const lastPct = currentPcts[currentPcts.length - 1];
    if (lastPct !== undefined && lastPct >= 200) {
      toast({
        variant: 'destructive',
        title: 'Cannot add level',
        description:
          'The maximum cumulative SLA percentage (200%) has already been reached on the highest level.',
      });
      return;
    }
    handleMaxDepthChange(draft.maxDepth + 1);
  };

  const handleRemoveLevel = () => {
    if (draft.maxDepth > 0) handleMaxDepthChange(draft.maxDepth - 1);
  };

  // Update default level arrays
  const handleLadderChange = (
    pcts: number[],
    enabled: boolean[],
    fallbacks: number[]
  ) => {
    setDraft((prev) => ({
      ...prev,
      defaultSlaPercentageByLevel: pcts,
      enabledByLevel: enabled,
      defaultSlaByLevel: fallbacks,
    }));
  };

  // Add / Remove eligible statuses
  const handleAddStatus = () => {
    const s = statusInput.trim().toUpperCase();
    if (!s) return;
    if (draft.eligibleStatuses.includes(s)) {
      toast({
        variant: 'destructive',
        title: 'Duplicate status',
        description: `Status ${s} is already in the automatic escalation list.`,
      });
      return;
    }
    if (!draft.eligibleStatuses.includes(s)) {
      setDraft((prev) => ({
        ...prev,
        eligibleStatuses: [...prev.eligibleStatuses, s],
      }));
      setStatusInput('');
    }
  };

  const handleRemoveStatus = (status: string) => {
    setDraft((prev) => ({
      ...prev,
      eligibleStatuses: prev.eligibleStatuses.filter((s) => s !== status),
    }));
  };

  // Apply single override
  const handleApplyOverride = (
    serviceCode: string,
    override: EscalationLevelOverride | null
  ) => {
    const nextOverrides = { ...draft.overrides };
    if (override) {
      nextOverrides[serviceCode] = override;
    } else {
      delete nextOverrides[serviceCode];
    }
    setDraft((prev) => ({ ...prev, overrides: nextOverrides }));
  };

  // Bulk apply default ladder to unconfigured items
  const handleBulkApply = (serviceCodes: string[]) => {
    const nextOverrides = { ...draft.overrides };
    const pcts = draft.defaultSlaPercentageByLevel || [80, 120, 200];
    const en = draft.enabledByLevel || [true, true, true];
    const fb = draft.defaultSlaByLevel || [3600000, 14400000, 86400000];

    for (const code of serviceCodes) {
      nextOverrides[code] = {
        slaPercentageByLevel: [...pcts],
        enabledByLevel: [...en],
        slaByLevel: [...fb],
      };
    }
    setDraft((prev) => ({ ...prev, overrides: nextOverrides }));
    toast({
      title: 'Overrides applied',
      description: `Applied policy ladder to ${serviceCodes.length} complaint types.`,
    });
  };

  // Diff summary
  const diffs = useMemo(() => {
    return diffEscalationPolicy(initialDraft, draft);
  }, [initialDraft, draft]);

  const hasFunctionalChanges = useMemo(() => {
    return diffs.length > 0 && !diffs.includes('No functional policy changes detected.');
  }, [diffs]);

  // Initiate Save (open confirmation dialog)
  const handleInitiateSave = () => {
    if (!ladderValidation.valid) {
      toast({
        variant: 'destructive',
        title: 'Validation Error',
        description: 'Please fix the errors in the cumulative SLA percentage ladder.',
      });
      return;
    }
    if (!hasFunctionalChanges) {
      toast({
        title: 'No Changes',
        description: 'No functional changes detected to save.',
      });
      return;
    }
    setConfirmOpen(true);
  };

  // Perform Save with Concurrency Check
  const handleConfirmSave = async () => {
    setSaving(true);
    setSaveError(null);

    try {
      // 1. Optimistic locking check: ensure record wasn't updated in background
      if (record && record.tenantId === tenantId) {
        const latestRecords = await mdmsService.searchRecords(
          tenantId,
          MDMS_SCHEMAS.ESCALATION_CONFIG
        );
        const active = latestRecords.filter(
          (r) => r.isActive !== false && r.tenantId === tenantId
        );
        const latest = active.find((r) => r.uniqueIdentifier === 'DEFAULT') ?? active[0];

        if (
          latest?.auditDetails?.lastModifiedTime &&
          record.auditDetails?.lastModifiedTime &&
          latest.auditDetails.lastModifiedTime > record.auditDetails.lastModifiedTime
        ) {
          throw new Error(
            'This policy was modified by another administrator since you loaded it. Please reload the page to review the latest changes.'
          );
        }
      }

      // 2. Persist update
      let savedRecord: MdmsRecord;
      if (record && record.tenantId === tenantId) {
        savedRecord = await mdmsService.saveEscalationConfig(record, draft);
      } else {
        // Creating a city-specific record or first record
        // Preserve any round-tripped extra fields from state record
        const payload: EscalationConfigData = {
          ...(record?.data || {}),
          ...draft,
          code: 'DEFAULT',
        };
        savedRecord = await mdmsService.create(
          tenantId,
          MDMS_SCHEMAS.ESCALATION_CONFIG,
          'DEFAULT',
          payload
        );
      }

      setRecord(savedRecord);
      setInitialDraft(JSON.parse(JSON.stringify(draft)));
      setConfirmOpen(false);

      toast({
        title: 'Policy Saved Successfully',
        description: `PGR escalation policy updated for tenant ${tenantId}.`,
      });
    } catch (err) {
      setSaveError((err as Error)?.message || 'Failed to save escalation policy.');
    } finally {
      setSaving(false);
    }
  };

  // Copy canonical JSON
  const handleCopyJson = () => {
    navigator.clipboard.writeText(JSON.stringify(draft, null, 2));
    setCopiedJson(true);
    setTimeout(() => setCopiedJson(false), 2000);
    toast({ title: 'Copied', description: 'Canonical policy JSON copied to clipboard.' });
  };

  const isStateAdmin = true;

  const canAddMoreLevels =
    draft.maxDepth < 5 &&
    (draft.defaultSlaPercentageByLevel
      ? (draft.defaultSlaPercentageByLevel[draft.defaultSlaPercentageByLevel.length - 1] ?? 0) < 200
      : true);

  return (
    <div className="space-y-6 pb-12">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl sm:text-3xl font-bold font-condensed text-foreground">
              PGR Escalation Policy
            </h1>
            <Badge variant="outline" className="font-mono text-xs">
              {tenantId}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Tenant: <strong className="text-foreground">{tenantId}</strong> ·{' '}
            {isStatePolicy ? 'State policy' : 'City policy'} ·{' '}
            {isStatePolicy && inheritedCount > 0
              ? `Inherited by ${inheritedCount} city tenants`
              : 'Inherits defaults from state policy'}{' '}
            · Runtime: automatic scan every 5 minutes
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={loadPolicy}
            disabled={loading}
            className="gap-1.5 h-9"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </Button>

          {isStateAdmin && (
            <Button
              type="button"
              size="sm"
              onClick={handleInitiateSave}
              disabled={loading || saving || !ladderValidation.valid || !hasFunctionalChanges}
              className="gap-1.5 h-9"
            >
              <Save className="w-3.5 h-3.5" /> Save policy
            </Button>
          )}
        </div>
      </div>

      {/* Alerts & Feedback */}
      {loadError && (
        <Alert variant="destructive">
          <AlertTriangle className="w-4 h-4" />
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      )}

      {saveError && (
        <Alert variant="destructive">
          <AlertTriangle className="w-4 h-4" />
          <AlertDescription>{saveError}</AlertDescription>
        </Alert>
      )}

      {!isStateAdmin && (
        <Alert className="border-amber-500/40 bg-amber-50 dark:bg-amber-950/20 text-amber-900 dark:text-amber-200">
          <ShieldAlert className="w-4 h-4 text-amber-600" />
          <AlertDescription className="text-xs ml-2">
            You have read-only access. Only administrators with <code>MDMS_ADMIN</code> or{' '}
            <code>SUPERUSER</code> roles can modify the escalation policy.
          </AlertDescription>
        </Alert>
      )}

      {!isStatePolicy && (
        <Alert className="border-blue-500/40 bg-blue-50 dark:bg-blue-950/20 text-blue-900 dark:text-blue-200">
          <Layers className="w-4 h-4 text-blue-600" />
          <AlertDescription className="text-xs ml-2">
            Viewing configuration for city <strong>{tenantId}</strong>. By default, city tenants
            inherit the state escalation policy. Saving changes here will create a city-specific
            override record.
          </AlertDescription>
        </Alert>
      )}

      {loading ? (
        <div className="flex items-center justify-center p-12 text-muted-foreground gap-2">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-sm">Loading escalation policy…</span>
        </div>
      ) : (
        <>
          {/* Section 1: Parameters & Default Ladder */}
          <DigitCard className="max-w-none p-5 space-y-5">
            <div className="flex items-center gap-2 border-b border-border pb-3">
              <Sliders className="w-4 h-4 text-primary" />
              <h2 className="text-base font-semibold text-foreground">
                Escalation Parameters & Default Ladder
              </h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Max Escalation Levels */}
              <div className="space-y-1.5">
                <Label htmlFor="max-depth" className="text-xs font-semibold text-foreground">
                  Maximum Escalation Levels (Reporting Hops)
                </Label>
                <div className="flex items-center gap-3">
                  <Input
                    id="max-depth"
                    type="number"
                    min={0}
                    max={5}
                    step={1}
                    value={draft.maxDepth}
                    disabled={!isStateAdmin}
                    onChange={(e) => {
                      const val = e.target.value.trim();
                      if (val === '') return;
                      const num = parseInt(val, 10);
                      if (isNaN(num)) return;
                      handleMaxDepthChange(num);
                    }}
                    className="w-28 font-mono h-9"
                  />
                  <span className="text-xs text-muted-foreground">
                    {draft.maxDepth === 0
                      ? '0 = Escalation disabled (no complaints escalate)'
                      : 'Levels 1 to 5 (effective depth is capped by ladder length)'}
                  </span>
                </div>
              </div>

              {/* Eligible Workflow States */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-foreground">
                  Automatic Escalation States
                </Label>
                <div className="flex flex-wrap items-center gap-1.5 min-h-[36px]">
                  {draft.eligibleStatuses.map((status) => (
                    <Badge
                      key={status}
                      variant="secondary"
                      className="font-mono text-xs gap-1.5 pl-2 pr-1 py-0.5"
                    >
                      <span>{status}</span>
                      {isStateAdmin && (
                        <button
                          type="button"
                          onClick={() => handleRemoveStatus(status)}
                          className="hover:text-destructive rounded-full"
                        >
                          ×
                        </button>
                      )}
                    </Badge>
                  ))}
                  {isStateAdmin && (
                    <div className="flex items-center gap-1.5">
                      <Input
                        type="text"
                        placeholder="ADD STATE (e.g. PENDINGATLME)"
                        value={statusInput}
                        onChange={(e) => setStatusInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleAddStatus();
                          }
                        }}
                        className="w-56 h-8 text-xs font-mono uppercase"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleAddStatus}
                        className="h-8 text-xs"
                      >
                        Add
                      </Button>
                    </div>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Workflow statuses scanned by background scheduler. Each state must have an{' '}
                  <code>ESCALATE</code> transition defined for <code>SYSTEM</code>.
                </p>
              </div>
            </div>

            {/* Level Ladder Table */}
            <div className="space-y-2 pt-2">
              <Label className="text-xs font-semibold text-foreground">
                Default Cumulative Thresholds (State Ladder)
              </Label>
              {draft.maxDepth === 0 ? (
                <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground space-y-2">
                  <p>
                    Automatic escalation is currently disabled (maxDepth = 0). No complaints will be
                    automatically escalated.
                  </p>
                  {isStateAdmin && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => handleMaxDepthChange(1)}
                    >
                      Enable Escalation (Set 1 Level)
                    </Button>
                  )}
                </div>
              ) : (
                <EscalationLevelTable
                  percentages={draft.defaultSlaPercentageByLevel || []}
                  enabledByLevel={draft.enabledByLevel || []}
                  fallbacks={draft.defaultSlaByLevel || []}
                  pctErrors={ladderValidation.pctErrors}
                  fallbackErrors={ladderValidation.fallbackErrors}
                  readOnly={!isStateAdmin}
                  exampleComplaintHours={10}
                  onChange={handleLadderChange}
                  onAddLevel={handleAddLevel}
                  onRemoveLevel={handleRemoveLevel}
                  canAdd={canAddMoreLevels}
                  canRemove={draft.maxDepth > 0}
                />
              )}
            </div>
          </DigitCard>

          {/* Section 2: Complaint-type Catalogue */}
          <DigitCard className="max-w-none p-5 space-y-4">
            <div className="flex items-center gap-2 border-b border-border pb-3">
              <FileText className="w-4 h-4 text-primary" />
              <h2 className="text-base font-semibold text-foreground">
                Complaint-type Catalogue & Custom Overrides
              </h2>
            </div>

            <ComplaintTypeOverridesTable
              catalogue={catalogue}
              orphanedOverrides={orphanedOverrides}
              defaultPcts={draft.defaultSlaPercentageByLevel || []}
              readOnly={!isStateAdmin}
              onEditItem={(item) => setEditingItem(item)}
              onRemoveOverride={(code) => handleApplyOverride(code, null)}
              onBulkApply={handleBulkApply}
            />
          </DigitCard>

          {/* Section 3: Advanced JSON Disclosure */}
          <details className="border border-border rounded-lg bg-card p-4 group">
            <summary className="font-semibold text-sm cursor-pointer list-none flex items-center justify-between">
              <span className="flex items-center gap-2 text-foreground">
                <span className="text-primary group-open:rotate-90 transition-transform">▸</span>
                Advanced: Canonical Policy JSON & Diagnostics
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.preventDefault();
                  handleCopyJson();
                }}
                className="gap-1 text-xs h-7"
              >
                {copiedJson ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedJson ? 'Copied' : 'Copy JSON'}
              </Button>
            </summary>

            <div className="mt-3 pt-3 border-t border-border space-y-2">
              <pre className="bg-muted p-3 rounded-md text-xs font-mono overflow-x-auto text-foreground max-h-80">
                {JSON.stringify(draft, null, 2)}
              </pre>
              <p className="text-[11px] text-muted-foreground">
                This reflects the active payload sent to{' '}
                <code>/mdms-v2/v2/_update/RAINMAKER-PGR.EscalationConfig</code>.
              </p>
            </div>
          </details>
        </>
      )}

      {/* Override Edit Dialog */}
      {editingItem && (
        <OverrideEditDialog
          key={editingItem.code}
          open={!!editingItem}
          item={editingItem}
          maxDepth={draft.maxDepth}
          defaultPcts={draft.defaultSlaPercentageByLevel || [80, 120, 200]}
          defaultFallbacks={draft.defaultSlaByLevel || [3600000, 14400000, 86400000]}
          defaultEnabled={draft.enabledByLevel || [true, true, true]}
          onClose={() => setEditingItem(null)}
          onApply={handleApplyOverride}
        />
      )}

      {/* Save Confirmation Dialog */}
      <SaveConfirmDialog
        open={confirmOpen}
        tenantId={tenantId}
        isStatePolicy={isStatePolicy}
        inheritedTenantCount={inheritedCount}
        diffs={diffs}
        saving={saving}
        onClose={() => setConfirmOpen(false)}
        onConfirm={handleConfirmSave}
      />
    </div>
  );
}
