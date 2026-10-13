import { useGetList } from 'ra-core';
import { Link } from 'react-router-dom';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { DigitCard } from '@/components/digit/DigitCard';
import { useMastersCapability } from '@/hooks/useMastersCapability';
import { isOnboardingComplete, resumePath } from '@/onboarding/progress';
import { useApp } from '../App';
import { MASTER_SCREEN_META } from './masterScreens';
import { attentionItems } from './needsAttention';

const ALL = { pagination: { page: 1, perPage: 1000 }, sort: { field: 'id', order: 'ASC' as const }, filter: {} };
const COUNT = { pagination: { page: 1, perPage: 1 }, sort: { field: 'id', order: 'ASC' as const }, filter: {} };

/** ours (cfgreview F28, #1574): a short "needs attention" list under the dashboard counts, each item linking to its fix. */
export function NeedsAttention() {
  const { state } = useApp();
  const { canViewResource } = useMastersCapability();
  const cats = useGetList('complaint-hierarchy', ALL, { enabled: canViewResource('complaint-hierarchy') });
  const emps = useGetList('employees', ALL, { enabled: canViewResource('employees') });
  const tActive = useGetList('tenants', COUNT, { enabled: canViewResource('tenants') });
  const tListed = useGetList('tenants', { ...COUNT, meta: MASTER_SCREEN_META }, { enabled: canViewResource('tenants') });
  const loading = cats.isPending || emps.isPending;
  const items = attentionItems({
    categories: cats.data as Record<string, unknown>[] | undefined,
    employees: emps.data as Record<string, unknown>[] | undefined,
    tenantsListed: tListed.total,
    tenantsActive: tActive.total,
  });
  const setupDone = isOnboardingComplete(state.completedPhases);

  return (
    <section aria-labelledby="needs-attention-title" data-testid="needs-attention">
      <h2 id="needs-attention-title" className="mb-3 text-lg font-semibold">Needs attention at {state.tenant}</h2>
      <DigitCard className="p-4">
        {!setupDone && (
          <p className="mb-2 text-sm">
            Setup is not finished. <Link className="underline" to={resumePath(state.completedPhases)}>Continue setup</Link>
          </p>
        )}
        {loading ? <p className="text-sm text-muted-foreground">Checking...</p>
          : items.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground"><CheckCircle2 className="h-4 w-4 text-green-600" aria-hidden="true" />Nothing needs attention.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {items.map((i) => (
                <li key={i.id} className="flex items-start gap-2 text-sm" data-testid={`attention-${i.id}`}>
                  <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" aria-hidden="true" />
                  <span>{i.text}. <Link className="underline" to={i.to}>Open</Link></span>
                </li>
              ))}
            </ul>
          )}
      </DigitCard>
    </section>
  );
}
