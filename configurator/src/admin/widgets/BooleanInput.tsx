import { useInput, type InputProps } from 'ra-core';
import { Label } from '@/components/ui/label';

interface BooleanInputProps extends InputProps {
  label?: string;
  help?: string;
}

/** Checkbox bound to a real boolean form value. Unlike a text-fallback, this
 *  preserves the boolean type on round-trip — some MDMS schemas reject
 *  string-"true" where a JSON bool is expected. */
export function BooleanInput({ label, help, ...inputProps }: BooleanInputProps) {
  const { id, field, isRequired } = useInput({
    ...inputProps,
    parse: (v: boolean) => v,
  });
  return (
    <div>
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="checkbox"
          checked={!!field.value}
          onChange={(e) => field.onChange(e.target.checked)}
          onBlur={field.onBlur}
          className="h-4 w-4 rounded border-input cursor-pointer"
        />
        {label && (
          <Label htmlFor={id} className="text-sm font-medium text-foreground">
            {label}
            {isRequired && <span className="text-destructive ml-0.5">*</span>}
          </Label>
        )}
      </div>
      {help && <p className="mt-1 text-xs text-muted-foreground">{help}</p>}
    </div>
  );
}
