import { useMemo } from 'react';
import { useInput, useGetList, type InputProps } from 'ra-core';
import type { RaRecord } from 'ra-core';
import { Label } from '@/components/ui/label';

/** Resolve a dot-separated path like 'user.name' from a record */
function getNestedValue(record: RaRecord, path: string): unknown {
  return path.split('.').reduce<unknown>((obj, key) =>
    obj != null && typeof obj === 'object' ? (obj as Record<string, unknown>)[key] : undefined,
  record);
}

export interface DigitFormMultiSelectProps extends InputProps {
  /** Display label for the field */
  label?: string;
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
  /** Optional helper text shown below the list (muted) */
  help?: string;
}

/** Checkbox-list multi-select bound to an array form value (e.g. `departments`).
 *  Mirrors DigitFormSelect's reference-fetching, but for a field that can hold
 *  more than one value. Plain checkboxes rather than a searchable combobox —
 *  there's no combobox primitive in this codebase yet, and reference lists
 *  here (e.g. departments) are short enough that a flat list reads fine. */
export function DigitFormMultiSelect({
  label,
  className,
  choices: staticChoices,
  reference,
  optionValue = 'code',
  optionText = 'name',
  help,
  ...inputProps
}: DigitFormMultiSelectProps) {
  const { id, field, fieldState, isRequired } = useInput(inputProps);

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

  const selected: string[] = Array.isArray(field.value) ? field.value : [];
  // Not gated on fieldState.isTouched (unlike DigitFormSelect's sibling
  // pattern): a pre-existing record edited before `departments` existed
  // loads this field empty, and an operator changing an unrelated field
  // then hitting Save would otherwise get no visible reason the submit was
  // blocked — nothing here to "touch" until they notice on their own. RHF
  // only computes `invalid` once a validation pass actually runs (on change
  // or on submit attempt), so this still stays quiet on initial mount.
  const hasError = fieldState.invalid;
  // ra-core v5 wraps validator errors as `@@react-admin@@${JSON.stringify(msg)}`
  // before storing them in react-hook-form state (same fix already applied in
  // DigitFormInput). Strip the prefix and unwrap the JSON string so the raw
  // human-readable message renders instead of the literal wrapped string.
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

  const toggle = (value: string, checked: boolean) => {
    const nextSet = new Set(checked ? [...selected, value] : selected.filter((v) => v !== value));
    // Order by the CHOICES list, not click order — appending the newly
    // checked value to the end would move a re-checked entry (e.g. undoing
    // an accidental uncheck) past ones that were already checked, silently
    // changing which entry is `departments[0]` ("primary") with no visible
    // indication anything reordered (CCRS#1724 review).
    const next = choices.filter((c) => nextSet.has(c.value)).map((c) => c.value);
    field.onChange(next);
  };

  return (
    <div className={className}>
      {label && (
        <Label className="mb-1.5 block text-sm font-medium text-foreground">
          {label}
          {isRequired && (
            <span className="text-destructive ml-0.5" aria-label="required">
              *
            </span>
          )}
        </Label>
      )}
      <div
        className={`rounded-md border p-2 max-h-48 overflow-y-auto ${hasError ? 'border-destructive' : 'border-input'}`}
      >
        {reference && isLoading && (
          <p className="text-sm text-muted-foreground px-1 py-1">Loading...</p>
        )}
        {!isLoading && choices.length === 0 && (
          <p className="text-sm text-muted-foreground px-1 py-1">No options available.</p>
        )}
        {choices.map((choice) => {
          const checkboxId = `${id}-${choice.value}`;
          return (
            <div key={choice.value} className="flex items-center gap-2 py-0.5">
              <input
                id={checkboxId}
                type="checkbox"
                checked={selected.includes(choice.value)}
                onChange={(e) => toggle(choice.value, e.target.checked)}
                onBlur={field.onBlur}
                className="h-4 w-4 rounded border-input cursor-pointer"
              />
              <Label htmlFor={checkboxId} className="text-sm font-normal text-foreground cursor-pointer">
                {choice.label}
              </Label>
            </div>
          );
        })}
      </div>
      {hasError && errorMessage && (
        <p className="mt-1 text-xs text-destructive" role="alert">
          {errorMessage}
        </p>
      )}
      {!hasError && help && <p className="mt-1 text-xs text-muted-foreground">{help}</p>}
    </div>
  );
}
