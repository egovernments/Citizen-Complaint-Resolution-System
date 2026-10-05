import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, RotateCcw } from 'lucide-react';
import type { CatalogueItem, EscalationLevelOverride } from './escalationPolicyTypes';
import { computeTriggerPreview, validateLadder, formatDurationMs } from './escalationPolicyUtils';

interface OverrideEditDialogProps {
  open: boolean;
  item: CatalogueItem | null;
  maxDepth: number;
  defaultPcts: number[];
  defaultFallbacks: number[];
  defaultEnabled: boolean[];
  onClose: () => void;
  onApply: (serviceCode: string, override: EscalationLevelOverride | null) => void;
}

export function OverrideEditDialog({
  open,
  item,
  maxDepth,
  defaultPcts,
  defaultFallbacks,
  defaultEnabled,
  onClose,
  onApply,
}: OverrideEditDialogProps) {
  // Determine if existing override is millisecond-only (no percentages configured)
  const isExistingMsOnly = Boolean(
    item?.override &&
    (!item.override.slaPercentageByLevel || item.override.slaPercentageByLevel.length === 0) &&
    item.override.slaByLevel &&
    item.override.slaByLevel.length > 0
  );

  const [overrideMode, setOverrideMode] = useState<'percentage' | 'absolute'>(
    isExistingMsOnly ? 'absolute' : 'percentage'
  );

  const [pcts, setPcts] = useState<number[]>(() => {
    if (!item) return [];
    if (item.override?.slaPercentageByLevel && item.override.slaPercentageByLevel.length > 0) {
      const p = [...item.override.slaPercentageByLevel];
      while (p.length < maxDepth) p.push(defaultPcts[p.length] ?? 100);
      return p.slice(0, maxDepth);
    }
    return defaultPcts.slice(0, maxDepth);
  });

  const [enabledByLevel, setEnabledByLevel] = useState<boolean[]>(() => {
    if (!item) return [];
    if (item.override) {
      const en = [...item.override.enabledByLevel];
      const lastEn = en[en.length - 1] ?? (defaultEnabled[defaultEnabled.length - 1] ?? true);
      while (en.length < maxDepth) en.push(lastEn);
      return en.slice(0, maxDepth);
    }
    return defaultEnabled.slice(0, maxDepth);
  });

  const [fallbacks, setFallbacks] = useState<number[]>(() => {
    if (!item) return [];
    if (item.override?.slaByLevel && item.override.slaByLevel.length > 0) {
      const fb = [...item.override.slaByLevel];
      while (fb.length < maxDepth) {
        const lastFb = fb[fb.length - 1] ?? 3600000;
        fb.push(lastFb + 28800000);
      }
      return fb.slice(0, maxDepth);
    }
    return defaultFallbacks.slice(0, maxDepth);
  });

  const [errors, setErrors] = useState<string[]>([]);

  if (!item) return null;

  const handleApply = () => {
    if (overrideMode === 'percentage') {
      const res = validateLadder(pcts, fallbacks);
      const errMessages = [
        ...res.pctErrors.filter((e): e is string => e !== null),
        ...res.fallbackErrors.filter((e): e is string => e !== null),
      ];

      if (!res.valid) {
        setErrors(errMessages);
        return;
      }

      const override: EscalationLevelOverride = {
        slaPercentageByLevel: pcts,
        enabledByLevel,
        slaByLevel: fallbacks,
      };

      onApply(item.code, override);
      onClose();
    } else {
      // Absolute millisecond override: validate fallbacks only, leave percentages empty
      const res = validateLadder(
        fallbacks.map((_, i) => (i + 1) * 10), // dummy valid pcts for validator
        fallbacks
      );
      const errMessages = res.fallbackErrors.filter((e): e is string => e !== null);

      if (errMessages.length > 0) {
        setErrors(errMessages);
        return;
      }

      const override: EscalationLevelOverride = {
        slaByLevel: fallbacks,
        enabledByLevel,
      };

      onApply(item.code, override);
      onClose();
    }
  };

  const handleRemoveOverride = () => {
    onApply(item.code, null);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader className="pr-10 text-left">
          <div className="flex items-center gap-2.5">
            <DialogTitle className="text-xl">Complaint-type Override</DialogTitle>
            {item.override ? (
              <Badge variant="default">Overridden</Badge>
            ) : (
              <Badge variant="secondary">Uses Default</Badge>
            )}
          </div>
          <DialogDescription className="text-xs text-muted-foreground pt-1">
            Configure custom escalation thresholds for{' '}
            <strong className="text-foreground">{item.name}</strong> ({item.code}).
            {item.slaHours > 0 ? (
              <span className="ml-1 text-foreground font-medium">
                Base SLA: {item.slaHours} hours.
              </span>
            ) : (
              <span className="ml-1 text-amber-600 dark:text-amber-400">
                (No base SLA configured — absolute fallbacks apply at runtime).
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        {/* Mode Selector: Percentage vs Absolute */}
        <div className="flex items-center gap-2 border-b border-border pb-3">
          <span className="text-xs font-semibold text-muted-foreground mr-1">Threshold Type:</span>
          <Button
            type="button"
            size="sm"
            variant={overrideMode === 'percentage' ? 'default' : 'outline'}
            onClick={() => setOverrideMode('percentage')}
            className="text-xs h-7"
          >
            Percentage of SLA (%)
          </Button>
          <Button
            type="button"
            size="sm"
            variant={overrideMode === 'absolute' ? 'default' : 'outline'}
            onClick={() => setOverrideMode('absolute')}
            className="text-xs h-7"
          >
            Fixed Duration (ms)
          </Button>
        </div>

        {/* Error Alert */}
        {errors.length > 0 && (
          <div className="bg-destructive/10 border border-destructive/30 rounded-md p-3 text-xs text-destructive flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <ul className="list-disc pl-4 space-y-0.5">
              {errors.map((err, i) => (
                <li key={i}>{err}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="space-y-4 py-2">
          {overrideMode === 'percentage' ? (
            <div className="space-y-2">
              <Label className="text-sm font-medium">Custom Escalation Ladder (%)</Label>
              <div className="border border-border rounded-md divide-y divide-border">
                {pcts.map((pct, idx) => {
                  const enabled = enabledByLevel[idx] ?? true;
                  const preview = computeTriggerPreview(item.slaHours, pct);

                  return (
                    <div key={idx} className="p-3 flex items-center justify-between gap-4">
                      <div className="flex items-center gap-2 w-20">
                        <Badge variant="outline" className="font-mono">
                          L{idx + 1}
                        </Badge>
                        <input
                          type="checkbox"
                          id={`dialog-auto-${idx}`}
                          checked={enabled}
                          onChange={(e) => {
                            const next = [...enabledByLevel];
                            next[idx] = e.target.checked;
                            setEnabledByLevel(next);
                          }}
                          className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                        />
                      </div>

                      <div className="relative w-28">
                        <Input
                          type="number"
                          min={1}
                          max={200}
                          step={1}
                          value={pct ?? ''}
                          onChange={(e) => {
                            const next = [...pcts];
                            next[idx] = e.target.value === '' ? 0 : Number(e.target.value);
                            setPcts(next);
                          }}
                          className="font-mono pr-7"
                        />
                        <span className="absolute right-2.5 top-2.5 text-xs text-muted-foreground font-mono">
                          %
                        </span>
                      </div>

                      <div className="flex-1 text-right text-xs">
                        {enabled ? (
                          <span className="font-medium text-foreground">{preview}</span>
                        ) : (
                          <span className="text-muted-foreground italic">Automatic trigger off</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <Label className="text-sm font-medium">Fixed Duration Escalation Ladder (ms)</Label>
              <div className="border border-border rounded-md divide-y divide-border">
                {fallbacks.map((fb, idx) => {
                  const enabled = enabledByLevel[idx] ?? true;
                  return (
                    <div key={idx} className="p-3 flex items-center justify-between gap-4">
                      <div className="flex items-center gap-2 w-20">
                        <Badge variant="outline" className="font-mono">
                          L{idx + 1}
                        </Badge>
                        <input
                          type="checkbox"
                          id={`dialog-auto-fb-${idx}`}
                          checked={enabled}
                          onChange={(e) => {
                            const next = [...enabledByLevel];
                            next[idx] = e.target.checked;
                            setEnabledByLevel(next);
                          }}
                          className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                        />
                      </div>

                      <div className="relative w-40">
                        <Input
                          type="number"
                          min={0}
                          step={1000}
                          value={fb ?? ''}
                          onChange={(e) => {
                            const next = [...fallbacks];
                            next[idx] = e.target.value === '' ? 0 : Number(e.target.value);
                            setFallbacks(next);
                          }}
                          className="font-mono pr-10"
                        />
                        <span className="absolute right-2.5 top-2.5 text-xs text-muted-foreground font-mono">
                          ms
                        </span>
                      </div>

                      <div className="flex-1 text-right text-xs">
                        {enabled ? (
                          <span className="font-medium text-foreground">
                            {formatDurationMs(fb)} after creation
                          </span>
                        ) : (
                          <span className="text-muted-foreground italic">Automatic trigger off</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {overrideMode === 'percentage' && (
            <details className="text-xs text-muted-foreground border border-border/70 rounded-md p-2.5">
              <summary className="font-medium text-foreground cursor-pointer hover:underline">
                Absolute fallback (advanced)
              </summary>
              <div className="pt-2.5 space-y-2">
                <p>Cumulative millisecond fallbacks when complaint SLA cannot be resolved:</p>
                {fallbacks.map((fb, idx) => (
                  <div key={idx} className="flex items-center gap-3">
                    <span className="font-mono font-semibold w-8">L{idx + 1}:</span>
                    <Input
                      type="number"
                      min={0}
                      step={1000}
                      value={fb ?? ''}
                      onChange={(e) => {
                        const next = [...fallbacks];
                        next[idx] = e.target.value === '' ? 0 : Number(e.target.value);
                        setFallbacks(next);
                      }}
                      className="font-mono h-8 text-xs max-w-xs"
                    />
                    <span className="font-mono text-xs">{formatDurationMs(fb)}</span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>

        <DialogFooter className="flex items-center justify-between sm:justify-between pt-2">
          {item.override ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleRemoveOverride}
              className="text-destructive hover:bg-destructive/10 text-xs gap-1"
            >
              <RotateCcw className="w-3.5 h-3.5" /> Reset to Default
            </Button>
          ) : (
            <div />
          )}

          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={handleApply}>
              Apply override
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
