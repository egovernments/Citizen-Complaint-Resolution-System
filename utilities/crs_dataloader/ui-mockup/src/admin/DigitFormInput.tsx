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
}

export function DigitFormInput({
  label,
  placeholder,
  type = 'text',
  disabled = false,
  className,
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
  const errorMessage = fieldState.error?.message;

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
    </div>
  );
}
