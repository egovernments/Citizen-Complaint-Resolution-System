import { useMemo } from 'react';
import { useInput, regex, type InputProps, type Validator } from 'ra-core';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const HEX_PATTERN = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

const RA_ERROR_PREFIX = '@@react-admin@@';

// digit-ui-esbuild/src/theme/schema.json accepts ONLY 6-digit hex for every
// color leaf; applyTheme() runs the whole record through that AJV schema and
// silently no-ops the ENTIRE theme (not just the offending field) if any
// value fails it. A 3- or 8-digit hex therefore saves to MDMS successfully
// but does nothing at runtime, with no signal at save time — so this must
// block submit, not just hint.
const runtimeHexValidator = regex(
  /^#[0-9a-fA-F]{6}$/,
  'Must be a 6-digit hex color (#RRGGBB) — the runtime theme schema rejects 3- and 8-digit hex',
);

interface ColorInputProps extends InputProps {
  label?: string;
  help?: string;
}

/** Minimal hex color input: native color picker + hex text box + live swatch.
 *  Keeps the form value as a hex string (e.g. "#006B3F"). Falls back to plain
 *  text editing if the value is not a valid hex. */
export function ColorInput({ label, help, validate, ...inputProps }: ColorInputProps) {
  const combinedValidate = useMemo<Validator[]>(() => {
    const extra = Array.isArray(validate) ? validate : validate ? [validate] : [];
    return [runtimeHexValidator, ...extra];
  }, [validate]);
  const { id, field, fieldState, isRequired } = useInput({ ...inputProps, validate: combinedValidate });
  // `isTouched` only flips on blur, so gating on it alone leaves the field
  // showing no error while the user is still typing an invalid value.
  // `isDirty` flips on the first change, giving immediate feedback (mirrors
  // DigitFormInput's convention).
  const hasError = fieldState.invalid && (fieldState.isDirty || fieldState.isTouched);
  // ra-core v5 wraps validator errors as `@@react-admin@@${JSON.stringify(msg)}`
  // before storing them in react-hook-form state. Slice by the prefix's own
  // length, never a literal: with a hardcoded offset, a future ra-core prefix
  // change still matches startsWith() but parses from the wrong position and
  // surfaces a garbled message with no runtime signal.
  const rawError = fieldState.error?.message;
  const errorMessage = rawError?.startsWith(RA_ERROR_PREFIX)
    ? (() => {
        const encoded = rawError.slice(RA_ERROR_PREFIX.length);
        try {
          const parsed: unknown = JSON.parse(encoded);
          if (typeof parsed === 'string') return parsed;
          if (parsed && typeof parsed === 'object' && 'message' in parsed)
            return String((parsed as { message: unknown }).message);
          return String(parsed);
        } catch { return encoded; }
      })()
    : rawError;
  const value = typeof field.value === 'string' ? field.value : '';
  // Display/swatch tolerance stays lenient (3/6/8-digit) — cosmetic only;
  // `combinedValidate` above is the actual submit gate.
  const isValidHex = HEX_PATTERN.test(value);

  return (
    <div>
      {label && (
        <Label htmlFor={id} className="mb-1.5 block text-sm font-medium text-foreground">
          {label}
          {isRequired && <span className="text-destructive ml-0.5">*</span>}
        </Label>
      )}
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label ?? 'color'} picker`}
          value={isValidHex && value.length === 7 ? value : '#000000'}
          onChange={(e) => field.onChange(e.target.value)}
          className="h-9 w-9 rounded border border-input cursor-pointer bg-transparent p-0.5"
        />
        <Input
          id={id}
          type="text"
          placeholder="#RRGGBB"
          value={value}
          onChange={(e) => field.onChange(e.target.value)}
          onBlur={field.onBlur}
          aria-invalid={hasError || undefined}
          aria-describedby={hasError ? `${id}-error` : undefined}
          className={`font-mono ${hasError ? 'border-destructive' : ''}`}
        />
        <div
          aria-hidden
          className="h-9 w-9 rounded border border-input shrink-0"
          style={{ backgroundColor: isValidHex ? value : 'transparent' }}
          title={isValidHex ? value : 'invalid hex'}
        />
      </div>
      {hasError && errorMessage && (
        <p id={`${id}-error`} className="mt-1 text-xs text-destructive" role="alert">
          {errorMessage}
        </p>
      )}
      {!hasError && help && <p className="mt-1 text-xs text-muted-foreground">{help}</p>}
    </div>
  );
}
