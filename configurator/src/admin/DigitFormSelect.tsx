import { useMemo } from 'react';
import { useInput, useGetList, type InputProps } from 'ra-core';
import type { RaRecord } from 'ra-core';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';

/** Resolve a dot-separated path like 'user.name' from a record */
function getNestedValue(record: RaRecord, path: string): unknown {
  return path.split('.').reduce<unknown>((obj, key) =>
    obj != null && typeof obj === 'object' ? (obj as Record<string, unknown>)[key] : undefined,
  record);
}

export interface DigitFormSelectProps extends InputProps {
  /** Display label for the select */
  label?: string;
  /** Placeholder text shown when no value is selected */
  placeholder?: string;
  /** Whether the select is disabled */
  disabled?: boolean;
  /** Additional CSS class names for the wrapper */
  className?: string;
  /** Static choices (use this OR reference, not both) */
  choices?: { value: string; label: string }[];
  /** Resource name to auto-fetch choices from (e.g. 'departments') */
  reference?: string;
  /** Field to use as the option value when using reference (default: 'code') */
  optionValue?: string;
  /** Field to use as the option label when using reference (default: 'name') */
  optionText?: string;
}

export function DigitFormSelect({
  label,
  placeholder,
  disabled = false,
  className,
  choices: staticChoices,
  reference,
  optionValue = 'code',
  optionText = 'name',
  ...inputProps
}: DigitFormSelectProps) {
  const {
    id,
    field,
    fieldState,
    isRequired,
  } = useInput(inputProps);

  // Auto-fetch choices from a resource when `reference` is provided
  const { data, isLoading } = useGetList(
    reference ?? '_unused',
    { pagination: { page: 1, perPage: 1000 }, sort: { field: optionText, order: 'ASC' as const } },
    { enabled: !!reference },
  );

  const choices = useMemo(() => {
    if (staticChoices) return staticChoices;
    if (!data) return [];
    return data.map((item) => ({
      value: String(getNestedValue(item, optionValue) ?? item.id),
      label: String(getNestedValue(item, optionText) ?? getNestedValue(item, optionValue) ?? item.id),
    }));
  }, [staticChoices, data, optionValue, optionText]);

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
      <Select
        value={field.value ?? ''}
        onValueChange={field.onChange}
        disabled={disabled || (!!reference && isLoading)}
      >
        <SelectTrigger
          id={id}
          aria-invalid={hasError || undefined}
          aria-describedby={hasError ? `${id}-error` : undefined}
          className={hasError ? 'border-destructive focus-visible:ring-destructive' : ''}
        >
          <SelectValue placeholder={reference && isLoading ? 'Loading...' : placeholder} />
        </SelectTrigger>
        <SelectContent>
          {choices.map((choice) => (
            <SelectItem key={choice.value} value={choice.value} data-value={choice.value}>
              {choice.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
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
