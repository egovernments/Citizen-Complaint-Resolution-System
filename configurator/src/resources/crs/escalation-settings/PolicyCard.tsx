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
 */
import { useState } from 'react';
import { SlidersHorizontal, Save, Undo2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import type { MdmsRecord } from '@digit-mcp/data-provider';
import type { EscalationPolicy } from '../sla-matrix/escalationTypes';
import { LevelSlaEditor } from '../sla-matrix/LevelSlaEditor';
import { normalizeLevelValues, type LevelValues } from '../sla-matrix/levelSlaValues';
import {
  loadEscalationPolicy,
  saveEscalationPolicy,
  verifyAfterWrite,
  type AuditActor,
} from '../sla-matrix/slaService';
import { LEGACY_FALLBACK_MAX_DEPTH, type LegacyEscalationConfig } from './legacyConfig';

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

/** Field-order-independent comparison key for read-after-write verification. */
function canonPolicy(p: EscalationPolicy | null): string {
  return JSON.stringify({
    maxDepth: p?.maxDepth ?? null,
    levels: p?.defaultSlaHoursByLevel ?? null,
    preEnabled: p?.preBreachWarning?.enabled ?? null,
    preThreshold: p?.preBreachWarning?.thresholdPercent ?? null,
    comment: p?.escalateCommentRequired ?? null,
  });
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
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ maxDepth?: string; threshold?: string }>({});

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
    setDirty(false);
    setFieldErrors({});
  }

  const legacyDepth = legacy?.maxDepth ?? LEGACY_FALLBACK_MAX_DEPTH;

  async function handleSave() {
    const errs: { maxDepth?: string; threshold?: string } = {};
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
    setFieldErrors(errs);
    const levelsOk = levelErrors.every((e) => e === null);
    if (Object.keys(errs).length > 0 || !levelsOk) {
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

    setSaving(true);
    try {
      const saved = await saveEscalationPolicy(tenantId, next, record, actor);
      onSaved(next, saved);
      // The draft now matches the saved record — no reseed needed.
      setDirty(false);
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
