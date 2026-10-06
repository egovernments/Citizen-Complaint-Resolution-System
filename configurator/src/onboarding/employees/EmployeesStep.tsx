import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, FileText, LayoutGrid, Network, Plus, Users } from 'lucide-react';
import { useApp } from '../../App';
import type { Employee } from '@/api/types';
import type { Member } from '@/identity/api';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { DeleteConfirmDialog } from '@/components/ui/delete-confirm-dialog';
import { toast } from '@/hooks/use-toast';
import { StepHeader } from '../StepHeader';
import { EmptyState, OptionCard, StepActions } from '../StepParts';
import { adjacentSteps, stepById } from '../steps';
import { probeGate, useStepProbe } from '../stepProbe';
import { describeSaveError } from '../errors';
import { reportStepError, trackStepAction } from '../telemetry';
import { EmployeeDialog } from './EmployeeDialog';
import BulkEmployeeImport from './BulkEmployeeImport';
import { InviteState } from './InviteState';
import {
  activationNotNeeded,
  describeInviteError,
  inviteStatus,
  loadMembers,
  resendInvite,
  sendInvite,
  type InviteStatus,
} from './inviteStatus';
import {
  addEmployee,
  currentAssignment,
  listEmployees,
  loadEmployeeOptions,
  removeEmployee,
  updateEmployeeDetails,
  suggestEmployeeCode,
  type EmployeeOptions,
  type EmailOutcome,
  type EmployeeChanges,
  type NewEmployee,
} from './employeesApi';

const STEP = stepById('employees');

const EMAIL_OUTCOME: Record<EmailOutcome, string | undefined> = {
  unchanged: undefined,
  verification_sent: 'We sent a link to the new email. It takes effect once they confirm it.',
  invited: 'Their invitation now goes to the new email.',
  saved: undefined,
};

/** Under the edit dialog's title: what a new email does for someone in this state. */
const EMAIL_NOTE: Record<InviteStatus['kind'], string | undefined> = {
  active: 'A new email is confirmed by a link sent to it.',
  invited: 'A new email replaces their invitation with one sent to it.',
  expired: undefined,
  removed: undefined,
  none: undefined,
};
const DEPARTMENTS = stepById('departments');
const { previous, next } = adjacentSteps('employees');

