import { useInput, type InputProps } from 'ra-core';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { X, Plus } from 'lucide-react';

type Row = Record<string, unknown>;

interface ObjectTableInputProps extends InputProps {
  label?: string;
  help?: string;
  /** Column definitions; each row is a flat object keyed by these. */
  columns: { key: string; label: string }[];
}

/** Table editor for arrays of flat objects with configurable columns —
 *  generalization of LocaleListInput's {label, value} table (CCSD-1998:
 *  DataSecurity.EncryptionPolicy.attributeList is [{jsonPath, type}], which no
 *  existing widget could edit).
 *
 *  - One table row per array entry; every column editable inline.
 *  - "Add row" appends an entry with all columns blank; × removes a row.
 *  - Form value is always an array of flat objects (never undefined). */
export function ObjectTableInput({ label, help, columns, ...inputProps }: ObjectTableInputProps) {
  const { id, field, isRequired } = useInput(inputProps);
  const value: Row[] = Array.isArray(field.value) ? field.value : [];

  const updateRow = (idx: number, patch: Row) => {
    field.onChange(value.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  const addRow = () => {
    const blank: Row = {};
    columns.forEach((c) => {
      blank[c.key] = '';
    });
    field.onChange([...value, blank]);
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
              {columns.map((c) => (
                <th key={c.key} className="text-left px-3 py-2">
                  {c.label}
                </th>
              ))}
              <th className="px-2 w-10"></th>
            </tr>
          </thead>
          <tbody>
            {value.length === 0 && (
              <tr>
                <td
                  colSpan={columns.length + 1}
                  className="px-3 py-4 text-center text-xs text-muted-foreground italic"
                >
                  No rows yet — add one below.
                </td>
              </tr>
            )}
            {value.map((row, idx) => (
              <tr key={idx} className="border-t">
                {columns.map((c) => (
                  <td key={c.key} className="px-3 py-1.5">
                    <Input
                      type="text"
                      value={String(row[c.key] ?? '')}
                      onChange={(e) => updateRow(idx, { [c.key]: e.target.value })}
                      className="h-8 text-sm font-mono"
                    />
                  </td>
                ))}
                <td className="px-2 py-1.5 text-right">
                  <button
                    type="button"
                    onClick={() => removeRow(idx)}
                    aria-label={`Remove row ${idx + 1}`}
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
        <Button type="button" variant="outline" size="sm" onClick={addRow} className="gap-1.5">
          <Plus className="w-3.5 h-3.5" />
          Add row
        </Button>
        {help && <span className="text-xs text-muted-foreground">{help}</span>}
      </div>
    </div>
  );
}
