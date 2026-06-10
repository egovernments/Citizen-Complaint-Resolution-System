import { useState } from 'react';
import { useInput, type InputProps } from 'ra-core';
import { useWatch } from 'react-hook-form';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Plus, Trash2 } from 'lucide-react';

interface SlaByLevelInputProps extends InputProps {
  label?: string;
  help?: string;
  /** Form field whose value is the cap for the array length. Defaults to `maxDepth`. */
  maxDepthSource?: string;
  /** When the parent input is rendered without a containing form (e.g. inside
   *  ServiceOverridesEditor for a single override), maxDepth still comes from
   *  the root record. Caller can override this via maxDepthSource above. */
  defaultMax?: number;
}

const FALLBACK_MAX = 10;

function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0s';
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  if (d === 1 && !h && !m && !s) return '1 day';
  if (d > 1 && !h && !m && !s) return `${d} days`;
  if (!d && h === 1 && !m && !s) return '1 hour';
  if (!d && h > 1 && !m && !s) return `${h} hours`;
  if (!d && !h && m === 1 && !s) return '1 minute';
  if (!d && !h && m > 1 && !s) return `${m} minutes`;
  if (!d && !h && !m && s) return `${s} second${s === 1 ? '' : 's'}`;
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (s) parts.push(`${s}s`);
  return parts.join(' ') || '0s';
}

/** Parse an "hh:mm:ss" or "mm:ss" or "ss" string to milliseconds. Returns
 *  NaN if unparseable. Empty string is treated as 0. */
function parseHms(input: string): number {
  const trimmed = input.trim();
  if (!trimmed) return 0;
  // Reject inputs with no separator that aren't pure digits — that's an ms value
  // and should go through the raw-ms path, not here.
  const parts = trimmed.split(':');
  if (parts.length === 1) {
    const n = Number(parts[0]);
    if (!Number.isFinite(n)) return NaN;
    return n * 1000;
  }
  if (parts.length > 3) return NaN;
  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => !Number.isFinite(n) || n < 0)) return NaN;
  // Pad to [h, m, s]
  while (nums.length < 3) nums.unshift(0);
  const [h, m, s] = nums;
  return ((h * 3600) + (m * 60) + s) * 1000;
}

function msToHms(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '00:00:00';
  const totalS = Math.floor(ms / 1000);
  const h = Math.floor(totalS / 3600);
  const m = Math.floor((totalS % 3600) / 60);
  const s = totalS % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

interface LevelRowProps {
  index: number;
  value: number;
  mode: 'hms' | 'ms';
  canRemove: boolean;
  onChange: (next: number) => void;
  onRemove: () => void;
  onToggleMode: () => void;
}

function LevelRow({ index, value, mode, canRemove, onChange, onRemove, onToggleMode }: LevelRowProps) {
  const [draft, setDraft] = useState<string>(mode === 'hms' ? msToHms(value) : String(value));
  const [error, setError] = useState<string | null>(null);

  // Re-sync draft if the underlying value changes from outside (e.g. mode flip).
  // We intentionally do NOT use useEffect here because that fights local edits;
  // instead we let the user-visible draft drift while editing and only commit
  // on blur / Enter.
  const commit = () => {
    if (mode === 'hms') {
      const next = parseHms(draft);
      if (Number.isNaN(next)) { setError('Use hh:mm:ss'); return; }
      setError(null);
      onChange(next);
    } else {
      const next = Number(draft);
      if (!Number.isFinite(next) || next < 0) { setError('Must be a non-negative number'); return; }
      setError(null);
      onChange(next);
    }
  };

  return (
    <div className="flex items-center gap-2 py-1.5 border-b border-border/40 last:border-b-0">
      <div className="w-20 shrink-0 text-sm font-medium">Level {index}</div>
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
        placeholder={mode === 'hms' ? 'hh:mm:ss' : 'milliseconds'}
        className={`font-mono w-44 ${error ? 'border-destructive' : ''}`}
      />
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                // Flip the input mode and re-format the draft from the committed value.
                onToggleMode();
                setDraft(mode === 'hms' ? String(value) : msToHms(value));
                setError(null);
              }}
              className="text-xs"
            >
              {mode === 'hms' ? 'hh:mm:ss' : 'ms'}
            </Button>
          </TooltipTrigger>
          <TooltipContent>Toggle input format</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <div className="text-xs text-muted-foreground flex-1 truncate">
        {formatMs(value)}
      </div>
      {canRemove && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onRemove}
          aria-label={`remove level ${index}`}
          className="text-destructive hover:text-destructive hover:bg-destructive/10"
        >
          <Trash2 className="w-4 h-4" />
        </Button>
      )}
    </div>
  );
}

