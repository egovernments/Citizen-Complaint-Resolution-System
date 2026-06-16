// React is used implicitly for JSX transform
import { useInput, type InputProps } from 'ra-core';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export interface DigitFormInputProps extends InputProps {
  /** Display label for the input */
  label?: string;
  /** Placeholder text */
  placeholder?: string;
  /** HTML input type (text, email, number, etc.) */
  type?: string;
  /** Whether the input is disabled */
  disabled?: boolean;
  /** Additional CSS class names for the wrapper */
  className?: string;
  /** Optional helper text shown below the input (muted) */
  help?: string;
  /** Maximum number of characters the input accepts (sets the HTML maxLength attribute) */
  maxLength?: number;
}

export function DigitFormInput({
  label,
  placeholder,
  type = 'text',
  disabled = false,
  className,
  help,
  maxLength,
  ...inputProps
}: DigitFormInputProps) {
  // Auto-coerce number inputs so the form value is a number, not a string
  const parseProps = type === 'number' && !inputProps.parse
    ? { ...inputProps, parse: (v: string) => (v === '' ? null : Number(v)) }
    : inputProps;

  const {
    id,
    field,
    fieldState,
    isRequired,
  } = useInput(parseProps);

  const hasError = fieldState.invalid && fieldState.isTouched;
  // ra-core v5 wraps validator errors as `@@react-admin@@${JSON.stringify(msg)}`
  // before storing them in react-hook-form state. Strip the prefix and unwrap
  // the JSON string so the raw human-readable message is rendered.
  const rawError = fieldState.error?.message;
  const errorMessage = rawError?.startsWith('@@react-admin@@')
    ? (() => {
        try {
          const parsed: unknown = JSON.parse(rawError.slice(15));
          if (typeof parsed === 'string') return parsed;
          if (parsed && typeof parsed === 'object' && 'message' in parsed)
            return String((parsed as { message: unknown }).message);
          return String(parsed);
        } catch { return rawError.slice(15); }
      })()
    : rawError;

  return (
    <div className={className}>
      {label && (
        <Label htmlFor={id} className="mb-1.5 block text-sm font-medium text-foreground">
          {label}
          {isRequired && (
            <span className="text-destructive ml-0.5" aria-label="required">
              *
            </span>
          )}
        </Label>
      )}
      <Input
        id={id}
        type={type}
        placeholder={placeholder}
        disabled={disabled}
        maxLength={maxLength}
        aria-invalid={hasError || undefined}
        aria-describedby={hasError ? `${id}-error` : undefined}
        className={hasError ? 'border-destructive focus-visible:ring-destructive' : ''}
        {...field}
        value={field.value ?? ''}
      />
      {hasError && errorMessage && (
        <p
          id={`${id}-error`}
          className="mt-1 text-xs text-destructive"
          role="alert"
        >
          {errorMessage}
        </p>
      )}
      {!hasError && help && (
        <p className="mt-1 text-xs text-muted-foreground">{help}</p>
      )}
    </div>
  );
}
