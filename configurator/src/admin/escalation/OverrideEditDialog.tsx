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
  const [pcts, setPcts] = useState<number[]>(() => {
    if (!item) return [];
    if (item.override) {
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
      while (en.length < maxDepth) en.push(defaultEnabled[en.length] ?? true);
      return en.slice(0, maxDepth);
    }
    return defaultEnabled.slice(0, maxDepth);
  });

  const [fallbacks, setFallbacks] = useState<number[]>(() => {
    if (!item) return [];
    if (item.override?.slaByLevel) {
      const fb = [...item.override.slaByLevel];
      while (fb.length < maxDepth) fb.push(defaultFallbacks[fb.length] ?? 3600000);
      return fb.slice(0, maxDepth);
    }
    return defaultFallbacks.slice(0, maxDepth);
  });

  const [errors, setErrors] = useState<string[]>([]);

  if (!item) return null;

  const handleApply = () => {
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
          <DialogDescription className="space-y-1 text-left pt-2">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-foreground text-base">{item.name}</span>
              <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
                {item.code}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">{item.path}</p>
            <div className="flex gap-4 pt-1 text-xs">
              <span>
                Base SLA: <strong className="text-foreground">{item.slaHours}h</strong>
              </span>
              <span>
                Department: <strong className="text-foreground">{item.department || '—'}</strong>
              </span>
            </div>
          </DialogDescription>
        </DialogHeader>

        {errors.length > 0 && (
          <div className="bg-destructive/10 text-destructive p-3 rounded-md text-xs space-y-1">
            <div className="flex items-center gap-1.5 font-semibold">
              <AlertCircle className="w-4 h-4" /> Please fix the following errors:
            </div>
            <ul className="list-disc pl-5 space-y-0.5">
              {errors.map((err, idx) => (
                <li key={idx}>{err}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label className="text-sm font-medium">Custom Escalation Ladder</Label>
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
                    className="w-32 font-mono h-8 text-xs"
                  />
                  <span className="font-mono">{formatDurationMs(fb)}</span>
                </div>
              ))}
            </div>
          </details>
        </div>

        <DialogFooter className="flex items-center justify-between sm:justify-between w-full pt-2">
          {item.override ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleRemoveOverride}
              className="text-destructive hover:text-destructive gap-1"
            >
              <RotateCcw className="w-3.5 h-3.5" /> Reset to default
            </Button>
          ) : (
            <div />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="button" onClick={handleApply}>
              Apply override
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
