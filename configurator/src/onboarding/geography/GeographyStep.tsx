import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, LayoutGrid, MapPin } from 'lucide-react';
import { useApp } from '../../App';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { boundaryService } from '@/api';
import { toast } from '@/hooks/use-toast';
import { StepHeader } from '../StepHeader';
import { EmptyState, OptionCard, StepActions } from '../StepParts';
import { adjacentSteps, stepById } from '../steps';
import { probeGate, useStepProbe } from '../stepProbe';
import { useTurbopassSources } from '@/hooks/useTurbopassSources';
import { TURBOPASS_UNAVAILABLE_MESSAGE } from '@/utils/turbopassSuggestions';
import BoundaryImport, { type BoundarySource } from './BoundaryImport';

const STEP = stepById('geography');
const { previous, next } = adjacentSteps('geography');

interface HierarchySummary {
  hierarchyType: string;
  levels: string[];
  counts: Record<string, number>;
  total: number;
}

async function loadHierarchies(tenant: string): Promise<HierarchySummary[]> {
  const hierarchies = await boundaryService.getHierarchies(tenant);
  return Promise.all(
    hierarchies.map(async (hierarchy) => {
      const boundaries = await boundaryService
        .searchBoundaries(tenant, { hierarchyType: hierarchy.hierarchyType })
        .catch(() => []);
      const counts: Record<string, number> = {};
      for (const boundary of boundaries) counts[boundary.boundaryType] = (counts[boundary.boundaryType] ?? 0) + 1;
      return {
        hierarchyType: hierarchy.hierarchyType,
        levels: (hierarchy.boundaryHierarchy ?? []).map((level) => level.boundaryType),
        counts,
        total: boundaries.length,
      };
    }),
  );
}

function plural(word: string): string {
  if (/[^aeiou]y$/.test(word)) return word.slice(0, -1) + 'ies';
  if (/(s|x|ch|sh)$/.test(word)) return word + 'es';
  return word + 's';
}

/** "3 districts · 12 wards", in level order. */
function summaryLine(hierarchy: HierarchySummary): string {
  const parts = hierarchy.levels
    .filter((level) => hierarchy.counts[level])
    .map((level) => {
      const count = hierarchy.counts[level];
      const word = level.toLowerCase();
      return `${count} ${count === 1 ? word : plural(word)}`;
    });
  return parts.length ? parts.join(' · ') : 'Nothing in it yet';
}

export default function GeographyStep() {
  const { state, completePhase } = useApp();
  const navigate = useNavigate();
  // Boundaries live at the workspace tenant, which every later step reads them from.
  const tenant = state.targetTenant || state.tenant;
  const done = state.completedPhases.includes(STEP.number);

  const [source, setSource] = useState<BoundarySource | null>(null);
  const [hierarchies, setHierarchies] = useState<HierarchySummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  // Fetching boundaries needs the turbopass service; say so up front when it's missing.
  const boundarySources = useTurbopassSources();

  useEffect(() => {
    let cancelled = false;
    loadHierarchies(tenant)
      .then((loaded) => {
        if (cancelled) return;
        setHierarchies(loaded);
        setLoadError(null);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [tenant, reloadKey]);

  const reload = () => {
    setHierarchies(null);
    setReloadKey((key) => key + 1);
  };

  const hasBoundaries = !!hierarchies?.some((hierarchy) => hierarchy.total > 0);
  const { probe, recheck } = useStepProbe(
    state.tenant,
    'GEOGRAPHY',
    (hierarchies ?? []).map((hierarchy) => `${hierarchy.hierarchyType}:${hierarchy.total}`).join(','),
  );
  const gate = probeGate(
    'GEOGRAPHY',
    { ready: hasBoundaries, hint: hierarchies && !hasBoundaries ? 'Bring in a boundary hierarchy to continue.' : undefined },
    probe,
  );

  if (source) {
    return (
      <div className="space-y-6">
        <StepHeader eyebrow="Geography" title={source === 'osm' ? 'Fetch boundaries' : 'Upload from Excel'} done={done}>
          {source === 'osm'
            ? 'Search for your area and pick which administrative levels become your boundary hierarchy.'
            : 'Define your levels, fill the template with your areas, and upload it.'}
        </StepHeader>
        <BoundaryImport
          source={source}
          hasHierarchies={!!hierarchies?.length}
          sourceChoices={boundarySources}
          onCancel={() => setSource(null)}
          onDone={() => {
            setSource(null);
            reload();
            toast({ title: 'Boundaries imported' });
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <StepHeader eyebrow="Your organisation" title="Geography" done={done}>
        The boundary hierarchies your complaint services work in. Bring them in from one of three sources.
      </StepHeader>

      <section className="space-y-4">
        <h3 className="text-lg font-semibold text-foreground">How do you want to bring in your geography?</h3>
        <div className="grid max-w-3xl grid-cols-1 gap-4 sm:grid-cols-3">
          <OptionCard icon={LayoutGrid} title="Preconfigured" action={null}>
            Start from a boundary set we already hold for your country.
          </OptionCard>
          <OptionCard
            icon={MapPin}
            title="Fetch boundaries"
            action="Search boundaries"
            onClick={() => setSource('osm')}
            disabledReason={boundarySources?.length === 0 ? TURBOPASS_UNAVAILABLE_MESSAGE : undefined}
          >
            Pull administrative boundaries, with map polygons, from the official sets (OCHA COD-AB, geoBoundaries)
            or OpenStreetMap.
          </OptionCard>
          <OptionCard icon={Download} title="Upload from Excel" action="Upload a file" onClick={() => setSource('excel')}>
            Bring in your own levels and areas from a spreadsheet.
          </OptionCard>
        </div>
      </section>

      {loadError ? (
        <Alert variant="destructive">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>Couldn’t load your boundaries. {loadError}</span>
            <Button variant="outline" size="sm" onClick={reload}>
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      ) : !hierarchies ? (
        <div className="h-40 rounded-lg border border-dashed border-border bg-muted/40 animate-pulse" aria-busy="true" />
      ) : hierarchies.length === 0 ? (
        <EmptyState icon={MapPin} title="No boundaries yet">
          Your complaint services are routed inside a boundary hierarchy: countries, districts, wards. Bring one in from a
          source above to get started.
        </EmptyState>
      ) : (
        <section className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {hierarchies.length} {hierarchies.length === 1 ? 'hierarchy' : 'hierarchies'}
          </p>
          <ul className="space-y-3">
            {hierarchies.map((hierarchy) => (
              <li key={hierarchy.hierarchyType} className="flex items-start gap-3 rounded-lg border border-border bg-card p-4">
                <div className="w-10 h-10 rounded-md bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
                  <MapPin className="w-5 h-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-foreground">{hierarchy.hierarchyType}</p>
                  <p className="text-sm text-muted-foreground">{summaryLine(hierarchy)}</p>
                  {hierarchy.levels.length > 0 && (
                    <p className="mt-1 text-xs text-muted-foreground">{hierarchy.levels.join(' → ')}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
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
    </div>
  );
}
