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
  levelCode: string;
  parentLevel: string | null;
  isLeafServiceCode: boolean;
}

export interface ComplaintLevelEditorProps {
  source?: string;
  label?: string;
  help?: string;
}

/** Multi-row editor for a complaint hierarchy's CONFIGURABLE levels. Each row
 *  captures a levelCode, its parent level, and whether it is the leaf
 *  (serviceCode) level. The number of rows IS the depth of the hierarchy —
 *  add or remove rows to make a 2-level or 5-level taxonomy with no code
 *  change. Directly analogous to the boundary HierarchyLevelEditor; row 0 is
 *  the root (no parent), and each later row's parent is limited to an earlier
 *  level. The Create screen's transform stamps `order` (= row index + 1) and
 *  `isFreeText`/`label` before submit. */
export function ComplaintLevelEditor({
  source = 'levels',
  label = 'Hierarchy Levels',
  help,
}: ComplaintLevelEditorProps) {
  const { id, field } = useInput({ source });

  const rows: Level[] = useMemo(() => {
    if (!Array.isArray(field.value)) return [];
    return (field.value as unknown[]).map((v) => {
      const r = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
      return {
        levelCode: typeof r.levelCode === 'string' ? r.levelCode : '',
        parentLevel:
          typeof r.parentLevel === 'string' && r.parentLevel ? r.parentLevel : null,
        isLeafServiceCode: !!r.isLeafServiceCode,
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
        levelCode: '',
        parentLevel: rows.length === 0 ? null : last?.levelCode || null,
        isLeafServiceCode: false,
      },
    ]);
  };

  const removeRow = (index: number) => {
    const next = rows.slice();
    next.splice(index, 1);
    const known = new Set(next.map((r) => r.levelCode).filter(Boolean));
    for (const r of next) {
      if (r.parentLevel && !known.has(r.parentLevel)) r.parentLevel = null;
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
              .map((r) => r.levelCode)
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
                <div className="mb-2 text-xs font-semibold text-muted-foreground">
                  Level {index + 1}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label className="mb-1.5 block text-xs font-medium text-foreground">
                      Level Code
                    </Label>
                    <Input
                      type="text"
                      value={row.levelCode}
                      onChange={(e) => updateRow(index, { levelCode: e.target.value })}
                      placeholder="e.g. AUTHORITY_TYPE, SECTOR, SUB_TYPE"
                    />
                  </div>
                  <div>
                    <Label className="mb-1.5 block text-xs font-medium text-foreground">
                      Parent Level
                    </Label>
                    {index === 0 ? (
                      <Input type="text" disabled value="(root — no parent)" />
                    ) : (
                      <Select
                        value={row.parentLevel ?? ''}
                        onValueChange={(v) => updateRow(index, { parentLevel: v || null })}
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
                <label className="mt-3 flex items-center gap-2 text-xs font-medium text-foreground">
                  <input
                    type="checkbox"
                    checked={row.isLeafServiceCode}
                    onChange={(e) => updateRow(index, { isLeafServiceCode: e.target.checked })}
                  />
                  Leaf level (its values are complaint serviceCodes)
                </label>
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
