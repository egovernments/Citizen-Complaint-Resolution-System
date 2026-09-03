import { useMemo } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';
import { useInput, useGetList, useRecordContext, type RaRecord } from 'ra-core';
import { CalendarX, Plus, Trash2 } from 'lucide-react';
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
 * The toDate to stamp on an assignment that is being closed. egov-hrms's
 * EmployeeValidator.validateAssignments rejects the update unless the value is
 * all of:
 *   - non-null                              (ERR_HRMS_INVALID_ASSIGNMENT_NON_CURRENT_TO_DATE)
 *   - >= the assignment's own fromDate       (ERR_HRMS_INVALID_ASSIGNMENT_PERIOD)
 *   - <= the current assignment's fromDate   (ERR_HRMS_OVERLAPPING_ASSGN_CURRENT)
 *   - <= the fromDate of whichever assignment follows it in fromDate order
 *                                            (ERR_HRMS_OVERLAPPING_ASSGN)
 * so take the tightest ceiling and clamp it back up to fromDate. If the stored
 * data already breaks the last two rules (a past row that starts after the
 * current one) fromDate wins and HRMS reports it — the To Date input stays
 * editable, so the operator can reconcile it by hand.
 */
function closeDateFor(
  all: EmployeeAssignment[],
  index: number,
  currentFromDate: number | undefined,
): number {
  const row = all[index];
  const ceilings = [Date.now()];
  if (currentFromDate !== undefined) ceilings.push(currentFromDate);
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
  // half of #1957. HRMS makes two demands of the row being demoted: it must
  // carry a toDate (ERR_HRMS_INVALID_ASSIGNMENT_NON_CURRENT_TO_DATE), and it
  // must have ended by the time the current assignment starts
  // (ERR_HRMS_OVERLAPPING_ASSGN_CURRENT). The second one means HRMS only ever
  // accepts the LATEST assignment as the current one, so promoting an older row
  // has to move its fromDate up to the closing date too — a row that started
  // before the one it replaces could never satisfy the rule otherwise.
  const setCurrent = (index: number) => {
    const target = rows[index];
    if (!target) return;
    const closedDates = new Map<number, number>();
    let promotedFrom = target.fromDate;
    rows.forEach((r, i) => {
      if (i === index || !r.isCurrentAssignment) return;
      const toDate = r.toDate ?? closeDateFor(rows, i, undefined);
      closedDates.set(i, toDate);
      promotedFrom = Math.max(promotedFrom, toDate);
    });
    writeRows(
      rows.map((r, i) => {
        if (i === index) {
          return { ...r, isCurrentAssignment: true, toDate: undefined, fromDate: promotedFrom };
        }
        const toDate = closedDates.get(i);
        return toDate === undefined ? r : { ...r, isCurrentAssignment: false, toDate };
      }),
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

  // A saved assignment cannot leave the update payload:
  // EmployeeValidator.validateConsistencyAssignment fails the whole request with
  // ERR_HRMS_UPDATE_ASSIGNEMENT_INCOSISTENT unless every previously persisted id
  // comes back, and Assignment — unlike Jurisdiction — carries no isActive flag
  // to switch off (#1957). What HRMS does support is ENDING an assignment, so
  // that is what the row button does: clear isCurrentAssignment and stamp a
  // toDate. pgr-services' PolicyDrivenScopeResolver counts only current
  // assignments, so the department drops out of the employee's search scope.
  // Rows the operator added but never saved have no id and are simply dropped.
  const revokeRow = (index: number) => {
    const row = rows[index];
    if (!row) return;
    if (!row.id) {
      const next = rows.slice();
      next.splice(index, 1);
      writeRows(next);
      return;
    }
    const currentFrom = rows.find((r, i) => i !== index && r.isCurrentAssignment)?.fromDate;
    updateRow(index, {
      isCurrentAssignment: false,
      toDate: closeDateFor(rows, index, currentFrom),
    });
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
            // Stored rows can only be ended, never deleted (see revokeRow), so
            // they get a different affordance from rows still local to the form.
            const isPersisted = !!row.id;
            const isEnded = !isCurrent && row.toDate != null;
            // HRMS demands exactly one current assignment, so the last current
            // row cannot be ended until another takes over. An already-ended
            // stored row has nothing left to revoke.
            const blockedReason =
              isCurrent && currentCount <= 1 && (isPersisted || rows.length > 1)
                ? 'Mark another assignment as current first'
                : isPersisted && isEnded
                  ? 'Already ended — HRMS keeps assignment history and cannot delete a row'
                  : undefined;
            const fromValue = epochToInputDate(row.fromDate);
            const toValue = epochToInputDate(row.toDate);
            const radioName = `${id}-current`;

            return (
              <div key={index} className="relative border rounded p-3 pr-10 bg-muted/30">
                <button
                  type="button"
                  onClick={() => revokeRow(index)}
                  disabled={blockedReason !== undefined}
                  aria-label={`${isPersisted ? 'End' : 'Remove'} assignment ${index + 1}`}
                  title={
                    blockedReason ??
                    (isPersisted
                      ? 'End this assignment — the department leaves this employee’s active scope, and HRMS keeps the row as history'
                      : undefined)
                  }
                  className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 disabled:pointer-events-none"
                >
                  {isPersisted ? <CalendarX className="h-4 w-4" /> : <Trash2 className="h-4 w-4" />}
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
                  {blockedReason && (
                    <span className="text-xs text-muted-foreground">{blockedReason}</span>
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
          HRMS never deletes a saved assignment. Ending one clears its current flag and stamps a To
          Date, which takes the department out of the employee’s active scope while the row
          stays on record.
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
