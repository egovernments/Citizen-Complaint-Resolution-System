import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDurationMs, computeTriggerPreview } from './escalationPolicyUtils';

interface EscalationLevelTableProps {
  percentages: number[];
  enabledByLevel: boolean[];
  fallbacks: number[];
  pctErrors: (string | null)[];
  fallbackErrors: (string | null)[];
  readOnly?: boolean;
  exampleComplaintHours?: number;
  onChange: (pcts: number[], enabled: boolean[], fallbacks: number[]) => void;
  onAddLevel?: () => void;
  onRemoveLevel?: () => void;
  canAdd?: boolean;
  canRemove?: boolean;
}

export function EscalationLevelTable({
  percentages,
  enabledByLevel,
  fallbacks,
  pctErrors,
  fallbackErrors,
  readOnly = false,
  exampleComplaintHours = 10,
  onChange,
  onAddLevel,
  onRemoveLevel,
  canAdd = false,
  canRemove = false,
}: EscalationLevelTableProps) {
  const updateLevel = (
    index: number,
    patch: { pct?: number; enabled?: boolean; fallback?: number }
  ) => {
    const nextPcts = [...percentages];
    const nextEnabled = [...enabledByLevel];
    const nextFallbacks = [...fallbacks];

    if (patch.pct !== undefined) nextPcts[index] = patch.pct;
    if (patch.enabled !== undefined) nextEnabled[index] = patch.enabled;
    if (patch.fallback !== undefined) nextFallbacks[index] = patch.fallback;

    onChange(nextPcts, nextEnabled, nextFallbacks);
  };

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="w-16">Level</TableHead>
              <TableHead className="w-24">Auto</TableHead>
              <TableHead className="w-40">Cumulative SLA %</TableHead>
              <TableHead className="w-56">Example ({exampleComplaintHours}h complaint)</TableHead>
              <TableHead className="w-52">Absolute Fallback</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {percentages.map((pct, idx) => {
              const enabled = enabledByLevel[idx] ?? true;
              const fallback = fallbacks[idx] ?? 0;
              const pctError = pctErrors[idx];
              const fbError = fallbackErrors[idx];

              return (
                <TableRow key={idx}>
                  <TableCell className="font-semibold text-foreground">
                    <Badge variant="outline" className="font-mono">
                      L{idx + 1}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        id={`auto-level-${idx}`}
                        checked={enabled}
                        disabled={readOnly}
                        onChange={(e) => updateLevel(idx, { enabled: e.target.checked })}
                        className="h-4 w-4 rounded border-border text-primary focus:ring-primary disabled:opacity-50"
                      />
                      <Label
                        htmlFor={`auto-level-${idx}`}
                        className="text-xs text-muted-foreground cursor-pointer"
                      >
                        {enabled ? 'Active' : 'Off'}
                      </Label>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      <div className="relative">
                        <Input
                          type="number"
                          min={1}
                          max={200}
                          value={pct ?? ''}
                          disabled={readOnly}
                          onChange={(e) => {
                            const val = e.target.value === '' ? 0 : Number(e.target.value);
                            updateLevel(idx, { pct: val });
                          }}
                          className={`w-28 font-mono pr-7 ${pctError ? 'border-destructive focus-visible:ring-destructive' : ''}`}
                        />
                        <span className="absolute right-2.5 top-2.5 text-xs text-muted-foreground font-mono">
                          %
                        </span>
                      </div>
                      {pctError && (
                        <p className="text-xs text-destructive">{pctError}</p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm font-medium text-foreground">
                      {enabled ? computeTriggerPreview(exampleComplaintHours, pct) : 'Manual escalation only (Auto off)'}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          min={0}
                          step={1000}
                          value={fallback ?? ''}
                          disabled={readOnly}
                          onChange={(e) => {
                            const val = e.target.value === '' ? 0 : Number(e.target.value);
                            updateLevel(idx, { fallback: val });
                          }}
                          className={`w-36 font-mono ${fbError ? 'border-destructive focus-visible:ring-destructive' : ''}`}
                        />
                        <span className="text-xs font-mono font-medium text-muted-foreground whitespace-nowrap">
                          {formatDurationMs(fallback)}
                        </span>
                      </div>
                      {fbError && (
                        <p className="text-xs text-destructive">{fbError}</p>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1">
        <p className="text-xs text-muted-foreground max-w-2xl leading-relaxed">
          The cumulative complaint-age clock starts at complaint creation (reopening starts a fresh clock; reassignment does not). Manual escalation consumes one level immediately; the automatic scheduler then evaluates the next cumulative threshold.
        </p>
        {!readOnly && (onAddLevel || onRemoveLevel) && (
          <div className="flex items-center gap-2">
            {canRemove && onRemoveLevel && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onRemoveLevel}
                className="gap-1 text-destructive hover:text-destructive"
              >
                <Trash2 className="w-3.5 h-3.5" /> Remove level
              </Button>
            )}
            {canAdd && onAddLevel && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onAddLevel}
                className="gap-1"
              >
                <Plus className="w-3.5 h-3.5" /> Add level
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
