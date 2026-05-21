import { useInput, type InputProps } from 'ra-core';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface DurationMsInputProps extends InputProps {
  label?: string;
  help?: string;
  min?: number;
  max?: number;
}

function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0s';
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (s) parts.push(`${s}s`);
  return parts.join(' ') || '0s';
}

/** Number input for a millisecond duration with a human-readable label
 *  ("5d 3h 2m") underneath. Keeps the stored value as an integer ms count. */
export function DurationMsInput({ label, help, min, max, ...inputProps }: DurationMsInputProps) {
  const { id, field, fieldState, isRequired } = useInput({
    ...inputProps,
    parse: (v: string) => (v === '' ? null : Number(v)),
  });
  const hasError = fieldState.invalid && fieldState.isTouched;
  const ms = typeof field.value === 'number' ? field.value : Number(field.value);

  return (
    <div>
      {label && (
        <Label htmlFor={id} className="mb-1.5 block text-sm font-medium text-foreground">
          {label}
          {isRequired && <span className="text-destructive ml-0.5">*</span>}
        </Label>
      )}
      <Input
        id={id}
        type="number"
        min={min}
        max={max}
        placeholder="milliseconds"
        {...field}
        value={field.value ?? ''}
        className={`font-mono ${hasError ? 'border-destructive' : ''}`}
      />
      <p className="mt-1 text-xs text-muted-foreground">
        <span className="font-medium">{formatMs(ms)}</span>
        {help && <> — {help}</>}
      </p>
    </div>
  );
}
