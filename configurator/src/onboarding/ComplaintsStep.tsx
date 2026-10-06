import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, LayoutGrid, ListTree, MessageSquareText, Plus, UserRoundX } from 'lucide-react';
import { useApp } from '../App';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DigitCard } from '@/components/digit/DigitCard';
import { ComplaintHierarchySetup } from '@/components/ComplaintHierarchySetup';
import { toast } from '@/hooks/use-toast';
import type { Employee } from '@/api/types';
import { StepHeader } from './StepHeader';
import { EmptyState, OptionCard, StepActions } from './StepParts';
import { adjacentSteps, stepById } from './steps';
import { describeSaveError } from './errors';
import { reportStepError, trackStepAction } from './telemetry';
import { listMasters, recordName } from './departments/mastersApi';
import { TypeDialog } from './complaints/TypeDialog';
import { departmentsWithoutGro } from './complaints/groCoverage';
import { listEmployees } from './employees/employeesApi';
import { pickerChoices } from '@/lib/systemRecords';
import {
  loadComplaints,
  rowsFingerprint,
  saveComplaints,
  subtypeCount,
  DEFAULT_SLA_HOURS,
  type ComplaintDraft,
  type DraftType,
  type LoadedComplaints,
} from './complaints/complaintsApi';

const STEP = stepById('complaints');
const EMPLOYEES_STEP = stepById('employees');
const { previous } = adjacentSteps('complaints');

const RESOLUTION_CHOICES = [
  { hours: 24, label: '1 day' },
  { hours: 72, label: '3 days' },
  { hours: 168, label: '1 week' },
  { hours: 336, label: '2 weeks' },
];

/**
 * Unsaved work survives a reload, per workspace, until it is saved or
 * discarded. It keeps a fingerprint of the server rows it was made against,
 * so a draft outlived by someone else's changes is dropped, not saved over them.
 */
interface StoredDraft {
  draft: ComplaintDraft;
  basis: string;
}
const draftKey = (tenant: string) => `ccrs-complaints-draft:${tenant}`;
function readDraft(tenant: string): StoredDraft | null {
  try {
    const raw = window.localStorage.getItem(draftKey(tenant));
    const stored = raw ? (JSON.parse(raw) as Partial<StoredDraft>) : null;
    return stored?.draft && typeof stored.basis === 'string' ? (stored as StoredDraft) : null;
  } catch {
    return null;
  }
}
function writeDraft(tenant: string, stored: StoredDraft | null) {
  try {
    if (stored) window.localStorage.setItem(draftKey(tenant), JSON.stringify(stored));
    else window.localStorage.removeItem(draftKey(tenant));
  } catch {
    // Storage unavailable: the draft just lives as long as the page.
  }
}

/**
 * The last step: complaint types from scratch (or from a spreadsheet), the
 * department that handles each, and how long they should take. Finishing it
 * finishes onboarding, and the account moves on to management for good.
 */
