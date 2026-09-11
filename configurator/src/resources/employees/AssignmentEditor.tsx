import { useMemo } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import { useInput, useGetList, useRecordContext, type RaRecord } from 'ra-core';
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
import { uniqueBy } from '@/lib/uniqueBy';
import type { Employee, EmployeeAssignment } from '@/api/types';
import { useEmployeeLookup } from '@/admin/hrms/useEmployeeLookup';
import { ReportingToSelect } from './ReportingToSelect';

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
    reportingTo: typeof r.reportingTo === 'string' ? r.reportingTo : undefined,
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

/**
 * A toDate for an assignment that has none, closing it today unless a later
 * assignment already occupies that window. egov-hrms's
 * EmployeeValidator.validateAssignments needs the value to be:
 *   - non-null                          (ERR_HRMS_INVALID_ASSIGNMENT_NON_CURRENT_TO_DATE)
 *   - >= the assignment's own fromDate   (ERR_HRMS_INVALID_ASSIGNMENT_PERIOD)
 *   - <= the fromDate of whichever assignment follows it in fromDate order
 *                                        (ERR_HRMS_OVERLAPPING_ASSGN)
 * so take the tightest ceiling and clamp it back up to fromDate. The remaining
 * rule — every non-current row must have ended by the current one's fromDate
 * (ERR_HRMS_OVERLAPPING_ASSGN_CURRENT) — is enforced in setCurrent instead,
 * because it constrains the row being promoted rather than the rows being
 * closed.
 */
function closeDateFor(all: EmployeeAssignment[], index: number): number {
  const row = all[index];
  const ceilings = [Date.now()];
  for (let i = 0; i < all.length; i++) {
    if (i === index) continue;
    if (all[i].fromDate > row.fromDate) ceilings.push(all[i].fromDate);
  }
  return Math.max(row.fromDate, Math.min(...ceilings));
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

  // Both pickers submit `code`, so two master records sharing a code would
  // render as duplicate SelectItems with the same value — Radix marks every one
  // of them checked and concatenates their labels into the trigger (#1923).
  const departmentChoices = useMemo(
    () => uniqueBy(departments, (d) => d.code),
    [departments],
  );
  const designationChoices = useMemo(
    () => uniqueBy(designations, (d) => d.code),
    [designations],
  );

  const { employees: managerCandidates, isLoading: managersLoading } = useEmployeeLookup(tenantFilter);
  // On the edit form this is the employee being edited; on create there's no
  // record yet, so nothing needs to be excluded from the manager list.
  const record = useRecordContext<Employee>();
  const ownUuid = record?.uuid;

  const writeRows = (next: EmployeeAssignment[]) => {
    field.onChange(next);
  };

  const updateRow = (index: number, patch: Partial<EmployeeAssignment>) => {
    const next = rows.slice();
    next[index] = { ...next[index], ...patch };
    writeRows(next);
  };

  // Handing `current` to another row is the only way to revoke the department an
  // employee is actively working in, and it used to be unsavable — the other
  // half of #1957. HRMS requires every row that ends up non-current to carry a
  // toDate (ERR_HRMS_INVALID_ASSIGNMENT_NON_CURRENT_TO_DATE) that has passed by
  // the time the current assignment starts (ERR_HRMS_OVERLAPPING_ASSGN_CURRENT).
  // That second rule covers EVERY non-current row, not just the one being
  // demoted, so the promoted row's fromDate has to clear the latest close date
  // on the whole record — an employee carrying several closed rows, which is how
  // hrmsService.buildEmployee represents extra departments, is otherwise still
  // rejected with the very error this fix is about.
  const setCurrent = (index: number) => {
    const target = rows[index];
    if (!target) return;
    // Close date for every row that will end up non-current. An existing toDate
    // is kept, but clamped: the To Date input is blanked and disabled while a
    // row is current, so a stored current row can carry a stale value the
    // operator cannot see, and sending toDate < fromDate 400s on
    // ERR_HRMS_INVALID_ASSIGNMENT_PERIOD for a field they never touched.
    const closedDates = new Map<number, number>();
    for (let i = 0; i < rows.length; i++) {
      if (i === index) continue;
      const stored = rows[i].toDate;
      closedDates.set(
        i,
        stored == null ? closeDateFor(rows, i) : Math.max(rows[i].fromDate, stored),
      );
    }
    const promotedFrom = Math.max(target.fromDate, ...closedDates.values());
    writeRows(
      rows.map((r, i) =>
        i === index
          ? { ...r, isCurrentAssignment: true, toDate: undefined, fromDate: promotedFrom }
          : { ...r, isCurrentAssignment: false, toDate: closedDates.get(i) },
      ),
    );
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

  // Only rows the operator has not saved yet can be dropped. A saved assignment
  // cannot leave the update payload at all —
  // EmployeeValidator.validateConsistencyAssignment fails the whole request with
  // ERR_HRMS_UPDATE_ASSIGNEMENT_INCOSISTENT unless every previously persisted id
  // comes back, and Assignment (unlike Jurisdiction) has no isActive flag to
  // switch off (#1957). Revoking a saved department goes through setCurrent,
  // which ends it; there is nothing a per-row control could do on its own, since
  // HRMS insists on exactly one current assignment and already requires every
  // other saved row to carry a toDate.
  const removeRow = (index: number) => {
    const row = rows[index];
    if (!row || row.id) return;
    const next = rows.slice();
    next.splice(index, 1);
    writeRows(next);
  };

  const currentCount = rows.filter((r) => r.isCurrentAssignment).length;
  const hasPersistedRow = rows.some((r) => !!r.id);

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
            // Saved rows get no remove control at all (see removeRow): only they
            // can be "ended", and only setCurrent can do it.
            const isPersisted = !!row.id;
            // Gated on isPersisted: setCurrent stamps a toDate on whatever row
            // it demotes, including a throwaway row the operator added and is
            // about to delete — which has no history to be retained in.
            const isEnded = isPersisted && !isCurrent && row.toDate != null;
            // Dropping the only current row would leave HRMS without one.
            const blockRemove = isCurrent && currentCount <= 1 && rows.length > 1;
            const fromValue = epochToInputDate(row.fromDate);
            const toValue = epochToInputDate(row.toDate);
            const radioName = `${id}-current`;

            return (
              <div key={index} className="relative border rounded p-3 pr-10 bg-muted/30">
                {!isPersisted && (
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
                )}
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
                        {departmentChoices.map((d) => (
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
                        {designationChoices.map((d) => (
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

                  <div className="sm:col-span-2">
                    <Label className="mb-1.5 block text-xs font-medium text-foreground">
                      Reporting To
                    </Label>
                    <ReportingToSelect
                      id={`${id}-${index}-reportingTo`}
                      value={row.reportingTo}
                      onChange={(uuid) => updateRow(index, { reportingTo: uuid })}
                      candidates={managerCandidates}
                      isLoading={managersLoading}
                      excludeUuid={ownUuid}
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
                  {isEnded && (
                    <span className="text-xs text-muted-foreground">
                      Ended {toValue} · retained as history
                    </span>
                  )}
                  {blockRemove && (
                    <span className="text-xs text-muted-foreground">
                      Mark another assignment as current first
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

      {hasPersistedRow && (
        <p className="mt-1 text-xs text-muted-foreground">
          HRMS never deletes a saved assignment. To revoke a department, mark another one as the
          current assignment — that closes this one with a To Date and takes its department out of
          the employee’s active scope, while the row stays on record.
        </p>
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
