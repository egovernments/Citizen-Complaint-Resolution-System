import { useEffect, useState } from 'react';
import { useDataProvider } from 'ra-core';
import { useWatch } from 'react-hook-form';
import { AlertTriangle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

export interface DependencyProbe {
  /** Human label shown in the banner ("Employees using this department"). */
  label: string;
  /** react-admin resource name to probe. */
  resource: string;
  /** Filter applied to getList — typically `{ [target]: currentValue }`. */
  filter: Record<string, unknown>;
}

export interface DeactivationGuardProps {
  /** Form path holding the active/inactive flag. Defaults to `active`. */
  source?: string;
  /** Probes fired when the flag flips to inactive. */
  probes: DependencyProbe[];
}

interface ProbeResult {
  label: string;
  count: number;
}

/** Renders a warning banner listing dependent records when the form's
 *  `active` flag is unchecked. Does not block save — operators can still
 *  proceed; the guard is purely informational so dept / desig deactivations
 *  don't silently orphan downstream references. */
export function DeactivationGuard({ source = 'active', probes }: DeactivationGuardProps) {
  const active = useWatch({ name: source });
  const dataProvider = useDataProvider();
  const [results, setResults] = useState<ProbeResult[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (active !== false) {
      setResults(null);
      return;
    }
    let cancelled = false;
    async function run() {
      setLoading(true);
      try {
        const out = await Promise.all(
          probes.map(async (p): Promise<ProbeResult> => {
            try {
              const { total } = await dataProvider.getList(p.resource, {
                pagination: { page: 1, perPage: 1 },
                sort: { field: 'id', order: 'ASC' },
                filter: p.filter,
              });
              return { label: p.label, count: total ?? 0 };
            } catch {
              return { label: p.label, count: 0 };
            }
          }),
        );
        if (!cancelled) setResults(out);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [active, dataProvider, probes]);

  if (active !== false) return null;
  const hasDeps = results !== null && results.some((r) => r.count > 0);

  return (
    <Alert variant="warning" className="my-3">
      <AlertTriangle className="h-4 w-4" />
      <AlertDescription>
        <p className="font-medium">Deactivating this record</p>
        {loading ? (
          <p className="text-sm mt-0.5 text-muted-foreground">Checking dependencies…</p>
        ) : hasDeps ? (
          <>
            <p className="text-sm mt-0.5">
              Save will flip this record to inactive. These dependencies may be affected:
            </p>
            <ul className="list-disc list-inside text-sm mt-1 space-y-0.5">
              {results!
                .filter((r) => r.count > 0)
                .map((r) => (
                  <li key={r.label}>
                    <span className="font-medium">{r.count}</span> {r.label}
                  </li>
                ))}
            </ul>
          </>
        ) : (
          <p className="text-sm mt-0.5">
            No dependencies found. Safe to deactivate.
          </p>
        )}
      </AlertDescription>
    </Alert>
  );
}
