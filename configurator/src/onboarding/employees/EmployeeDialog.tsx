import { useId, useMemo, useState, type ReactNode } from 'react';
import { Loader2, Search } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { describeSaveError } from '../errors';
import type { Employee } from '@/api/types';
import { pickerChoices } from '@/lib/systemRecords';
import { currentAssignment, type Choice, type EmployeeChanges, type EmployeeOptions, type NewEmployee } from './employeesApi';

/** A labelled list of checkboxes, with a filter once it gets long. */
function CheckList({
  legend,
  hint,
  choices,
  picked,
  onChange,
  error,
  empty,
  detail,
}: {
  legend: string;
  hint?: string;
  choices: Choice[];
  picked: string[];
  onChange: (next: string[]) => void;
  error?: string;
  empty: string;
  detail?: (choice: Choice) => string;
}) {
  const [query, setQuery] = useState('');
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? choices.filter((choice) => `${choice.name} ${choice.code}`.toLowerCase().includes(q)) : choices;
  }, [choices, query]);

  return (
    <fieldset className="space-y-1.5">
      <legend className="text-sm font-medium text-foreground">{legend}</legend>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {choices.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <div className="rounded-md border border-border">
          {choices.length > 8 && (
            <div className="relative border-b border-border">
              <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Filter"
                aria-label={`Filter ${legend.toLowerCase()}`}
                className="h-9 w-full bg-transparent pl-8 pr-3 text-sm focus:outline-none"
              />
            </div>
          )}
          <div className="max-h-36 overflow-y-auto p-1.5 space-y-0.5">
            {shown.map((choice) => {
              const checked = picked.includes(choice.code);
              return (
                <label key={choice.code} className="flex items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-muted">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onChange(checked ? picked.filter((code) => code !== choice.code) : [...picked, choice.code])}
                    className="h-4 w-4 accent-[hsl(var(--primary))]"
                  />
                  <span className="flex-1">{choice.name}</span>
                  <span className="text-xs text-muted-foreground">{detail ? detail(choice) : choice.code}</span>
                </label>
              );
            })}
            {shown.length === 0 && <p className="px-1.5 py-1 text-sm text-muted-foreground">Nothing matches.</p>}
          </div>
        </div>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </fieldset>
  );
}

type Errors = Partial<Record<'code' | 'name' | 'mobile' | 'email' | 'departments' | 'designation' | 'jurisdictions', string>>;

/**
 * Add one employee: who they are, how to reach them, the departments and
 * designation they hold, what they can do, and where they can act. Everything
 * they choose from comes from the earlier steps.
 *
 * Given `employee`, it edits that person instead: the code stays, and the
 * department is the main one, since HRMS keeps earlier assignments as history.
 */