/**
 * Editor for `number[]` SLA arrays where each index is an escalation level.
 *
 * The form value is always the raw millisecond array — UI affordances (hh:mm:ss
 * input, "1 hour" preview) are presentation only.
 *
 * Caps the row count at the form's `maxDepth` (via `useWatch`). When used
 * outside the top-level EscalationConfig form (e.g. for per-service override
 * rows in ServiceOverridesEditor) the cap falls back to `defaultMax`.
 */
export function SlaByLevelInput({ label, help, maxDepthSource = 'maxDepth', defaultMax, ...inputProps }: SlaByLevelInputProps) {
  const { id, field, isRequired } = useInput(inputProps);
  // useWatch returns undefined when the field isn't on the form. Default to
  // defaultMax (caller-provided) or FALLBACK_MAX.
  const watchedMaxDepth = useWatch({ name: maxDepthSource }) as number | undefined;
  const cap = (typeof watchedMaxDepth === 'number' && watchedMaxDepth > 0)
    ? watchedMaxDepth
    : (defaultMax ?? FALLBACK_MAX);

  const value: number[] = Array.isArray(field.value)
    ? field.value.map((v) => (typeof v === 'number' ? v : Number(v) || 0))
    : [];

  // Track input mode per row. Default to hh:mm:ss because operators think in
  // human time, not milliseconds. Persisted only in component state — never
  // makes it to the form value.
  const [modes, setModes] = useState<('hms' | 'ms')[]>(() => value.map(() => 'hms'));

  // Keep `modes` length in sync with value length without losing existing entries.
  if (modes.length !== value.length) {
    const next = [...modes];
    while (next.length < value.length) next.push('hms');
    if (next.length > value.length) next.length = value.length;
    setModes(next);
  }

  const setLevel = (i: number, next: number) => {
    const out = value.slice();
    out[i] = next;
    field.onChange(out);
  };

  const removeLevel = (i: number) => {
    const out = value.slice();
    out.splice(i, 1);
    field.onChange(out);
    const m = modes.slice();
    m.splice(i, 1);
    setModes(m);
  };

  const addLevel = () => {
    if (value.length >= cap) return;
    // Default the new row's SLA to the last row's value (operators usually
    // step SLAs up monotonically; starting from the previous SLA is a saner
    // default than 0).
    const last = value[value.length - 1] ?? 3_600_000;
    field.onChange([...value, last]);
    setModes([...modes, 'hms']);
  };

  const toggleMode = (i: number) => {
    const m = modes.slice();
    m[i] = m[i] === 'hms' ? 'ms' : 'hms';
    setModes(m);
  };

  return (
    <div>
      {label && (
        <Label htmlFor={id} className="mb-1.5 block text-sm font-medium text-foreground">
          {label}
          {isRequired && <span className="text-destructive ml-0.5">*</span>}
        </Label>
      )}
      <div className="rounded border border-border bg-muted/10 px-3 py-2">
        {value.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground italic">No levels configured. Add one below.</p>
        ) : (
          value.map((v, i) => (
            <LevelRow
              key={i}
              index={i}
              value={v}
              mode={modes[i] ?? 'hms'}
              canRemove={i > 0}
              onChange={(n) => setLevel(i, n)}
              onRemove={() => removeLevel(i)}
              onToggleMode={() => toggleMode(i)}
            />
          ))
        )}
        <div className="pt-2 flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addLevel}
            disabled={value.length >= cap}
            className="text-xs"
          >
            <Plus className="w-3.5 h-3.5 mr-1" /> Add level
          </Button>
          <span className="text-xs text-muted-foreground">
            {value.length}/{cap} levels
            {value.length >= cap && ' — increase maxDepth to add more'}
          </span>
        </div>
      </div>
      {help && <p className="mt-1 text-xs text-muted-foreground">{help}</p>}
    </div>
  );
}
