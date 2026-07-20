import { useMemo } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import { useInput, useGetList, type RaRecord } from 'ra-core';
import { Plus, Trash2 } from 'lucide-react';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import type { EmployeeAssignment } from '@/api/types';

export interface AssignmentEditorProps {
  source?: string;
  label?: string;
  help?: string;
}

interface NamedRecord extends RaRecord {
  code: string;
  name?: string;
}

function toAssignmentRow(entry: unknown): EmployeeAssignment {
  const r = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
  return {
    id: typeof r.id === 'string' ? r.id : undefined,
    position: typeof r.position === 'string' ? r.position : undefined,
    department: typeof r.department === 'string' ? r.department : '',
    designation: typeof r.designation === 'string' ? r.designation : '',
    fromDate: typeof r.fromDate === 'number' ? r.fromDate : Date.now(),
    toDate: typeof r.toDate === 'number' ? r.toDate : undefined,
    govtOrderNumber: typeof r.govtOrderNumber === 'string' ? r.govtOrderNumber : undefined,
    isCurrentAssignment: typeof r.isCurrentAssignment === 'boolean' ? r.isCurrentAssignment : false,
    isHod: typeof r.isHod === 'boolean' ? r.isHod : undefined,
    auditDetails: r.auditDetails && typeof r.auditDetails === 'object'
      ? r.auditDetails as EmployeeAssignment['auditDetails'] : undefined,
  };
}

function epochToInputDate(epoch: number | undefined): string {
  if (!epoch || Number.isNaN(epoch)) return '';
  try {
    return new Date(epoch).toISOString().slice(0, 10);
  } catch {
    return '';
  }
}

function inputDateToEpoch(value: string): number | undefined {
  if (!value) return undefined;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? undefined : ms;
}

