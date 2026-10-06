import { useCallback, useEffect, useState } from 'react';
import { searchWorkspace, type WorkspaceStep } from '@/identity/workspace';
import { stepRequirement } from './errors';

/**
 * The server's check for one setup step (Probes[step] from workspaces/_search),
 * read again whenever the step's data changes. The server refuses DONE unless
 * this passes, so Continue waits for it.
 *
 * `null` means the check couldn't run (a dependency was down) and is never
 * read as passing. A legacy workspace has no probes and isn't gated.
 */
export type StepProbe = { status: 'checking' } | { status: 'known'; passed: boolean | null; legacy: boolean };

export function useStepProbe(tenant: string, step: WorkspaceStep, dataKey: string) {
  const [attempt, setAttempt] = useState(0);
  // A result answers one request; until the latest one returns, the step is "checking".
  const request = `${tenant}|${step}|${dataKey}|${attempt}`;
  const [result, setResult] = useState<{ request: string; probe: StepProbe } | null>(null);

  useEffect(() => {
    let cancelled = false;
    searchWorkspace(tenant)
      .then((view) => {
        const probe: StepProbe = { status: 'known', passed: view.Probes?.[step] ?? null, legacy: !!view.Workspace?.legacy };
        if (!cancelled) setResult({ request, probe });
      })
      .catch(() => {
        if (!cancelled) setResult({ request, probe: { status: 'known', passed: null, legacy: false } });
      });
    return () => {
      cancelled = true;
    };
  }, [request, tenant, step]);

  const recheck = useCallback(() => setAttempt((n) => n + 1), []);
  const probe: StepProbe = result?.request === request ? result.probe : { status: 'checking' };
  return { probe, recheck };
}

/** Continue's state for a step: its own check first, then the server's. */
export function probeGate(
  step: WorkspaceStep,
  local: { ready: boolean; hint?: string },
  probe: StepProbe,
): { disabled: boolean; hint?: string; canRecheck: boolean } {
  if (!local.ready) return { disabled: true, hint: local.hint, canRecheck: false };
  if (probe.status === 'checking') return { disabled: true, hint: 'Checking this step…', canRecheck: false };
  if (probe.legacy || probe.passed === true) return { disabled: false, canRecheck: false };
  if (probe.passed === false) {
    return { disabled: true, hint: `Not complete yet. ${stepRequirement(step) ?? ''}`.trim(), canRecheck: true };
  }
  return { disabled: true, hint: 'Couldn’t check this step just now.', canRecheck: true };
}