export function EmployeeDialog({
  open,
  options,
  suggestedCode,
  takenCodes,
  employee,
  emailLocked = false,
  onOpenChange,
  onSave,
  onUpdate,
}: {
  open: boolean;
  options: EmployeeOptions;
  suggestedCode: string;
  takenCodes: Set<string>;
  employee?: Employee;
  /** The signed-in admin changes their own email from their account, not here. */
  emailLocked?: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (input: NewEmployee) => Promise<void>;
  onUpdate?: (employee: Employee, changes: EmployeeChanges) => Promise<void>;
}) {
  const id = useId();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [email, setEmail] = useState('');
  const [departments, setDepartments] = useState<string[]>([]);
  const [designation, setDesignation] = useState('');
  const [roles, setRoles] = useState<string[]>([]);
  const [jurisdictions, setJurisdictions] = useState<string[]>([]);
  const [errors, setErrors] = useState<Errors>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Each opening starts blank, with sensible defaults: the next free code, the
  // plain EMPLOYEE role, and the whole area when there is a single top boundary.
  // An edit starts from the person as HRMS has them.
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open && employee) {
      const assignment = currentAssignment(employee);
      const offered = new Set(options.roles.map((role) => role.code));
      setCode(employee.code);
      setName(employee.user?.name ?? '');
      setMobile(employee.user?.mobileNumber ?? '');
      setEmail(employee.user?.emailId ?? '');
      setDepartments(assignment?.department ? [assignment.department] : []);
      setDesignation(assignment?.designation ?? '');
      setRoles(
        (employee.user?.roles ?? [])
          .filter((role) => offered.has(role.code) && (role.tenantId ?? employee.tenantId) === employee.tenantId)
          .map((role) => role.code),
      );
      setJurisdictions((employee.jurisdictions ?? []).filter((item) => item.isActive !== false).map((item) => item.boundary));
      setErrors({});
      setSaveError(null);
    } else if (open) {
      const tops = options.boundaries.filter((boundary) => boundary.depth === 0);
      setCode(suggestedCode);
      setName('');
      setMobile('');
      setEmail('');
      setDepartments([]);
      setDesignation('');
      setRoles(options.roles.some((role) => role.code === 'EMPLOYEE') ? ['EMPLOYEE'] : []);
      setJurisdictions(tops.length === 1 ? [tops[0].code] : []);
      setErrors({});
      setSaveError(null);
    }
  }

  const editing = !!employee;
  // The founder's own records stay off the lists, but an edit still shows a value they already hold.
  const held = useMemo(() => {
    const assignment = employee ? currentAssignment(employee) : undefined;
    return [assignment?.department, assignment?.designation];
  }, [employee]);
  const departmentChoices = useMemo(() => pickerChoices(options.departments, (choice) => choice.code, held), [options.departments, held]);
  const designationChoices = useMemo(() => pickerChoices(options.designations, (choice) => choice.code, held), [options.designations, held]);
  // Departments from earlier assignments: kept on the record, shown, not edited here.
  const pastDepartments = useMemo(() => {
    if (!employee) return [];
    const main = currentAssignment(employee)?.department;
    const names = new Map(options.departments.map((choice) => [choice.code, choice.name]));
    return Array.from(new Set((employee.assignments ?? []).map((assignment) => assignment.department)))
      .filter((code) => code && code !== main)
      .map((code) => names.get(code) ?? code);
  }, [employee, options.departments]);

  const boundaryDetail = useMemo(() => {
    const byCode = new Map(options.boundaries.map((boundary) => [boundary.code, boundary.boundaryType]));
    return (choice: Choice) => byCode.get(choice.code) ?? '';
  }, [options.boundaries]);

  const save = async () => {
    const next: Errors = {};
    if (!code.trim()) next.code = 'Enter an employee code.';
    else if (!editing && takenCodes.has(code.trim())) next.code = 'Another employee already has this code.';
    if (!name.trim()) next.name = 'Enter their full name.';
    if (!mobile.trim()) next.mobile = 'Enter their mobile number.';
    else if (!options.mobilePattern.test(mobile.trim())) next.mobile = 'That number doesn’t match this workspace’s mobile format.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) next.email = 'Enter a valid email to invite this employee.';
    if (!departments.length) next.departments = editing ? 'Choose a department.' : 'Choose at least one department.';
    if (!designation) next.designation = 'Choose a designation.';
    if (!jurisdictions.length) next.jurisdictions = 'Choose where they can act.';
    setErrors(next);
    if (Object.keys(next).length) return;

    setSaving(true);
    setSaveError(null);
    try {
      if (employee && onUpdate) {
        await onUpdate(employee, {
          name: name.trim(),
          mobileNumber: mobile.trim(),
          emailId: email.trim(),
          department: departments[0],
          designation,
          roles: roles.length ? roles : ['EMPLOYEE'],
          jurisdictions,
        });
        onOpenChange(false);
        return;
      }
      await onSave({
        code: code.trim(),
        name: name.trim(),
        mobileNumber: mobile.trim(),
        emailId: email.trim() || undefined,
        departments,
        designation,
        roles: roles.length ? roles : ['EMPLOYEE'],
        jurisdictions,
      });
      onOpenChange(false);
    } catch (err) {
      setSaveError(describeSaveError(err, editing ? 'Saving the changes failed. Try again.' : 'Adding the employee failed. Try again.'));
    } finally {
      setSaving(false);
    }
  };

  const field = (key: keyof Errors, label: string, input: ReactNode, optional = false) => (
    <div className="space-y-1.5">
      <label htmlFor={`${id}-${key}`} className="block text-sm font-medium text-foreground">
        {label}
        {optional && <span className="font-normal text-muted-foreground"> (optional)</span>}
      </label>
      {input}
      {errors[key] && <p className="text-xs text-destructive">{errors[key]}</p>}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${employee?.user?.name ?? 'employee'}` : 'Add an employee'}</DialogTitle>
          <DialogDescription>
            {editing
              ? 'Changes apply the next time they sign in. A new email is confirmed by a link sent to it.'
              : 'They sign in to the employee app with the details you give here.'}
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            {field(
              'code',
              'Employee code',
              <Input
                id={`${id}-code`}
                value={code}
                readOnly={editing}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
                className={`font-mono ${editing ? 'bg-muted text-muted-foreground' : ''}`}
              />,
            )}
            {field(
              'name',
              'Full name',
              <Input id={`${id}-name`} value={name} autoFocus placeholder="Anita Wanjiru" onChange={(event) => setName(event.target.value)} />,
            )}
            {field(
              'mobile',
              'Mobile number',
              <Input id={`${id}-mobile`} type="tel" inputMode="numeric" value={mobile} onChange={(event) => setMobile(event.target.value.replace(/\s+/g, ''))} />,
            )}
            {field(
              'email',
              'Email',
              <Input
                id={`${id}-email`}
                type="email"
                value={email}
                readOnly={editing && emailLocked}
                placeholder="anita@example.org"
                onChange={(event) => setEmail(event.target.value)}
                className={editing && emailLocked ? 'bg-muted text-muted-foreground' : undefined}
              />,
              true,
            )}
          </div>

          {editing ? (
            field(
              'departments',
              'Department',
              <>
                <Select value={departments[0] ?? ''} onValueChange={(code) => setDepartments([code])}>
                  <SelectTrigger id={`${id}-departments`} className="bg-card">
                    <SelectValue placeholder="Choose a department" />
                  </SelectTrigger>
                  <SelectContent>
                    {departmentChoices.map((choice) => (
                      <SelectItem key={choice.code} value={choice.code}>
                        {choice.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {pastDepartments.length > 0 && (
                  <p className="text-xs text-muted-foreground">Also on their record from before: {pastDepartments.join(', ')}.</p>
                )}
              </>,
            )
          ) : (
            <CheckList
              legend="Departments"
              hint="Choose one or more. The first is their main one."
              choices={departmentChoices}
              picked={departments}
              onChange={setDepartments}
              error={errors.departments}
              empty="Add departments first."
            />
          )}

          {field(
            'designation',
            'Designation',
            <Select value={designation} onValueChange={setDesignation}>
              <SelectTrigger id={`${id}-designation`} className="bg-card">
                <SelectValue placeholder="Choose a designation" />
              </SelectTrigger>
              <SelectContent>
                {designationChoices.map((choice) => (
                  <SelectItem key={choice.code} value={choice.code}>
                    {choice.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>,
          )}

          <CheckList
            legend="System roles"
            hint="What they can do. Employee is enough to sign in; complaint roles like GRO let them handle complaints."
            choices={options.roles}
            picked={roles}
            onChange={setRoles}
            empty="No roles are set up for this workspace."
          />

          <CheckList
            legend="Jurisdictions"
            hint="Where this person can act."
            choices={options.boundaries}
            picked={jurisdictions}
            onChange={setJurisdictions}
            error={errors.jurisdictions}
            empty="Set up your geography first."
            detail={boundaryDetail}
          />

          {saveError && (
            <Alert variant="destructive">
              <AlertDescription>{saveError}</AlertDescription>
            </Alert>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving} className="gap-2">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {editing ? 'Save changes' : 'Add employee'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