export function AssignmentEditor({
  source = 'assignments',
  label = 'Assignments',
  help,
}: AssignmentEditorProps) {
  const validate = (value: unknown) => {
    if (!Array.isArray(value) || value.length === 0) return undefined;
    for (const entry of value) {
      const row = toAssignmentRow(entry);
      if (!row.department) return 'Each assignment must have a department selected';
      if (!row.designation) return 'Each assignment must have a designation selected';
    }
    return undefined;
  };

  const { id, field, fieldState } = useInput({ source, validate });

  const rows: EmployeeAssignment[] = useMemo(() => {
    if (!Array.isArray(field.value)) return [];
    return (field.value as unknown[]).map(toAssignmentRow);
  }, [field.value]);

  // Pin the dept/desig fetches to the tenant the operator picked in the
  // form. Without this, the pickers list MDMS records from the session
  // tenant (root `ke` for ADMIN), but HRMS validates the submitted code
  // against the target tenant — picking root-only codes drops every
  // create with ERR_HRMS_INVALID_DEPT.
  const formContext = useFormContext();
  const formTenantId = useWatch({ control: formContext?.control, name: 'tenantId' }) as
    | string
    | undefined;
  const tenantFilter = formTenantId ? { __tenantId: formTenantId } : undefined;

  const { data: departments, isLoading: departmentsLoading } = useGetList<NamedRecord>(
    'departments',
    { pagination: { page: 1, perPage: 1000 }, sort: { field: 'name', order: 'ASC' }, filter: tenantFilter },
  );

  const { data: designations, isLoading: designationsLoading } = useGetList<NamedRecord>(
    'designations',
    { pagination: { page: 1, perPage: 1000 }, sort: { field: 'name', order: 'ASC' }, filter: tenantFilter },
  );

  const writeRows = (next: EmployeeAssignment[]) => {
    field.onChange(next);
  };

  const updateRow = (index: number, patch: Partial<EmployeeAssignment>) => {
    const next = rows.slice();
    next[index] = { ...next[index], ...patch };
    writeRows(next);
  };

  const setCurrent = (index: number) => {
    const next = rows.map((r, i) => ({
      ...r,
      isCurrentAssignment: i === index,
      ...(i === index ? { toDate: undefined } : {}),
    }));
    writeRows(next);
  };

  const addRow = () => {
    writeRows([
      ...rows,
      {
        department: '',
        designation: '',
        fromDate: Date.now(),
        isCurrentAssignment: false,
      },
    ]);
  };

  const removeRow = (index: number) => {
    const next = rows.slice();
    next.splice(index, 1);
    writeRows(next);
  };

  const currentCount = rows.filter((r) => r.isCurrentAssignment).length;

  return (
    <div>
      {label && (
        <Label htmlFor={id} className="mb-1.5 block text-sm font-medium text-foreground">
          {label}
        </Label>
      )}

      {rows.length === 0 ? (
        <div className="flex items-center justify-between gap-3 rounded-md border border-dashed p-3">
          <p className="text-sm text-muted-foreground">No assignments added yet</p>
          <Button type="button" variant="outline" size="sm" onClick={addRow}>
            <Plus className="w-4 h-4" />
            Add assignment
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((row, index) => {
            const isCurrent = !!row.isCurrentAssignment;
            // Block removal of the sole current row until another is marked current.
            const blockRemove = isCurrent && currentCount <= 1 && rows.length > 1;
            const fromValue = epochToInputDate(row.fromDate);
            const toValue = epochToInputDate(row.toDate);
            const radioName = `${id}-current`;

            return (
              <div key={index} className="relative border rounded p-3 pr-10 bg-muted/30">
                <button
                  type="button"
                  onClick={() => removeRow(index)}
                  disabled={blockRemove}
                  aria-label={`Remove assignment ${index + 1}`}
                  title={blockRemove ? 'Mark another assignment as current first' : undefined}
                  className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 disabled:pointer-events-none"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label className="mb-1.5 block text-xs font-medium text-foreground">
                      Department
                    </Label>
                    <Select
                      value={row.department ?? ''}
                      onValueChange={(value) => updateRow(index, { department: value })}
                      disabled={departmentsLoading}
                    >
                      <SelectTrigger>
                        <SelectValue
                          placeholder={
                            departmentsLoading ? 'Loading...' : 'Select department...'
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {(departments ?? []).map((d) => (
                          <SelectItem key={d.code} value={d.code} data-value={d.code}>
                            {d.name ?? d.code}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label className="mb-1.5 block text-xs font-medium text-foreground">
                      Designation
                    </Label>
                    <Select
                      value={row.designation ?? ''}
                      onValueChange={(value) => updateRow(index, { designation: value })}
                      disabled={designationsLoading}
                    >
                      <SelectTrigger>
                        <SelectValue
                          placeholder={
                            designationsLoading ? 'Loading...' : 'Select designation...'
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {(designations ?? []).map((d) => (
                          <SelectItem key={d.code} value={d.code} data-value={d.code}>
                            {d.name ?? d.code}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label className="mb-1.5 block text-xs font-medium text-foreground">
                      From Date
                    </Label>
                    <Input
                      type="date"
                      value={fromValue}
                      onChange={(e) =>
                        updateRow(index, { fromDate: inputDateToEpoch(e.target.value) ?? Date.now() })
                      }
                    />
                  </div>

                  <div>
                    <Label className="mb-1.5 block text-xs font-medium text-foreground">
                      To Date
                    </Label>
                    <Input
                      type="date"
                      value={isCurrent ? '' : toValue}
                      disabled={isCurrent}
                      onChange={(e) =>
                        updateRow(index, { toDate: inputDateToEpoch(e.target.value) })
                      }
                    />
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <label className="inline-flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name={radioName}
                      checked={isCurrent}
                      onChange={() => setCurrent(index)}
                      className="h-4 w-4"
                    />
                    <span className={isCurrent ? 'font-medium text-foreground' : 'text-muted-foreground'}>
                      Current assignment
                    </span>
                  </label>
                  {blockRemove && (
                    <span className="text-xs text-muted-foreground">
                      Mark another current first to remove this row
                    </span>
                  )}
                </div>
              </div>
            );
          })}

          <div>
            <Button type="button" variant="outline" size="sm" onClick={addRow}>
              <Plus className="w-4 h-4" />
              Add assignment
            </Button>
          </div>
        </div>
      )}

      {fieldState.error?.message && (
        <p className="mt-1 text-xs text-destructive" role="alert">{fieldState.error.message}</p>
      )}
      {!fieldState.error?.message && help && (
        <p className="mt-1 text-xs text-muted-foreground">{help}</p>
      )}
    </div>
  );
}
