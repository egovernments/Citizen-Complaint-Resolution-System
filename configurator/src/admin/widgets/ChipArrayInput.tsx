import { useState, type KeyboardEvent } from 'react';
import { useInput, type InputProps } from 'ra-core';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { X } from 'lucide-react';

interface ChipArrayInputProps extends InputProps {
  label?: string;
  help?: string;
}

/** string[] editor: add on Enter/comma, remove via × button. Form value is
 *  the string array; drafts live in local state until committed. */
export function ChipArrayInput({ label, help, ...inputProps }: ChipArrayInputProps) {
  const { id, field, isRequired } = useInput(inputProps);
  const [draft, setDraft] = useState('');
  const value: string[] = Array.isArray(field.value) ? field.value : [];

  const commit = () => {
    const next = draft.trim();
    if (!next) return;
    if (!value.includes(next)) field.onChange([...value, next]);
    setDraft('');
  };

  const remove = (item: string) => {
    field.onChange(value.filter((v) => v !== item));
  };

  const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Backspace' && !draft && value.length > 0) {
      field.onChange(value.slice(0, -1));
    }
  };

  return (
    <div>
      {label && (
        <Label htmlFor={id} className="mb-1.5 block text-sm font-medium text-foreground">
          {label}
          {isRequired && <span className="text-destructive ml-0.5">*</span>}
        </Label>
      )}
      <div className="flex flex-wrap gap-1.5 mb-1.5">
        {value.map((item) => (
          <span
            key={item}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-primary/10 text-primary text-xs font-medium"
          >
            {item}
            <button
              type="button"
              onClick={() => remove(item)}
              aria-label={`remove ${item}`}
              className="hover:text-destructive"
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
      </div>
      <Input
        id={id}
        type="text"
        placeholder="type and press Enter"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKey}
        onBlur={() => { if (draft.trim()) commit(); field.onBlur(); }}
      />
      {help && <p className="mt-1 text-xs text-muted-foreground">{help}</p>}
    </div>
  );
}
