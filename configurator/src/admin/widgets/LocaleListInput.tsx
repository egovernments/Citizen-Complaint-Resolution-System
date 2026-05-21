import { useInput, type InputProps } from 'ra-core';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { X, Plus } from 'lucide-react';

interface LocaleRow {
  label?: string;
  value?: string;
}

interface LocaleListInputProps extends InputProps {
  label?: string;
  help?: string;
}

/** Editor for arrays of `{label, value}` pairs — used by `common-masters.StateInfo.languages`.
 *
 *  This is the only place that controls which locales appear in the
 *  configurator's locale dropdowns AND in the digit-ui language switcher,
 *  so it's worth a friendlier UX than the generic JSON editor.
 *
 *  - One table row per locale; both fields editable inline.
 *  - "Add language" appends a blank row.
 *  - × removes a row.
 *  - Form value is always an array of `{label, value}` (never undefined). */
export function LocaleListInput({ label, help, ...inputProps }: LocaleListInputProps) {
  const { id, field, isRequired } = useInput(inputProps);
  const value: LocaleRow[] = Array.isArray(field.value) ? field.value : [];

  const updateRow = (idx: number, patch: Partial<LocaleRow>) => {
    const next = value.map((r, i) => (i === idx ? { ...r, ...patch } : r));
    field.onChange(next);
  };

  const addRow = () => {
    field.onChange([...value, { label: '', value: '' }]);
  };

  const removeRow = (idx: number) => {
    field.onChange(value.filter((_, i) => i !== idx));
  };

  return (
    <div>
      {label && (
        <Label htmlFor={id} className="mb-1.5 block text-sm font-medium text-foreground">
          {label}
          {isRequired && <span className="text-destructive ml-0.5">*</span>}
        </Label>
      )}

      <div className="rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs font-medium text-muted-foreground">
            <tr>
              <th className="text-left px-3 py-2 w-1/2">Label</th>
              <th className="text-left px-3 py-2 w-1/2">Value</th>
              <th className="px-2 w-10"></th>
            </tr>
          </thead>
          <tbody>
            {value.length === 0 && (
              <tr>
                <td colSpan={3} className="px-3 py-4 text-center text-xs text-muted-foreground italic">
                  No locales yet — add one to make it appear in the language switcher.
                </td>
              </tr>
            )}
            {value.map((row, idx) => (
              <tr key={idx} className="border-t">
                <td className="px-3 py-1.5">
                  <Input
                    type="text"
                    placeholder="e.g. English"
                    value={row.label ?? ''}
                    onChange={(e) => updateRow(idx, { label: e.target.value })}
                    className="h-8 text-sm"
                  />
                </td>
                <td className="px-3 py-1.5">
                  <Input
                    type="text"
                    placeholder="e.g. en_IN"
                    value={row.value ?? ''}
                    onChange={(e) => updateRow(idx, { value: e.target.value })}
                    className="h-8 text-sm font-mono"
                  />
                </td>
                <td className="px-2 py-1.5 text-right">
                  <button
                    type="button"
                    onClick={() => removeRow(idx)}
                    aria-label={`Remove ${row.label || row.value || 'row ' + (idx + 1)}`}
                    className="p-1 rounded hover:bg-destructive/10 hover:text-destructive transition"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </td>

              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addRow}
          className="gap-1.5"
        >
          <Plus className="w-3.5 h-3.5" />
          Add language
        </Button>
        {help && <span className="text-xs text-muted-foreground">{help}</span>}
      </div>
    </div>
  );
}
