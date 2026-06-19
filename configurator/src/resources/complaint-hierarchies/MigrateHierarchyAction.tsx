import { useMemo, useState } from 'react';
import { useListContext } from 'ra-core';
import { GitMerge, Loader2, Check, X, AlertTriangle, Circle, MinusCircle, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  MIGRATION_STEPS,
  runComplaintHierarchyMigration,
  resolveMigrationTenants,
  type MigrationStepStatus,
  type MigrationResult,
} from '@/api/services/hierarchyMigration';

interface StepState {
  key: string;
  label: string;
  status: MigrationStepStatus;
  detail?: string;
}

const initialSteps = (): StepState[] =>
  MIGRATION_STEPS.map((s) => ({ ...s, status: 'pending' as MigrationStepStatus }));

function StepIcon({ status }: { status: MigrationStepStatus }) {
  switch (status) {
    case 'running':
      return <Loader2 className="w-4 h-4 text-primary animate-spin" />;
    case 'done':
      return <Check className="w-4 h-4 text-green-600" />;
    case 'error':
      return <X className="w-4 h-4 text-destructive" />;
    case 'skipped':
      return <MinusCircle className="w-4 h-4 text-muted-foreground" />;
    default:
      return <Circle className="w-3.5 h-3.5 text-muted-foreground/50" />;
  }
}

/**
 * "Migrate 2-level → hierarchy" action for the Complaint Hierarchies list.
 *
 * Visible only while the tenant has NO hierarchy definition yet (useListContext
 * total === 0). Clicking opens a popup that runs the additive migration
 * (docs/migration/complaint-type-2level-to-Nlevel.md) and shows each step's live
 * status. On success it refetches the list — a definition now exists, so the
 * button hides itself, matching "once done, hide the button".
 */
export function MigrateHierarchyAction() {
  const { total, refetch } = useListContext();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'running' | 'success' | 'failed'>('idle');
  const [steps, setSteps] = useState<StepState[]>(initialSteps);
  const [result, setResult] = useState<MigrationResult | null>(null);

  const tenants = useMemo(() => resolveMigrationTenants(), []);

  // Hide once a hierarchy definition exists (or while the count is still loading).
  if (total !== 0) return null;

  const setStep = (key: string, status: MigrationStepStatus, detail?: string) =>
    setSteps((prev) =>
      prev.map((s) => (s.key === key ? { ...s, status, detail: detail ?? s.detail } : s))
    );

  const start = async () => {
    setPhase('running');
    setResult(null);
    setSteps(initialSteps());
    try {
      const res = await runComplaintHierarchyMigration({ onStep: setStep });
      setResult(res);
      setPhase(res.ok ? 'success' : 'failed');
    } catch (e) {
      setResult({
        ok: false,
        serviceDefs: 0,
        categories: 0,
        tenants: tenants.targets,
        message: e instanceof Error ? e.message : 'Migration failed unexpectedly.',
      });
      setPhase('failed');
    }
  };

  const close = () => {
    setOpen(false);
    // If we just migrated, pull the fresh list so this button hides itself.
    if (phase === 'success') refetch();
    // Reset for a potential re-open (e.g. failure → retry path).
    setTimeout(() => {
      setPhase('idle');
      setSteps(initialSteps());
      setResult(null);
    }, 200);
  };

  return (
    <>
      <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setOpen(true)}>
        <GitMerge className="w-4 h-4" />
        Migrate from 2-level
      </Button>

      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <GitMerge className="w-5 h-5 text-primary" />
              Migrate 2-level complaint types → hierarchy
            </DialogTitle>
            <DialogDescription className="text-xs sm:text-sm">
              Converts your existing <span className="font-medium">Category → Sub-Type</span> complaint
              types into the configurable hierarchy model and switches this tenant's citizen, employee
              and configurator pickers to the cascade. Additive &amp; reversible — your complaint types
              are not modified.
            </DialogDescription>
          </DialogHeader>

          {/* Target tenants */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Target:</span>
            {tenants.targets.map((t) => (
              <code key={t} className="px-1.5 py-0.5 rounded bg-muted text-foreground font-mono">{t}</code>
            ))}
          </div>

          {/* Step checklist */}
          <ol className="space-y-2 my-1">
            {steps.map((s) => (
              <li key={s.key} className="flex items-start gap-3">
                <span className="mt-0.5 flex-shrink-0">
                  <StepIcon status={s.status} />
                </span>
                <div className="min-w-0">
                  <p
                    className={
                      'text-sm leading-tight ' +
                      (s.status === 'pending' || s.status === 'skipped'
                        ? 'text-muted-foreground'
                        : 'text-foreground')
                    }
                  >
                    {s.label}
                    {s.status === 'skipped' && <span className="ml-2 text-xs">(skipped)</span>}
                  </p>
                  {s.detail && <p className="text-xs text-muted-foreground font-mono truncate">{s.detail}</p>}
                </div>
              </li>
            ))}
          </ol>

          {/* Result banner */}
          {phase === 'success' && result && (
            <Alert variant="success">
              <Check className="w-4 h-4" />
              <AlertDescription className="text-sm">
                Migrated <span className="font-medium">{result.categories}</span> categor
                {result.categories === 1 ? 'y' : 'ies'} from{' '}
                <span className="font-medium">{result.serviceDefs}</span> complaint type
                {result.serviceDefs === 1 ? '' : 's'}. The cascade is now live for this tenant.
              </AlertDescription>
            </Alert>
          )}
          {phase === 'failed' && result?.message && (
            <Alert variant={result.serviceDefs === 0 ? 'warning' : 'destructive'}>
              <AlertTriangle className="w-4 h-4" />
              <AlertDescription className="text-sm">{result.message}</AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            {phase === 'idle' && (
              <>
                <Button variant="ghost" size="sm" onClick={close}>Cancel</Button>
                <Button size="sm" className="gap-1.5" onClick={start}>
                  Start migration <ArrowRight className="w-4 h-4" />
                </Button>
              </>
            )}
            {phase === 'running' && (
              <Button size="sm" disabled className="gap-1.5">
                <Loader2 className="w-4 h-4 animate-spin" /> Migrating…
              </Button>
            )}
            {phase === 'success' && (
              <Button size="sm" onClick={close}>Done</Button>
            )}
            {phase === 'failed' && (
              <>
                <Button variant="ghost" size="sm" onClick={close}>Close</Button>
                {result?.serviceDefs !== 0 && (
                  <Button size="sm" className="gap-1.5" onClick={start}>
                    <ArrowRight className="w-4 h-4" /> Retry
                  </Button>
                )}
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
