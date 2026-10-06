import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, LayoutGrid, Network, Plus, Search } from 'lucide-react';
import { useApp } from '../../App';
import type { MdmsRecord } from '@/api/types';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DeleteConfirmDialog } from '@/components/ui/delete-confirm-dialog';
import { toast } from '@/hooks/use-toast';
import { StepHeader } from '../StepHeader';
import { EmptyState, OptionCard, StepActions } from '../StepParts';
import { adjacentSteps, stepById } from '../steps';
import { probeGate, useStepProbe } from '../stepProbe';
import { describeSaveError } from '../errors';
import { reportStepError, trackStepAction } from '../telemetry';
import { MasterDialog } from './MasterDialog';
import { BulkMastersUpload, type BulkImportSummary } from './BulkMastersUpload';
import {
  listMasters,
  recordDepartments,
  recordName,
  removeMaster,
  saveMaster,
  type MasterInput,
  type MasterKind,
} from './mastersApi';

const STEP = stepById('departments');
const { previous, next } = adjacentSteps('departments');

/** Past this many rows a list gets a search box. */
const SEARCH_FROM = 8;

function MasterSection({
  kind,
  records,
  departmentNames,
  onAdd,
  onUpload,
  onEdit,
  onRemove,
}: {
  kind: MasterKind;
  records: MdmsRecord[];
  departmentNames: Map<string, string>;
  onAdd: () => void;
  onUpload: () => void;
  onEdit: (record: MdmsRecord) => void;
  onRemove: (record: MdmsRecord) => Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const isDesignation = kind === 'designation';
  const title = isDesignation ? 'Designations' : 'Departments';
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return records;
    return records.filter((record) => `${recordName(record)} ${record.uniqueIdentifier}`.toLowerCase().includes(q));
  }, [records, query]);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-lg font-semibold text-foreground">{title}</h3>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{records.length}</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {records.length > SEARCH_FROM && (
            <div className="relative">
              <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={`Search ${title.toLowerCase()}`}
                aria-label={`Search ${title.toLowerCase()}`}
                className="h-9 w-48 pl-8 bg-card"
              />
            </div>
          )}
          <Button variant="ghost" size="sm" onClick={onUpload} className="h-9 text-primary hover:text-primary">
            Upload a file
          </Button>
          <Button size="sm" onClick={onAdd} className="h-9 gap-1.5">
            <Plus className="w-4 h-4" />
            {isDesignation ? 'Add designation' : 'Add department'}
          </Button>
        </div>
      </div>

      {records.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border bg-card px-4 py-5 text-sm text-muted-foreground">
          {isDesignation
            ? 'No designations yet. Every employee holds one, so add at least one.'
            : 'No departments yet. Complaints are routed to them, so add at least one.'}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs font-medium uppercase tracking-[0.5px] text-muted-foreground">
              <tr>
                <th scope="col" className="hidden sm:table-cell px-4 py-2.5 font-medium">Code</th>
                <th scope="col" className="px-4 py-2.5 font-medium">{isDesignation ? 'Designation' : 'Department'}</th>
                {isDesignation && <th scope="col" className="hidden md:table-cell px-4 py-2.5 font-medium">Departments</th>}
                <th scope="col" className="px-4 py-2.5">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((record) => {
                const name = recordName(record);
                const departments = recordDepartments(record).map((code) => departmentNames.get(code) ?? code);
                return (
                  <tr key={record.uniqueIdentifier} className="border-t border-border">
                    <td className="hidden sm:table-cell px-4 py-3 font-mono text-xs text-muted-foreground whitespace-nowrap">
                      {record.uniqueIdentifier}
                    </td>
                    {/* On a narrow screen the code, and a designation's departments,
                        sit under the name so the row's actions stay in view. */}
                    <td className="px-4 py-3">
                      <span className="block font-medium text-foreground">{name}</span>
                      <span className="block sm:hidden font-mono text-xs text-muted-foreground">{record.uniqueIdentifier}</span>
                      {isDesignation && departments.length > 0 && (
                        <span className="block md:hidden text-xs text-muted-foreground">{departments.join(', ')}</span>
                      )}
                    </td>
                    {isDesignation && (
                      <td className="hidden md:table-cell px-4 py-3 text-muted-foreground">{departments.length ? departments.join(', ') : '—'}</td>
                    )}
                    <td className="px-2 py-2 text-right whitespace-nowrap">
                      <Button variant="ghost" size="sm" onClick={() => onEdit(record)} aria-label={`Edit ${name}`}>
                        Edit
                      </Button>
                      <DeleteConfirmDialog
                        title={`Remove ${name}?`}
                        description={
                          isDesignation
                            ? `Employees won’t be able to hold ${name} after this.`
                            : `Complaints and employees won’t be able to use ${name} after this.`
                        }
                        onConfirm={() => onRemove(record)}
                        trigger={
                          <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" aria-label={`Remove ${name}`}>
                            Remove
                          </Button>
                        }
                      />
                    </td>
                  </tr>
                );
              })}
              {shown.length === 0 && (
                <tr className="border-t border-border">
                  <td colSpan={isDesignation ? 4 : 3} className="px-4 py-5 text-center text-sm text-muted-foreground">
                    Nothing matches “{query}”.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function importToast(summary: BulkImportSummary): string {
  const parts = [
    summary.departments.created && `${summary.departments.created} ${summary.departments.created === 1 ? 'department' : 'departments'}`,
    summary.designations.created && `${summary.designations.created} ${summary.designations.created === 1 ? 'designation' : 'designations'}`,
  ].filter(Boolean);
  return parts.length ? `Added ${parts.join(' and ')}` : 'Nothing new to add';
}

export default function DepartmentsStep() {
  const { state, completePhase } = useApp();
  const navigate = useNavigate();
  const tenant = state.targetTenant || state.tenant;
  const done = state.completedPhases.includes(STEP.number);

  const [departments, setDepartments] = useState<MdmsRecord[] | null>(null);
  const [designations, setDesignations] = useState<MdmsRecord[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [bulk, setBulk] = useState(false);
  const [dialog, setDialog] = useState<{ kind: MasterKind; record?: MdmsRecord } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Only the workspace's own records: this step edits and removes them.
    Promise.all([listMasters(tenant, 'department', { ownOnly: true }), listMasters(tenant, 'designation', { ownOnly: true })])
      .then(([loadedDepartments, loadedDesignations]) => {
        if (cancelled) return;
        setDepartments(loadedDepartments);
        setDesignations(loadedDesignations);
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

  const departmentNames = useMemo(
    () => new Map((departments ?? []).map((record) => [record.uniqueIdentifier, recordName(record)])),
    [departments],
  );
  const codes = (records: MdmsRecord[] | null) => new Set((records ?? []).map((record) => record.uniqueIdentifier));

  const save = async (kind: MasterKind, input: MasterInput, record?: MdmsRecord) => {
    try {
      await saveMaster(tenant, kind, input, record);
    } catch (err) {
      reportStepError('departments', record ? `update_${kind}` : `create_${kind}`, err, tenant);
      throw err;
    }
    trackStepAction('departments', record ? 'entity_update' : 'entity_create', kind, { tenant, source: 'form' });
    toast({ title: record ? `${input.name} updated` : `${input.name} added` });
    reload();
  };

  // The confirm dialog shows a thrown error and stays open, so the wording is set here.
  const remove = async (kind: MasterKind, record: MdmsRecord) => {
    try {
      await removeMaster(record);
    } catch (err) {
      reportStepError('departments', `delete_${kind}`, err, tenant);
      throw new Error(describeSaveError(err, 'Removing failed. Try again.'));
    }
    trackStepAction('departments', 'entity_delete', kind, { tenant });
    toast({ title: `${recordName(record)} removed` });
    reload();
  };

  const loaded = departments !== null && designations !== null;
  const empty = loaded && departments.length === 0 && designations.length === 0;
  const ready = loaded && departments.length > 0 && designations.length > 0;
  const { probe, recheck } = useStepProbe(
    state.tenant,
    'DEPARTMENTS',
    [...(departments ?? []), ...(designations ?? [])].map((record) => `${record.uniqueIdentifier}:${record.isActive !== false}`).join(','),
  );
  const gate = probeGate(
    'DEPARTMENTS',
    { ready: !!ready, hint: loaded && !ready ? 'Add at least one department and one designation to continue.' : undefined },
    probe,
  );

  return (
    <div className="space-y-8">
      <StepHeader eyebrow="Your organisation" title="Departments" done={done}>
        The departments complaints get routed to, and the designations your employees hold.
      </StepHeader>

      {loadError ? (
        <Alert variant="destructive">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>Couldn’t load your departments. {loadError}</span>
            <Button variant="outline" size="sm" onClick={reload}>
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      ) : !loaded ? (
        <div className="h-40 rounded-lg border border-dashed border-border bg-muted/40 animate-pulse" aria-busy="true" />
      ) : bulk ? (
        <BulkMastersUpload
          tenantId={tenant}
          existingDepartments={codes(departments)}
          existingDesignations={codes(designations)}
          onCancel={() => setBulk(false)}
          onDone={(summary) => {
            setBulk(false);
            for (const kind of ['department', 'designation'] as const) {
              const result = kind === 'department' ? summary.departments : summary.designations;
              trackStepAction('departments', 'entity_import', kind, {
                tenant,
                source: 'bulk',
                count: result.created,
                skipped: result.skipped,
                failed: result.failed.length,
              });
            }
            toast({ title: importToast(summary) });
            const failed = summary.departments.failed.length + summary.designations.failed.length;
            if (failed) setActionError(`${failed} couldn’t be added. ${summary.departments.failed[0]?.error ?? summary.designations.failed[0]?.error ?? ''}`);
            reload();
          }}
        />
      ) : empty ? (
        <div className="space-y-6">
          <EmptyState icon={Network} title="No departments yet">
            Departments are what complaints get routed to, and every employee belongs to one. Add them one at a time,
            or upload a list.
          </EmptyState>
          <section className="space-y-4">
            <h3 className="text-lg font-semibold text-foreground">How do you want to add your departments?</h3>
            <div className="grid max-w-xl grid-cols-1 gap-4 sm:grid-cols-2">
              <OptionCard icon={FileText} title="Create manually" action="Start adding" onClick={() => setDialog({ kind: 'department' })}>
                Name them one at a time.
              </OptionCard>
              <OptionCard icon={LayoutGrid} title="Bulk upload" action="Upload a file" onClick={() => setBulk(true)}>
                Upload a list and we will bring them in.
              </OptionCard>
            </div>
          </section>
        </div>
      ) : (
        <div className="space-y-8">
          {actionError && (
            <Alert variant="destructive">
              <AlertDescription>{actionError}</AlertDescription>
            </Alert>
          )}
          <MasterSection
            kind="department"
            records={departments}
            departmentNames={departmentNames}
            onAdd={() => setDialog({ kind: 'department' })}
            onUpload={() => setBulk(true)}
            onEdit={(record) => setDialog({ kind: 'department', record })}
            onRemove={(record) => remove('department', record)}
          />
          <MasterSection
            kind="designation"
            records={designations}
            departmentNames={departmentNames}
            onAdd={() => setDialog({ kind: 'designation' })}
            onUpload={() => setBulk(true)}
            onEdit={(record) => setDialog({ kind: 'designation', record })}
            onRemove={(record) => remove('designation', record)}
          />
        </div>
      )}

      {!bulk && (
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
      )}

      <MasterDialog
        kind={dialog?.kind ?? 'department'}
        open={!!dialog}
        record={dialog?.record}
        departments={departments ?? []}
        takenCodes={codes(dialog?.kind === 'designation' ? designations : departments)}
        onOpenChange={(open) => !open && setDialog(null)}
        onSave={(input) => save(dialog?.kind ?? 'department', input, dialog?.record)}
      />
    </div>
  );
}
