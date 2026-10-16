// React is used implicitly for JSX transform
import type { ReactNode } from 'react';
import { useInput, type InputProps } from 'ra-core';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useShowFieldError } from '@/admin/useShowFieldError';
import { useFieldErrorText } from '@/admin/fieldErrorText';

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
  help?: ReactNode;
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

  // `isTouched` only flips on blur, so gating on it alone leaves the field
  // showing no error while the user is still typing an invalid value.
  // `isDirty` flips on the first change, giving immediate feedback.
  const hasError = useShowFieldError(fieldState);
  const errorMessage = useFieldErrorText(fieldState.error?.message);

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
