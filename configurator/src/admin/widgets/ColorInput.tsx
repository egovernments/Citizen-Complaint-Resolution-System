import { useInput, type InputProps } from 'ra-core';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const HEX_PATTERN = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

interface ColorInputProps extends InputProps {
  label?: string;
  help?: string;
}

/** Minimal hex color input: native color picker + hex text box + live swatch.
 *  Keeps the form value as a hex string (e.g. "#006B3F"). Falls back to plain
 *  text editing if the value is not a valid hex. */
export function ColorInput({ label, help, ...inputProps }: ColorInputProps) {
  const { id, field, fieldState, isRequired } = useInput(inputProps);
  const hasError = fieldState.invalid && fieldState.isTouched;
  const value = typeof field.value === 'string' ? field.value : '';
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
          className={`font-mono ${hasError ? 'border-destructive' : ''}`}
        />
        <div
          aria-hidden
          className="h-9 w-9 rounded border border-input shrink-0"
          style={{ backgroundColor: isValidHex ? value : 'transparent' }}
          title={isValidHex ? value : 'invalid hex'}
        />
      </div>
      {help && <p className="mt-1 text-xs text-muted-foreground">{help}</p>}
      {!isValidHex && value.length > 0 && (
        <p className="mt-1 text-xs text-destructive">Not a valid hex color (#RGB / #RRGGBB / #RRGGBBAA)</p>
      )}
    </div>
  );
}
