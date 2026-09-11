import { useRef, useState } from 'react';
import { useInput, type InputProps } from 'ra-core';
import { Label } from '@/components/ui/label';

interface JsonInputProps extends InputProps {
  label?: string;
  help?: string;
  rows?: number;
}

/** Raw-JSON textarea for object/array fields the form has no richer widget for
 *  (CCSD-2000: DataSecurity.SecurityPolicy is all objects/arrays, so the
 *  generic Edit form rendered nothing editable).
 *
 *  - Holds the raw text locally; the FORM value is always the parsed object.
 *  - While the text doesn't parse, an inline error shows and save is blocked
 *    (the validator reads a ref so it always sees the latest parse state).
 *  - Empty text clears the field (form value becomes undefined). */
export function JsonInput({ label, help, rows = 8, ...inputProps }: JsonInputProps) {
  // Parse-state ref: the useInput validate closure must always see the latest
  // error without re-registering the validator (identity has to stay stable).
  const errRef = useRef<string | null>(null);
  const validateRef = useRef(() => (errRef.current ? 'Invalid JSON' : undefined));
  const { id, field, isRequired } = useInput({ ...inputProps, validate: validateRef.current });

  const [text, setText] = useState(() =>
    field.value === undefined || field.value === null ? '' : JSON.stringify(field.value, null, 2)
  );
  const [parseError, setParseError] = useState<string | null>(null);

  const onTextChange = (t: string) => {
    setText(t);
    if (t.trim() === '') {
      errRef.current = null;
      setParseError(null);
      field.onChange(undefined);
      return;
    }
    try {
      const parsed = JSON.parse(t);
      errRef.current = null;
      setParseError(null);
      field.onChange(parsed);
    } catch {
      errRef.current = 'invalid';
      setParseError('Invalid JSON — fix the syntax to enable save.');
    }
  };

  return (
    <div>
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
      <textarea
        id={id}
        rows={rows}
        spellCheck={false}
        value={text}
        onChange={(e) => onTextChange(e.target.value)}
        onBlur={field.onBlur}
        aria-invalid={!!parseError || undefined}
        aria-describedby={parseError ? `${id}-error` : undefined}
        className={
          'w-full rounded-md border bg-background p-2 font-mono text-xs ' +
          (parseError ? 'border-destructive focus-visible:ring-destructive' : 'border-input')
        }
      />
      {parseError && (
        <p id={`${id}-error`} className="mt-1 text-xs text-destructive" role="alert">
          {parseError}
        </p>
      )}
      {!parseError && help && <p className="mt-1 text-xs text-muted-foreground">{help}</p>}
    </div>
  );
}
