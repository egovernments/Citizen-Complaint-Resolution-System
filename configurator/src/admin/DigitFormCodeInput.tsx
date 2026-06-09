import { useState, useCallback } from 'react';
import { useInput, useDataProvider, type InputProps } from 'ra-core';
import { useFormContext, useWatch } from 'react-hook-form';
import { Wand2, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

export interface DigitFormCodeInputProps extends InputProps {
  /** Display label for the input */
  label?: string;
  /** Placeholder text */
  placeholder?: string;
  /** Whether the input is disabled */
  disabled?: boolean;
  /** Additional CSS class names for the wrapper */
  className?: string;
  /** IdFormat name for server-side generation via idgen */
  idName?: string;
  /** Source field to derive code from (e.g., 'name' — watches that field and converts to CODE_FORMAT) */
  deriveFrom?: string;
}

/** Convert a human-readable name to an uppercase code: "Street Light Not Working" → "STREET_LIGHT_NOT_WORKING" */
function nameToCode(name: string): string {
  return name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, '')
    .replace(/\s+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function DigitFormCodeInput({
  label,
  placeholder,
  disabled = false,
  className,
  idName,
  deriveFrom,
  ...inputProps
}: DigitFormCodeInputProps) {
  const { id, field, fieldState, isRequired } = useInput(inputProps);
  const { setValue } = useFormContext();
  const dataProvider = useDataProvider();

  const watchedName = useWatch({ name: deriveFrom || '__noop__' });
  const [generated, setGenerated] = useState(false);
  const [generating, setGenerating] = useState(false);

  const hasError = fieldState.invalid && fieldState.isTouched;
  const errorMessage = fieldState.error?.message;

  const canDeriveFromName = deriveFrom && typeof watchedName === 'string' && watchedName.trim().length > 0;

  const handleGenerate = useCallback(async () => {
    if (idName) {
      // Server-side generation via idgen
      setGenerating(true);
      try {
        const id = await (dataProvider as Record<string, unknown> & { idgenGenerate: (idName: string) => Promise<string> }).idgenGenerate(idName);
        if (id) {
          setValue(inputProps.source, id, { shouldValidate: true, shouldDirty: true });
          setGenerated(true);
        }
      } finally {
        setGenerating(false);
      }
    } else if (canDeriveFromName) {
      // Derive code from sibling name field
      const code = nameToCode(watchedName);
      if (code) {
        setValue(inputProps.source, code, { shouldValidate: true, shouldDirty: true });
        setGenerated(true);
      }
    }
  }, [idName, canDeriveFromName, watchedName, dataProvider, setValue, inputProps.source]);

  const handleClear = useCallback(() => {
    setValue(inputProps.source, '', { shouldValidate: true, shouldDirty: true });
    setGenerated(false);
  }, [setValue, inputProps.source]);

  const showGenerateButton = idName || canDeriveFromName;

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
      <div className="flex gap-2">
        <Input
          id={id}
          type="text"
          placeholder={placeholder}
          disabled={disabled || generating}
          readOnly={generated}
          aria-invalid={hasError || undefined}
          aria-describedby={hasError ? `${id}-error` : `${id}-hint`}
          className={[
            hasError ? 'border-destructive focus-visible:ring-destructive' : '',
            generated ? 'bg-muted' : '',
          ].filter(Boolean).join(' ')}
          {...field}
          value={field.value ?? ''}
        />
        {showGenerateButton && !generated && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleGenerate}
            disabled={disabled || generating || (!idName && !canDeriveFromName)}
            className="shrink-0 gap-1.5"
            title={idName ? 'Generate ID' : `Generate from ${deriveFrom}`}
          >
            <Wand2 className="w-3.5 h-3.5" />
            Generate
          </Button>
        )}
        {generated && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleClear}
            disabled={disabled}
            className="shrink-0 gap-1.5"
            title="Clear and type manually"
          >
            <X className="w-3.5 h-3.5" />
            Clear
          </Button>
        )}
      </div>
      {generated && (
        <p id={`${id}-hint`} className="mt-1 text-xs text-muted-foreground">
          {idName ? 'Generated via idgen' : `Auto-generated from ${deriveFrom}`}
        </p>
      )}
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