export default function EmployeesStep() {
  const { state, completePhase } = useApp();
  const navigate = useNavigate();
  const tenant = state.targetTenant || state.tenant;
  const done = state.completedPhases.includes(STEP.number);

  const [options, setOptions] = useState<EmployeeOptions | null>(null);
  const [employees, setEmployees] = useState<Employee[] | null>(null);
  // Every code HRMS holds, removed employees' included.
  const [codes, setCodes] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [bulk, setBulk] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  // Sign-in state by DIGIT uuid, from the identity BFF. It loads apart from HRMS, so a failure
  // here only hides the states and the list still works.
  const [memberIndex, setMemberIndex] = useState<Map<string, Member> | null>(null);
  const [membersFailed, setMembersFailed] = useState(false);
  const [membersKey, setMembersKey] = useState(0);
  const [sending, setSending] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadEmployeeOptions(tenant), listEmployees(tenant)])
      .then(([loadedOptions, loadedEmployees]) => {
        if (cancelled) return;
        setOptions(loadedOptions);
        setEmployees(loadedEmployees.active);
        setCodes(loadedEmployees.codes);
        setLoadError(null);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [tenant, reloadKey]);

  useEffect(() => {
    let cancelled = false;
    loadMembers(tenant)
      .then((index) => {
        if (cancelled) return;
        setMemberIndex(index);
        setMembersFailed(false);
      })
      .catch((err) => {
        if (cancelled) return;
        reportStepError('employees', 'load_members', err, tenant);
        setMembersFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [tenant, reloadKey, membersKey]);

  const reload = () => setReloadKey((key) => key + 1);
  const uuidOf = (employee: Employee) => employee.user?.uuid || employee.uuid;
  const memberOf = (employee: Employee) => {
    const uuid = uuidOf(employee);
    return uuid ? memberIndex?.get(uuid) : undefined;
  };
  /** null while the member list is loading or failed to load. */
  const statusOf = (employee: Employee): InviteStatus | null => (memberIndex ? inviteStatus(memberOf(employee)) : null);

  const names = useMemo(() => {
    const of = (list: { code: string; name: string }[] | undefined) => new Map((list ?? []).map((item) => [item.code, item.name]));
    return {
      departments: of(options?.departments),
      designations: of(options?.designations),
      boundaries: of(options?.boundaries),
    };
  }, [options]);

  // The signed-in admin is an employee too; they are listed but can't be removed from here.
  const isSelf = (employee: Employee) => !!state.user?.uuid && employee.user?.uuid === state.user.uuid;
  const others = (employees ?? []).filter((employee) => !isSelf(employee));
  const { probe, recheck } = useStepProbe(state.tenant, 'EMPLOYEES', others.map((employee) => employee.code).join(','));
  const gate = probeGate(
    'EMPLOYEES',
    { ready: others.length > 0, hint: others.length === 0 ? 'Add at least one employee to continue.' : undefined },
    probe,
  );

  const add = async (input: NewEmployee) => {
    if (!options) return;
    const created = await addEmployee(tenant, input, options).catch((err: unknown) => {
      reportStepError('employees', 'create_employee', err, tenant);
      throw err;
    });
    trackStepAction('employees', 'entity_create', 'employee', {
      tenant,
      source: 'form',
      departments: input.departments.length,
      roles: input.roles.length,
      jurisdictions: input.jurisdictions.length,
      email: !!input.emailId,
    });
    toast({ title: `${created.user.name} added`, description: `They sign in as ${created.user.userName}.` });
    reload();
  };

  const update = async (employee: Employee, changes: EmployeeChanges) => {
    if (!options) return;
    const { email } = await updateEmployeeDetails(employee, changes, options, statusOf(employee)).catch((err: unknown) => {
      reportStepError('employees', 'update_employee', err, tenant);
      throw err;
    });
    trackStepAction('employees', 'entity_update', 'employee', {
      tenant,
      source: 'form',
      roles: changes.roles.length,
      jurisdictions: changes.jurisdictions.length,
      email,
    });
    toast({ title: `${changes.name} updated`, description: EMAIL_OUTCOME[email] });
    reload();
  };

  // One email action per row: resend to an active or invited member, otherwise invite.
  const emailAction = async (employee: Employee, status: InviteStatus) => {
    const name = employee.user?.name ?? employee.code;
    const member = memberOf(employee);
    const resending = !!member && (status.kind === 'active' || status.kind === 'invited');
    setSending(employee.code);
    try {
      if (resending) {
        const { email, activationEmail } = await resendInvite(employee, member);
        trackStepAction('employees', 'entity_update', 'employee', { tenant, invite: 'resend', activationEmail });
        toast({
          title: `Email sent to ${email}`,
          description: activationEmail === 'password_setup' ? 'It has a link to set their password.' : 'It has a link to confirm their email address.',
        });
      } else {
        const { email, invited } = await sendInvite(employee, status.kind !== 'none');
        trackStepAction('employees', 'entity_update', 'employee', { tenant, invite: status.kind === 'none' ? 'send' : 'again' });
        toast({
          title: `Invitation sent to ${email}`,
          description: invited
            ? `${name} already has an account, so they’ll see the invitation when they next sign in.`
            : 'It has a link to set their password.',
        });
        setMembersKey((key) => key + 1);
      }
    } catch (err) {
      if (resending && activationNotNeeded(err)) {
        toast(
          status.kind === 'active'
            ? { title: `${name} has already set up sign-in`, description: 'There’s nothing to resend.' }
            : { title: `${name} already has an account`, description: 'They’ll see the invitation when they next sign in.' },
        );
      } else {
        reportStepError('employees', resending ? 'resend_invite' : 'send_invite', err, tenant);
        toast({ variant: 'destructive', title: 'The email wasn’t sent', description: describeInviteError(err) });
      }
    } finally {
      setSending(null);
    }
  };

  // The confirm dialog shows a thrown error and stays open, so the wording is set here.
  const remove = async (employee: Employee) => {
    try {
      await removeEmployee(employee);
    } catch (err) {
      reportStepError('employees', 'delete_employee', err, tenant);
      throw new Error(describeSaveError(err, 'Removing failed. Try again.'));
    }
    trackStepAction('employees', 'entity_delete', 'employee', { tenant });
    toast({ title: `${employee.user.name} removed` });
    reload();
  };

  const loaded = options !== null && employees !== null;
  const header = (
    <StepHeader eyebrow="Your organisation" title="Employees" done={done}>
      The people who will use your complaint system.
    </StepHeader>
  );

  if (loadError) {
    return (
      <div className="space-y-8">
        {header}
        <Alert variant="destructive">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>Couldn’t load your employees. {loadError}</span>
            <Button variant="outline" size="sm" onClick={reload}>
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!loaded) {
    return (
      <div className="space-y-8">
        {header}
        <div className="h-40 rounded-lg border border-dashed border-border bg-muted/40 animate-pulse" aria-busy="true" />
      </div>
    );
  }

  // Everyone belongs to a department, so there is nobody to add until one exists.
  if (options.departments.length === 0) {
    return (
      <div className="space-y-8">
        {header}
        <EmptyState icon={Network} title="You will have to create a department first">
          Everyone you add belongs to a department, so there needs to be at least one before you can start adding
          employees.
        </EmptyState>
        <div className="flex justify-center">
          <Button onClick={() => navigate(DEPARTMENTS.path)} className="gap-2">
            Add departments
            <ArrowRight className="w-4 h-4" />
          </Button>
        </div>
      </div>
    );
  }

  if (bulk) {
    return (
      <div className="space-y-6">
        <StepHeader eyebrow="Employees" title="Upload your staff list" done={done}>
          Get a template with your departments, designations, roles and areas built in, fill it, and upload it.
        </StepHeader>
        <BulkEmployeeImport
          onCancel={() => setBulk(false)}
          onDone={() => {
            setBulk(false);
            reload();
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {header}

      {others.length === 0 ? (
        <div className="space-y-6">
          <EmptyState icon={Users} title="No employees yet">
            These are the people who will handle complaints. Add them one at a time, or upload your staff list.
          </EmptyState>
          <section className="space-y-4">
            <h3 className="text-lg font-semibold text-foreground">How do you want to add your employees?</h3>
            <div className="grid max-w-xl grid-cols-1 gap-4 sm:grid-cols-2">
              <OptionCard icon={FileText} title="Create manually" action="Start adding" onClick={() => setAdding(true)}>
                Type in people one at a time.
              </OptionCard>
              <OptionCard icon={LayoutGrid} title="Bulk upload" action="Upload a file" onClick={() => setBulk(true)}>
                Upload a staff list and we will bring everyone in.
              </OptionCard>
            </div>
          </section>
        </div>
      ) : (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-semibold text-foreground">Employees</h3>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{employees.length}</span>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => setBulk(true)} className="h-9 text-primary hover:text-primary">
                Upload a file
              </Button>
              <Button size="sm" onClick={() => setAdding(true)} className="h-9 gap-1.5">
                <Plus className="w-4 h-4" />
                Add employee
              </Button>
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs font-medium uppercase tracking-[0.5px] text-muted-foreground">
                <tr>
                  <th scope="col" className="hidden sm:table-cell px-4 py-2.5 font-medium">Code</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">Name</th>
                  <th scope="col" className="hidden lg:table-cell px-4 py-2.5 font-medium">Contact</th>
                  <th scope="col" className="hidden md:table-cell px-4 py-2.5 font-medium">Department</th>
                  <th scope="col" className="hidden xl:table-cell px-4 py-2.5 font-medium">System roles</th>
                  <th scope="col" className="hidden xl:table-cell px-4 py-2.5 font-medium">Jurisdictions</th>
                  <th scope="col" className="px-4 py-2.5">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {employees.map((employee) => {
                  const assignment = currentAssignment(employee);
                  const department = assignment ? names.departments.get(assignment.department) ?? assignment.department : '—';
                  const designation = assignment ? names.designations.get(assignment.designation) ?? assignment.designation : '';
                  const roles = (employee.user?.roles ?? []).map((role) => role.code).join(', ');
                  const areas = (employee.jurisdictions ?? [])
                    .filter((jurisdiction) => jurisdiction.isActive !== false)
                    .map((jurisdiction) => names.boundaries.get(jurisdiction.boundary) ?? jurisdiction.boundary)
                    .join(', ');
                  const self = isSelf(employee);
                  return (
                    <tr key={employee.uuid ?? employee.code} className="border-t border-border align-top">
                      <td className="hidden sm:table-cell px-4 py-3 font-mono text-xs text-muted-foreground whitespace-nowrap">{employee.code}</td>
                      <td className="px-4 py-3">
                        <span className="block font-medium text-foreground">
                          {employee.user?.name}
                          {self && <span className="ml-1.5 text-xs font-normal text-muted-foreground">(you)</span>}
                        </span>
                        <span className="block text-xs text-muted-foreground">{employee.user?.userName}</span>
                        {!self && statusOf(employee) && (
                          <InviteState
                            status={statusOf(employee)!}
                            name={employee.user?.name ?? employee.code}
                            busy={sending === employee.code}
                            onAction={() => void emailAction(employee, statusOf(employee)!)}
                          />
                        )}
                        <span className="block md:hidden text-xs text-muted-foreground">
                          {department}
                          {designation && ` · ${designation}`}
                        </span>
                      </td>
                      <td className="hidden lg:table-cell px-4 py-3 text-muted-foreground">
                        <span className="block">{employee.user?.mobileNumber}</span>
                        {employee.user?.emailId && <span className="block text-xs">{employee.user.emailId}</span>}
                      </td>
                      <td className="hidden md:table-cell px-4 py-3 text-muted-foreground">
                        <span className="block text-foreground">{department}</span>
                        {designation && <span className="block text-xs">{designation}</span>}
                      </td>
                      <td className="hidden xl:table-cell px-4 py-3 text-xs text-muted-foreground">{roles || '—'}</td>
                      <td className="hidden xl:table-cell px-4 py-3 text-xs text-muted-foreground">{areas || '—'}</td>
                      <td className="px-2 py-2 text-right whitespace-nowrap">
                        <Button variant="ghost" size="sm" onClick={() => setEditing(employee)} aria-label={`Edit ${employee.user?.name}`}>
                          Edit
                        </Button>
                        {!self && (
                          <DeleteConfirmDialog
                            title={`Remove ${employee.user?.name}?`}
                            description={`${employee.user?.name} won’t be able to sign in or handle complaints after this.`}
                            onConfirm={() => remove(employee)}
                            trigger={
                              <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" aria-label={`Remove ${employee.user?.name}`}>
                                Remove
                              </Button>
                            }
                          />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {membersFailed && (
            <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              Couldn’t load invitation status.
              <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => setMembersKey((key) => key + 1)}>
                Try again
              </Button>
            </p>
          )}
        </section>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <StepActions
          onBack={previous ? () => navigate(previous.path) : undefined}
          onContinue={async () => {
            if (!await completePhase(STEP.number)) return;
            if (next) navigate(next.path);
          }}
          disabled={gate.disabled}
          hint={gate.hint}
        />
        {gate.canRecheck && (
          <Button variant="ghost" size="sm" onClick={recheck}>
            Check again
          </Button>
        )}
      </div>

      <EmployeeDialog
        open={adding || !!editing}
        options={options}
        suggestedCode={suggestEmployeeCode(codes)}
        takenCodes={new Set(codes)}
        employee={editing ?? undefined}
        emailLocked={!!editing && isSelf(editing)}
        emailNote={editing ? EMAIL_NOTE[statusOf(editing)?.kind ?? 'active'] : undefined}
        onOpenChange={(open) => {
          if (open) return;
          setAdding(false);
          setEditing(null);
        }}
        onSave={add}
        onUpdate={update}
      />
    </div>
  );
}
