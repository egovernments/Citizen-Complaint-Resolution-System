import { useMemo } from 'react';
import { useInput } from 'ra-core';
import { Plus, Trash2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';

interface Level {
  boundaryType: string;
  parentBoundaryType: string | null;
}

export interface HierarchyLevelEditorProps {
  source?: string;
  label?: string;
  help?: string;
}

/** Multi-row editor for a boundary hierarchy's levels. Each row captures a
 *  boundaryType and its parent. The parent dropdown for row N is limited to
 *  earlier rows — enforcing a strictly-linear chain — with the first row
 *  locked at parent = null (root of the tree).
 *
 *  The boundary-hierarchy `_create` endpoint expects an array
 *  `boundaryHierarchy: [{boundaryType, parentBoundaryType, active}]`. This
 *  editor writes that shape; the data-provider stamps `active: true`. */
export function HierarchyLevelEditor({
  source = 'boundaryHierarchy',
  label = 'Hierarchy Levels',
  help,
}: HierarchyLevelEditorProps) {
  const { id, field } = useInput({ source });

  const rows: Level[] = useMemo(() => {
    if (!Array.isArray(field.value)) return [];
    return (field.value as unknown[]).map((v) => {
      const r = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
      return {
        boundaryType: typeof r.boundaryType === 'string' ? r.boundaryType : '',
        parentBoundaryType:
          typeof r.parentBoundaryType === 'string' && r.parentBoundaryType
            ? r.parentBoundaryType
            : null,
      };
    });
  }, [field.value]);

  const write = (next: Level[]) => field.onChange(next);

  const updateRow = (index: number, patch: Partial<Level>) => {
    const next = rows.slice();
    next[index] = { ...next[index], ...patch };
    write(next);
  };

  const addRow = () => {
    const last = rows[rows.length - 1];
    write([
      ...rows,
      {
        boundaryType: '',
        // First row has no parent; later rows default to chaining off the
        // previous row so the hierarchy stays linear by default.
        parentBoundaryType: rows.length === 0 ? null : last?.boundaryType || null,
      },
    ]);
  };

  const removeRow = (index: number) => {
    const next = rows.slice();
    next.splice(index, 1);
    // If we removed a row other rows reference as their parent, coerce any
    // dangling references to null so the server doesn't get a broken chain.
    const known = new Set(next.map((r) => r.boundaryType).filter(Boolean));
    for (const r of next) {
      if (r.parentBoundaryType && !known.has(r.parentBoundaryType)) {
        r.parentBoundaryType = null;
      }
    }
    write(next);
  };

  return (
    <div>
      {label && (
        <Label htmlFor={id} className="mb-1.5 block text-sm font-medium text-foreground">
          {label}
        </Label>
      )}

      {rows.length === 0 ? (
        <div className="flex items-center justify-between gap-3 rounded-md border border-dashed p-3">
          <p className="text-sm text-muted-foreground">No levels yet</p>
          <Button type="button" variant="outline" size="sm" onClick={addRow}>
            <Plus className="w-4 h-4" />
            Add level
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((row, index) => {
            const parentChoices = rows
              .slice(0, index)
              .map((r) => r.boundaryType)
              .filter((t) => t);
            return (
              <div key={index} className="relative border rounded p-3 pr-10 bg-muted/30">
                <button
                  type="button"
                  onClick={() => removeRow(index)}
                  aria-label={`Remove level ${index + 1}`}
                  className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label className="mb-1.5 block text-xs font-medium text-foreground">
                      Boundary Type
                    </Label>
                    <Input
                      type="text"
                      value={row.boundaryType}
                      onChange={(e) => updateRow(index, { boundaryType: e.target.value })}
                      placeholder="e.g. County"
                    />
                  </div>
                  <div>
                    <Label className="mb-1.5 block text-xs font-medium text-foreground">
                      Parent Boundary Type
                    </Label>
                    {index === 0 ? (
                      <Input type="text" disabled value="(root — no parent)" />
                    ) : (
                      <Select
                        value={row.parentBoundaryType ?? ''}
                        onValueChange={(v) =>
                          updateRow(index, { parentBoundaryType: v || null })
                        }
                        disabled={parentChoices.length === 0}
                      >
                        <SelectTrigger>
                          <SelectValue
                            placeholder={
                              parentChoices.length === 0
                                ? 'Fill earlier rows first'
                                : 'Select parent…'
                            }
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {parentChoices.map((p) => (
                            <SelectItem key={p} value={p}>
                              {p}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          <div>
            <Button type="button" variant="outline" size="sm" onClick={addRow}>
              <Plus className="w-4 h-4" />
              Add level
            </Button>
          </div>
        </div>
      )}

      {help && <p className="mt-1 text-xs text-muted-foreground">{help}</p>}
    </div>
  );
}
