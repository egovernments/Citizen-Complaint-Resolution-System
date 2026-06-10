/**
 * Card 2 — "Escalation behaviour": the CRS.EscalationPolicy form.
 *
 * Every field is optional on the record; an unset field means "use the
 * previous setting", so the form distinguishes blank (unset) from an
 * explicit value and never eagerly writes placeholder defaults (the
 * pre-breach 75% placeholder stays a placeholder until typed).
 *
 * Saves go through slaService.saveEscalationPolicy, which normalises to
 * the state tenant and writes the audit entry itself; this card only
 * adds the read-after-write verification toast on top.
 *
 * The "Escalate complaints nobody has picked up" block edits the opt-in
 * roleEscalation object on the same record (draft↔object logic lives in
 * roleEscalationDraft.ts so it stays unit-testable); the key is omitted
 * entirely while the tenant has never used the feature, keeping the
 * saved policy byte-identical to today. The CRS.RoleSupervisors pins
 * inside the block save separately (RoleSupervisorsTable).
 */
import { useEffect, useMemo, useState } from 'react';
import { SlidersHorizontal, Save, Undo2, Plus, X, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { digitClient } from '@/providers/bridge';
import type { MdmsRecord } from '@digit-mcp/data-provider';
import type { EscalationPolicy, RoleEscalation } from '../sla-matrix/escalationTypes';
import { LevelSlaEditor } from '../sla-matrix/LevelSlaEditor';
import { normalizeLevelValues, type LevelValues } from '../sla-matrix/levelSlaValues';
import {
  loadEscalationPolicy,
  saveEscalationPolicy,
  toStateTenant,
  verifyAfterWrite,
  type AuditActor,
} from '../sla-matrix/slaService';
import { LEGACY_FALLBACK_MAX_DEPTH, type LegacyEscalationConfig } from './legacyConfig';
import {
  buildActingMap,
  buildLadderMap,
  buildRoleEscalation,
  parseMaxPerScan,
  seedActingRows,
  seedLadderRows,
  validateActingRows,
  validateLadderRows,
  type ActingRoleDraft,
  type LadderDraft,
} from './roleEscalationDraft';
import { RoleSupervisorsTable } from './RoleSupervisorsTable';

interface PolicyCardProps {
  tenantId: string;
  actor: AuditActor;
  /**
   * The card owns its draft after mount — the page remounts it with a
   * fresh `key` on reload so a re-fetched policy reseeds the form.
   */
  policy: EscalationPolicy | null;
  record?: MdmsRecord;
  legacy: LegacyEscalationConfig | null;
  onSaved: (policy: EscalationPolicy, record: MdmsRecord) => void;
}

/** Key-order-independent comparison key for a role map. */
function canonRoleMap(m: Record<string, string> | undefined): [string, string][] | null {
  return m ? Object.keys(m).sort().map((k) => [k, m[k]] as [string, string]) : null;
}

/** Field-order-independent comparison key for read-after-write verification. */
function canonPolicy(p: EscalationPolicy | null): string {
  const re: RoleEscalation | undefined = p?.roleEscalation;
  return JSON.stringify({
    maxDepth: p?.maxDepth ?? null,
    levels: p?.defaultSlaHoursByLevel ?? null,
    preEnabled: p?.preBreachWarning?.enabled ?? null,
    preThreshold: p?.preBreachWarning?.thresholdPercent ?? null,
    comment: p?.escalateCommentRequired ?? null,
    role: re
      ? {
          enabled: re.enabled ?? null,
          acting: canonRoleMap(re.actingRoleByState),
          ladder: canonRoleMap(re.supervisorRoleByRole),
          max: re.maxPerScan ?? null,
        }
      : null,
  });
}

/** Shared <datalist> id for every role input in the role-escalation block. */
const ROLE_LIST_ID = 'role-escalation-role-options';

interface ActingRow extends ActingRoleDraft {
  /** Local-only stable key — survives renames while editing. */
  id: number;
}

interface LadderRow extends LadderDraft {
  id: number;
}

// Module-scope counter so draft-row ids stay unique without a ref (refs
// must not be read during render, and the useState initializer is render).
let roleRowIdCounter = 0;
function nextRoleRowId(): number {
  return ++roleRowIdCounter;
}

export function PolicyCard({ tenantId, actor, policy, record, legacy, onSaved }: PolicyCardProps) {
  const { toast } = useToast();

  const [maxDepthInput, setMaxDepthInput] = useState(() =>
    policy?.maxDepth !== undefined ? String(policy.maxDepth) : '',
  );
  const [levelValues, setLevelValues] = useState<LevelValues>(() =>
    policy?.defaultSlaHoursByLevel ? [...policy.defaultSlaHoursByLevel] : [],
  );
  const [levelErrors, setLevelErrors] = useState<(string | null)[]>([]);
  // LevelSlaEditor is uncontrolled after mount — bump the key to reset it
  // (Revert reseeds it from the latest saved policy).
  const [editorKey, setEditorKey] = useState(0);
  const [preBreachEnabled, setPreBreachEnabled] = useState(
    () => policy?.preBreachWarning?.enabled ?? false,
  );
  const [thresholdInput, setThresholdInput] = useState(() =>
    policy?.preBreachWarning?.thresholdPercent !== undefined
      ? String(policy.preBreachWarning.thresholdPercent)
      : '',
  );
  // Backend default: a comment IS required on manual escalation.
  const [commentRequired, setCommentRequired] = useState(
    () => policy?.escalateCommentRequired ?? true,
  );
  // Role escalation (opt-in). The block stays hidden while the checkbox
  // is off, but the draft rows persist so re-checking restores them.
  const [roleEnabled, setRoleEnabled] = useState(() => policy?.roleEscalation?.enabled ?? false);
  const [actingRows, setActingRows] = useState<ActingRow[]>(() =>
    seedActingRows(policy?.roleEscalation?.actingRoleByState).map((r) => ({ ...r, id: nextRoleRowId() })),
  );
  const [ladderRows, setLadderRows] = useState<LadderRow[]>(() =>
    seedLadderRows(policy?.roleEscalation?.supervisorRoleByRole).map((r) => ({ ...r, id: nextRoleRowId() })),
  );
  const [maxPerScanInput, setMaxPerScanInput] = useState(() =>
    policy?.roleEscalation?.maxPerScan !== undefined ? String(policy.roleEscalation.maxPerScan) : '',
  );
  // Half-filled row errors only show after a save attempt — half-typed
  // rows are normal while editing; duplicates are flagged live.
  const [triedSave, setTriedSave] = useState(false);
  // Role suggestions for the <datalist> come from ACCESSCONTROL-ROLES via
  // the data provider's accessRolesSearch. Fail-soft: on error the role
  // inputs simply degrade to plain text (the datalist stays empty).
  const [roleOptions, setRoleOptions] = useState<{ code: string; name: string }[]>([]);
  useEffect(() => {
    let cancelled = false;
    digitClient
      .accessRolesSearch(toStateTenant(tenantId))
      .then((roles) => {
        if (cancelled) return;
        setRoleOptions(
          roles
            .map((r) => ({ code: String(r.code ?? ''), name: String(r.name ?? r.code ?? '') }))
            .filter((r) => r.code !== ''),
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [tenantId]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ maxDepth?: string; threshold?: string; maxPerScan?: string }>({});

  const actingErrors = useMemo(() => validateActingRows(actingRows, triedSave), [actingRows, triedSave]);
  const ladderErrors = useMemo(() => validateLadderRows(ladderRows, triedSave), [ladderRows, triedSave]);

  /** Reset the draft to the latest loaded/saved policy (Revert). */
  function seed() {
    setMaxDepthInput(policy?.maxDepth !== undefined ? String(policy.maxDepth) : '');
    setLevelValues(policy?.defaultSlaHoursByLevel ? [...policy.defaultSlaHoursByLevel] : []);
    setLevelErrors([]);
    setEditorKey((k) => k + 1);
    setPreBreachEnabled(policy?.preBreachWarning?.enabled ?? false);
    setThresholdInput(
      policy?.preBreachWarning?.thresholdPercent !== undefined
        ? String(policy.preBreachWarning.thresholdPercent)
        : '',
    );
    setCommentRequired(policy?.escalateCommentRequired ?? true);
    setRoleEnabled(policy?.roleEscalation?.enabled ?? false);
    setActingRows(
      seedActingRows(policy?.roleEscalation?.actingRoleByState).map((r) => ({ ...r, id: nextRoleRowId() })),
    );
    setLadderRows(
      seedLadderRows(policy?.roleEscalation?.supervisorRoleByRole).map((r) => ({ ...r, id: nextRoleRowId() })),
    );
    setMaxPerScanInput(
      policy?.roleEscalation?.maxPerScan !== undefined ? String(policy.roleEscalation.maxPerScan) : '',
    );
    setTriedSave(false);
    setDirty(false);
    setFieldErrors({});
  }

  const legacyDepth = legacy?.maxDepth ?? LEGACY_FALLBACK_MAX_DEPTH;

  function patchActingRow(id: number, patch: Partial<ActingRow>) {
    setActingRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    setDirty(true);
  }

  function addActingRow() {
    setActingRows((prev) => [...prev, { id: nextRoleRowId(), state: '', role: '', fixed: false }]);
    setDirty(true);
  }

  function removeActingRow(id: number) {
    setActingRows((prev) => prev.filter((r) => r.id !== id));
    setDirty(true);
  }

  function patchLadderRow(id: number, patch: Partial<LadderRow>) {
    setLadderRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    setDirty(true);
  }

  function addLadderRow() {
    setLadderRows((prev) => [...prev, { id: nextRoleRowId(), role: '', supervisorRole: '' }]);
    setDirty(true);
  }

  function removeLadderRow(id: number) {
    setLadderRows((prev) => prev.filter((r) => r.id !== id));
    setDirty(true);
  }

  function jumpToVerify() {
    document.getElementById('verify-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Enable-flow guardrail: drafted on but not yet saved as enabled.
  const justEnabled = roleEnabled && !(policy?.roleEscalation?.enabled ?? false);
  const roleDraftEmpty =
    Object.keys(buildActingMap(actingRows)).length === 0 &&
    Object.keys(buildLadderMap(ladderRows)).length === 0;

  async function handleSave() {
    setTriedSave(true);
    const errs: { maxDepth?: string; threshold?: string; maxPerScan?: string } = {};
    let maxDepth: number | undefined;
    if (maxDepthInput.trim() !== '') {
      const n = Number(maxDepthInput);
      if (!Number.isInteger(n) || n < 1 || n > 10) errs.maxDepth = 'must be a whole number between 1 and 10';
      else maxDepth = n;
    }
    let threshold: number | undefined;
    if (thresholdInput.trim() !== '') {
      const n = Number(thresholdInput);
      if (!Number.isInteger(n) || n < 1 || n > 99) errs.threshold = 'must be a whole number between 1 and 99';
      else threshold = n;
    }
    const maxScan = parseMaxPerScan(maxPerScanInput);
    if (maxScan.error) errs.maxPerScan = maxScan.error;
    setFieldErrors(errs);
    const levelsOk = levelErrors.every((e) => e === null);
    // Row errors re-validated with the post-save-attempt flag — the
    // rendered (triedSave-gated) arrays may still hide half-filled rows.
    const rowsOk =
      validateActingRows(actingRows, true).every((e) => e === null) &&
      validateLadderRows(ladderRows, true).every((e) => e === null);
    if (Object.keys(errs).length > 0 || !levelsOk || !rowsOk) {
      toast({ title: "Can't save yet", description: 'Fix the highlighted fields first.', variant: 'destructive' });
      return;
    }

    const next: EscalationPolicy = { singletonKey: 'default' };
    if (maxDepth !== undefined) next.maxDepth = maxDepth;
    // Policy mode rejects holes, so an error-free draft normalises to a
    // solid number[] (or undefined when no levels are set — omit the key).
    const levels = normalizeLevelValues(levelValues);
    if (levels) next.defaultSlaHoursByLevel = levels as number[];
    next.preBreachWarning = {
      enabled: preBreachEnabled,
      ...(threshold !== undefined ? { thresholdPercent: threshold } : {}),
    };
    next.escalateCommentRequired = commentRequired;
    // Omitted entirely when the tenant never touched the feature —
    // disabled must keep the saved policy byte-identical to today.
    const roleEscalation = buildRoleEscalation({
      enabled: roleEnabled,
      actingMap: buildActingMap(actingRows),
      ladderMap: buildLadderMap(ladderRows),
      maxPerScan: maxScan.value,
      hadExisting: policy?.roleEscalation !== undefined,
    });
    if (roleEscalation) next.roleEscalation = roleEscalation;

    setSaving(true);
    try {
      const saved = await saveEscalationPolicy(tenantId, next, record, actor);
      onSaved(next, saved);
      // The draft now matches the saved record — no reseed needed.
      setDirty(false);
      setTriedSave(false);
      const verified = await verifyAfterWrite(
        () => loadEscalationPolicy(tenantId),
        ({ policy: current }) => canonPolicy(current) === canonPolicy(next),
      );
      if (verified) {
        toast({ title: 'Saved ✓ verified', description: 'Escalation behaviour updated.' });
      } else {
        toast({
          title: 'Saved but not yet visible',
          description: 'The data pipeline may be delayed; reload in a few seconds.',
        });
      }
    } catch (err) {
      toast({
        title: 'Save failed',
        description: err instanceof Error ? err.message : 'unknown',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SlidersHorizontal className="w-4 h-4 text-primary" />
          Escalation behaviour
        </CardTitle>
        <CardDescription>
          Deployment-wide rules for how and when complaints escalate. Blank fields keep the previous settings.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Max escalation depth */}
        <div className="space-y-1">
          <Label htmlFor="esc-max-depth">Max escalation depth</Label>
          <Input
            id="esc-max-depth"
            type="number"
            min={1}
            max={10}
            value={maxDepthInput}
            onChange={(e) => {
              setMaxDepthInput(e.target.value);
              setDirty(true);
            }}
            className="h-8 w-24 text-xs"
            placeholder="—"
            disabled={saving}
          />
          {fieldErrors.maxDepth ? (
            <p className="text-xs text-destructive">{fieldErrors.maxDepth}</p>
          ) : (
            maxDepthInput.trim() === '' && (
              <p className="text-xs text-muted-foreground">
                Not set — using the previous setting ({legacyDepth} levels).
              </p>
            )
          )}
        </div>

        {/* Deployment-wide level SLAs */}
        <div className="space-y-1.5">
          <Label>Deployment-wide level SLAs</Label>
          <LevelSlaEditor
            key={editorKey}
            initialValue={policy?.defaultSlaHoursByLevel ?? null}
            allowHoles={false}
            onChange={(values, errors) => {
              setLevelValues(values);
              setLevelErrors(errors);
              setDirty(true);
            }}
            disabled={saving}
          />
          <p className="text-xs text-muted-foreground">
            Used when a complaint's category has no level SLAs of its own. Note: a category's state
            cells (SLA Matrix) also take priority over these for that category.
          </p>
        </div>

        {/* Pre-breach warning */}
        <div className="space-y-1.5">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={preBreachEnabled}
              onChange={(e) => {
                setPreBreachEnabled(e.target.checked);
                setDirty(true);
              }}
              disabled={saving}
            />
            Warn before the SLA is breached
          </label>
          <div className="flex items-center gap-2 text-xs text-muted-foreground pl-6">
            Warn at
            <Input
              type="number"
              min={1}
              max={99}
              value={thresholdInput}
              onChange={(e) => {
                setThresholdInput(e.target.value);
                setDirty(true);
              }}
              placeholder="75"
              className="h-7 w-16 text-xs"
              disabled={saving || !preBreachEnabled}
              aria-label="Warning threshold (percent of the SLA time)"
            />
            % of the SLA time
          </div>
          {fieldErrors.threshold && (
            <p className="text-xs text-destructive pl-6">{fieldErrors.threshold}</p>
          )}
          <p className="text-xs text-muted-foreground pl-6">
            Warnings are recorded and visible in the test scan below. Notification delivery
            (SMS/WhatsApp/email) is not yet available.
          </p>
        </div>

        {/* Manual escalation */}
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={commentRequired}
            onChange={(e) => {
              setCommentRequired(e.target.checked);
              setDirty(true);
            }}
            disabled={saving}
          />
          Require a comment when staff escalate manually
        </label>

        {/* Role escalation (opt-in) */}
        <div className="space-y-1.5">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={roleEnabled}
              onChange={(e) => {
                setRoleEnabled(e.target.checked);
                setDirty(true);
              }}
              disabled={saving}
            />
            Escalate complaints nobody has picked up
          </label>
          <p className="text-xs text-muted-foreground pl-6">
            When a complaint breaches its SLA with nobody assigned, send it to one specific person:
            the pinned person for the acting role if set, otherwise the single holder of the next
            role on the role ladder, otherwise the role holders' shared reporting manager.
          </p>

          {roleEnabled && (
            <div className="pl-6 space-y-4 pt-1">
              {justEnabled && (
                <Alert variant="warning">
                  <AlertTriangle className="w-4 h-4" />
                  <AlertTitle>Run a test scan first</AlertTitle>
                  <AlertDescription>
                    {roleDraftEmpty &&
                      'Nothing is mapped yet — no complaint can escalate until at least one status below names the role expected to act on it. '}
                    Before saving, use the test scan to see exactly what this change would do.{' '}
                    <button onClick={jumpToVerify} className="underline font-medium">
                      Go to the test scan
                    </button>
                  </AlertDescription>
                </Alert>
              )}

              {/* One shared datalist feeds every role input in this block. */}
              <datalist id={ROLE_LIST_ID}>
                {roleOptions.map((r) => (
                  <option key={r.code} value={r.code}>
                    {r.name}
                  </option>
                ))}
              </datalist>

              {/* Acting role per watched status */}
              <div className="space-y-1.5">
                <Label>Who should be acting, per complaint status</Label>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-muted-foreground">
                      <th className="py-1.5 pr-2 font-medium">Complaint status</th>
                      <th className="py-1.5 pr-2 font-medium w-56">Acting role</th>
                      <th className="py-1.5 w-10" />
                    </tr>
                  </thead>
                  <tbody>
                    {actingRows.map((row, i) => {
                      const err = actingErrors[i];
                      return (
                        <tr key={row.id} className="border-t border-border align-top">
                          <td className="py-1.5 pr-2">
                            {row.fixed ? (
                              <code className="font-mono text-[10px] bg-muted px-1 py-0.5 rounded">
                                {row.state}
                              </code>
                            ) : (
                              <Input
                                value={row.state}
                                onChange={(e) => patchActingRow(row.id, { state: e.target.value })}
                                className="h-7 text-xs font-mono"
                                placeholder="Workflow status name"
                                aria-label="Complaint status name"
                                aria-invalid={err !== null}
                                disabled={saving}
                              />
                            )}
                            {err && <p className="text-[10px] text-destructive mt-0.5">{err}</p>}
                          </td>
                          <td className="py-1.5 pr-2">
                            <Input
                              value={row.role}
                              onChange={(e) => patchActingRow(row.id, { role: e.target.value })}
                              className="h-7 text-xs font-mono"
                              placeholder={row.fixed ? 'not mapped' : 'e.g. GRO'}
                              list={ROLE_LIST_ID}
                              aria-label={`Acting role for ${row.state || 'this status'}`}
                              disabled={saving}
                            />
                          </td>
                          <td className="py-1.5 text-right">
                            {!row.fixed && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6"
                                onClick={() => removeActingRow(row.id)}
                                aria-label={`Remove status ${row.state || '(blank)'}`}
                                disabled={saving}
                              >
                                <X className="w-3.5 h-3.5" />
                              </Button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <Button variant="outline" size="sm" onClick={addActingRow} disabled={saving}>
                  <Plus className="w-3.5 h-3.5 mr-1.5" />
                  Add a status
                </Button>
                <p className="text-xs text-muted-foreground">
                  The first two statuses are the ones the escalation scan watches. Statuses you add
                  beyond the first two take effect only if a future release extends the scan to
                  watch them. A status with no acting role is skipped (the test scan reports it).
                </p>
              </div>

              {/* Role ladder */}
              <div className="space-y-1.5">
                <Label>Role ladder — where each role's complaints go</Label>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-muted-foreground">
                      <th className="py-1.5 pr-2 font-medium">Acting role</th>
                      <th className="py-1.5 pr-2 font-medium">Escalates to role</th>
                      <th className="py-1.5 w-10" />
                    </tr>
                  </thead>
                  <tbody>
                    {ladderRows.length === 0 && (
                      <tr>
                        <td colSpan={3} className="py-2 text-xs text-muted-foreground">
                          No ladder steps yet — without one, the target is the role holders' shared
                          reporting manager.
                        </td>
                      </tr>
                    )}
                    {ladderRows.map((row, i) => {
                      const err = ladderErrors[i];
                      return (
                        <tr key={row.id} className="border-t border-border align-top">
                          <td className="py-1.5 pr-2">
                            <Input
                              value={row.role}
                              onChange={(e) => patchLadderRow(row.id, { role: e.target.value })}
                              className="h-7 text-xs font-mono"
                              placeholder="e.g. GRO"
                              list={ROLE_LIST_ID}
                              aria-label="Ladder acting role"
                              aria-invalid={err !== null}
                              disabled={saving}
                            />
                            {err && <p className="text-[10px] text-destructive mt-0.5">{err}</p>}
                          </td>
                          <td className="py-1.5 pr-2">
                            <Input
                              value={row.supervisorRole}
                              onChange={(e) => patchLadderRow(row.id, { supervisorRole: e.target.value })}
                              className="h-7 text-xs font-mono"
                              placeholder="e.g. PGR_SUPERVISOR"
                              list={ROLE_LIST_ID}
                              aria-label={`Role that ${row.role || 'this role'} escalates to`}
                              disabled={saving}
                            />
                          </td>
                          <td className="py-1.5 text-right">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              onClick={() => removeLadderRow(row.id)}
                              aria-label={`Remove ladder step ${row.role || '(blank)'}`}
                              disabled={saving}
                            >
                              <X className="w-3.5 h-3.5" />
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <Button variant="outline" size="sm" onClick={addLadderRow} disabled={saving}>
                  <Plus className="w-3.5 h-3.5 mr-1.5" />
                  Add a ladder step
                </Button>
                <p className="text-xs text-muted-foreground">
                  A ladder step needs exactly one person holding the target role (in the complaint's
                  department, or anywhere as a fallback) — with several, the complaint is skipped and
                  the test scan tells you to pin a person instead.
                </p>
              </div>

              {/* Max per scan */}
              <div className="space-y-1">
                <Label htmlFor="esc-role-max-scan">Limit per scan</Label>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  At most
                  <Input
                    id="esc-role-max-scan"
                    type="number"
                    min={1}
                    max={100}
                    value={maxPerScanInput}
                    onChange={(e) => {
                      setMaxPerScanInput(e.target.value);
                      setDirty(true);
                    }}
                    placeholder="10"
                    className="h-7 w-16 text-xs"
                    disabled={saving}
                    aria-label="Maximum unattended complaints escalated per scan"
                  />
                  unattended complaints escalate per scan; the rest wait for later scans.
                </div>
                {fieldErrors.maxPerScan && (
                  <p className="text-xs text-destructive">{fieldErrors.maxPerScan}</p>
                )}
              </div>

              <RoleSupervisorsTable tenantId={tenantId} actor={actor} roleListId={ROLE_LIST_ID} />
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 pt-1">
          <Button size="sm" onClick={handleSave} disabled={!dirty || saving}>
            <Save className="w-3.5 h-3.5 mr-1.5" />
            {saving ? 'Saving…' : 'Save behaviour'}
          </Button>
          <Button size="sm" variant="outline" onClick={seed} disabled={!dirty || saving}>
            <Undo2 className="w-3.5 h-3.5 mr-1.5" />
            Revert
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