export default function ComplaintsStep() {
  const { state, completePhase, setMode } = useApp();
  const navigate = useNavigate();
  const tenant = state.targetTenant || state.tenant;
  const done = state.completedPhases.includes(STEP.number);

  const [loaded, setLoaded] = useState<LoadedComplaints | null>(null);
  const [departments, setDepartments] = useState<{ code: string; name: string }[]>([]);
  // null until read, or when HRMS can't be read: the server still checks on finish.
  const [employees, setEmployees] = useState<Employee[] | null>(null);
  const [draft, setDraft] = useState<ComplaintDraft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [bulk, setBulk] = useState(false);
  const [editing, setEditing] = useState<{ index: number | null } | null>(null);
  const [customHours, setCustomHours] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      loadComplaints(tenant),
      listMasters(tenant, 'department'),
      listEmployees(tenant).then((list) => list.active).catch(() => null),
    ])
      .then(([result, departmentRecords, employeeRecords]) => {
        if (cancelled) return;
        setLoaded(result);
        setDepartments(departmentRecords.map((record) => ({ code: record.uniqueIdentifier, name: recordName(record) })));
        setEmployees(employeeRecords);
        const basis = result.editable ? rowsFingerprint(result.records) : '';
        const saved = result.editable ? readDraft(tenant) : null;
        const stored = saved && saved.basis === basis ? saved.draft : null;
        if (saved && !stored) {
          writeDraft(tenant, null);
          toast({
            title: 'Unsaved changes dropped',
            description: 'The complaint categories were changed somewhere else since, so you’re seeing the saved version.',
          });
        }
        setDraft(result.editable ? stored ?? result.draft : null);
        setDirty(!!stored);
        setLoadError(null);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [tenant, reloadKey]);

  const reload = () => setReloadKey((key) => key + 1);

  const change = (next: ComplaintDraft) => {
    setDraft(next);
    setDirty(true);
    if (loaded?.editable) writeDraft(tenant, { draft: next, basis: rowsFingerprint(loaded.records) });
  };

  const departmentName = useMemo(() => new Map(departments.map((choice) => [choice.code, choice.name])), [departments]);

  const routedDepartments = !loaded ? [] : loaded.editable ? (draft?.types ?? []).map((type) => type.department) : loaded.departments;
  const withoutGro = employees ? departmentsWithoutGro(routedDepartments, employees, tenant) : [];
  const groHint = withoutGro.length > 0 ? 'Each department needs a GRO before you can finish.' : undefined;
  const groNotice = withoutGro.length > 0 && (
    <Alert>
      <UserRoundX className="h-4 w-4" />
      <AlertDescription className="space-y-3">
        <p>
          No one can assign complaints for{' '}
          <span className="font-medium text-foreground">{withoutGro.map((code) => departmentName.get(code) ?? code).join(', ')}</span>.
          Every department a complaint category goes to needs at least one employee with the GRO role. A DGRO doesn’t count.
        </p>
        <Button variant="outline" size="sm" onClick={() => navigate(EMPLOYEES_STEP.path)}>
          Add a GRO in Employees
        </Button>
      </AlertDescription>
    </Alert>
  );

  const finish = async () => {
    if (!await completePhase(STEP.number)) return;
    setMode('management');
    navigate('/manage');
  };

  const save = async () => {
    if (!loaded?.editable || !draft) return;
    setSaving(true);
    setSaveError(null);
    try {
      const filable = await saveComplaints(tenant, loaded, draft);
      trackStepAction('complaints', 'entity_update', 'complaint_type', {
        tenant,
        source: 'form',
        count: draft.types.length,
        subtypes: draft.types.reduce((total, type) => total + type.subtypes.length, 0),
        filable,
        slaHours: draft.slaHours,
      });
      writeDraft(tenant, null);
      toast({ title: `${filable} complaint ${filable === 1 ? 'category is' : 'categories are'} ready` });
      await finish();
    } catch (err) {
      reportStepError('complaints', 'save', err, tenant);
      setSaveError(describeSaveError(err, 'Saving your complaint categories failed. Try again.'));
    } finally {
      setSaving(false);
    }
  };

  const header = (title = 'Complaints Template', text = 'Set up the kinds of complaints people can raise, which department handles each, and how long they should take to resolve.') => (
    <StepHeader eyebrow="Complaints" title={title} done={done}>
      {text}
    </StepHeader>
  );

  if (loadError) {
    return (
      <div className="space-y-8">
        {header()}
        <Alert variant="destructive">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>Couldn’t load your complaint categories. {loadError}</span>
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
        {header()}
        <div className="h-40 rounded-lg border border-dashed border-border bg-muted/40 animate-pulse" aria-busy="true" />
      </div>
    );
  }

  if (bulk) {
    return (
      <div className="space-y-6">
        {header('Upload complaint categories', 'Define your levels, fill the template with your complaint categories, and upload it.')}
        <DigitCard>
          <ComplaintHierarchySetup
            targetTenant={tenant}
            stateTenant={state.tenant}
            onError={(message) => {
              reportStepError('complaints', 'import_bulk', new Error(message), tenant);
              setSaveError(message);
            }}
            onDone={({ defs }) => {
              trackStepAction('complaints', 'entity_import', 'complaint_type', { tenant, source: 'bulk', count: defs });
              setBulk(false);
              writeDraft(tenant, null);
              toast({ title: `${defs} complaint ${defs === 1 ? 'subcategory' : 'subcategories'} imported` });
              reload();
            }}
          />
        </DigitCard>
        <Button variant="ghost" onClick={() => setBulk(false)}>
          Cancel
        </Button>
      </div>
    );
  }

  // Set up from a spreadsheet with its own levels: shown here, changed in management.
  if (!loaded.editable) {
    return (
      <div className="space-y-8">
        {header()}
        <div className="flex items-start gap-3 rounded-lg border border-border bg-card p-4">
          <div className="w-10 h-10 rounded-md bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
            <ListTree className="w-5 h-5" />
          </div>
          <div className="text-sm">
            <p className="font-medium text-foreground">
              {loaded.leafCount} complaint {loaded.leafCount === 1 ? 'subcategory' : 'subcategories'} set up from a spreadsheet
            </p>
            <p className="mt-1 text-muted-foreground">
              Levels: {loaded.levels.join(' → ')}. You can change them in management once setup is finished.
            </p>
          </div>
        </div>
        {groNotice}
        <StepActions
          onBack={previous ? () => navigate(previous.path) : undefined}
          onContinue={finish}
          continueLabel="Finish setup"
          disabled={loaded.leafCount === 0 || withoutGro.length > 0}
          hint={groHint}
        />
      </div>
    );
  }

  const current: ComplaintDraft = draft ?? { types: [], slaHours: DEFAULT_SLA_HOURS };
  const { types, slaHours } = current;
  const presetHours = RESOLUTION_CHOICES.some((choice) => choice.hours === slaHours);
  const editingType = editing?.index != null ? types[editing.index] : undefined;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        {header()}
        {dirty && <span className="rounded-full border border-border px-2 py-0.5 text-xs font-medium text-muted-foreground">Unsaved</span>}
      </div>

      {types.length === 0 ? (
        <div className="space-y-6">
          <EmptyState icon={MessageSquareText} title="No complaint categories yet">
            A complaint category is what someone picks when reporting: a pothole, a broken street light. Add the first
            one to get going.
          </EmptyState>
          <section className="space-y-4">
            <h3 className="text-lg font-semibold text-foreground">How do you want to add your complaint categories?</h3>
            <div className="grid max-w-xl grid-cols-1 gap-4 sm:grid-cols-2">
              <OptionCard icon={FileText} title="Start from scratch" action="Start adding" onClick={() => setEditing({ index: null })}>
                Name each category and its subcategories yourself.
              </OptionCard>
              <OptionCard icon={LayoutGrid} title="Bulk upload" action="Upload a file" onClick={() => setBulk(true)}>
                Upload a list and we will bring them in.
              </OptionCard>
            </div>
          </section>
        </div>
      ) : (
        <>
          <div className="grid max-w-2xl grid-cols-2 gap-4">
            {[
              { label: 'Complaint categories', value: types.length },
              { label: 'Complaint subcategories', value: subtypeCount(current) },
            ].map((stat) => (
              <div key={stat.label} className="rounded-lg border border-border bg-card p-4">
                <p className="text-sm text-muted-foreground">{stat.label}</p>
                <p className="mt-1 text-3xl font-semibold text-foreground">{stat.value}</p>
              </div>
            ))}
          </div>

          <section className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-semibold text-foreground">Complaint categories</h3>
              <div className="ml-auto">
                <Button size="sm" onClick={() => setEditing({ index: null })} className="h-9 gap-1.5">
                  <Plus className="w-4 h-4" />
                  Add complaint category
                </Button>
              </div>
            </div>
            <ul className="space-y-3">
              {types.map((type, index) => (
                <li key={type.code ?? type.name} className="rounded-lg border border-border bg-card p-4">
                  <div className="flex flex-wrap items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-foreground">{type.name}</p>
                      <p className="text-sm text-muted-foreground">
                        Handled by {departmentName.get(type.department) ?? type.department}
                      </p>
                    </div>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setEditing({ index })} aria-label={`Edit ${type.name}`}>
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        aria-label={`Remove ${type.name}`}
                        onClick={() => change({ ...current, types: types.filter((_, i) => i !== index) })}
                      >
                        Remove
                      </Button>
                    </div>
                  </div>
                  {type.subtypes.length > 0 ? (
                    <ul className="mt-3 flex flex-wrap gap-2">
                      {type.subtypes.map((sub) => (
                        <li key={sub.code ?? sub.name} className="rounded-full bg-muted px-2.5 py-1 text-xs text-foreground">
                          {sub.name}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-xs text-muted-foreground">No subcategories: people report this category as it is.</p>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <fieldset className="space-y-3">
            <legend className="text-lg font-semibold text-foreground">How much time should a complaint have to be resolved?</legend>
            <p className="text-sm text-muted-foreground">
              This is your own target, not a legal SLA. Complaints past it show as overdue. It applies to every category.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {RESOLUTION_CHOICES.map((choice) => {
                const selected = slaHours === choice.hours;
                return (
                  <button
                    key={choice.hours}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => {
                      setCustomHours('');
                      change({ ...current, slaHours: choice.hours });
                    }}
                    className={`h-9 rounded-full border px-4 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      selected ? 'border-primary bg-primary/10 text-primary font-medium' : 'border-border bg-card text-foreground hover:border-primary/50'
                    }`}
                  >
                    {choice.label}
                  </button>
                );
              })}
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                or
                <Input
                  type="number"
                  min={1}
                  inputMode="numeric"
                  aria-label="Custom resolution time in hours"
                  placeholder="Hours"
                  value={presetHours ? customHours : customHours || String(slaHours)}
                  onChange={(event) => {
                    setCustomHours(event.target.value);
                    const hours = Math.round(Number(event.target.value));
                    if (hours > 0) change({ ...current, slaHours: hours });
                  }}
                  className={`h-9 w-24 bg-card ${presetHours ? '' : 'border-primary'}`}
                />
                hours
              </label>
            </div>
          </fieldset>
        </>
      )}

      {saveError && (
        <Alert variant="destructive">
          <AlertDescription>{saveError}</AlertDescription>
        </Alert>
      )}

      {groNotice}

      <div className="flex flex-wrap items-center gap-3">
        <StepActions
          onBack={previous ? () => navigate(previous.path) : undefined}
          onContinue={save}
          continueLabel="Finish setup"
          busy={saving}
          disabled={types.length === 0 || withoutGro.length > 0}
          hint={types.length === 0 ? 'Add at least one complaint category to finish.' : groHint}
        />
        {dirty && loaded.draft.types.length > 0 && (
          <Button
            variant="ghost"
            className="text-muted-foreground"
            onClick={() => {
              writeDraft(tenant, null);
              setDraft(loaded.draft);
              setDirty(false);
            }}
          >
            Discard changes
          </Button>
        )}
      </div>

      <TypeDialog
        open={!!editing}
        type={editingType}
        departments={pickerChoices(departments, (choice) => choice.code, editingType ? [editingType.department] : [])}
        takenNames={types.filter((_, i) => i !== editing?.index).map((type) => type.name)}
        onOpenChange={(open) => !open && setEditing(null)}
        onSave={(type: DraftType) => {
          const next = editing?.index != null ? types.map((existing, i) => (i === editing.index ? type : existing)) : [...types, type];
          change({ ...current, types: next });
        }}
      />
    </div>
  );
}
