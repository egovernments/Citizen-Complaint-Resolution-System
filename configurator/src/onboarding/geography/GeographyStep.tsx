import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, MapPin } from 'lucide-react';
import { useApp } from '../../App';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { boundaryService } from '@/api';
import { toast } from '@/hooks/use-toast';
import { StepHeader } from '../StepHeader';
import { EmptyState, OptionCard, StepActions } from '../StepParts';
import { adjacentSteps, stepById } from '../steps';
import { probeGate, useStepProbe } from '../stepProbe';
import { useTurbopassHealth } from '@/hooks/useTurbopassSources';
import { usePreconfiguredBoundaries } from '@/hooks/usePreconfiguredBoundaries';
import { countryName, type OfficialSet } from '@/utils/officialBoundaries';
import { TURBOPASS_UNAVAILABLE_MESSAGE } from '@/utils/turbopassSuggestions';
import BoundaryImport, { type BoundarySource } from './BoundaryImport';
import { plural } from '@/utils/plural';
import { PreconfiguredCard } from './PreconfiguredCard';
import { useOnboardingT, type OnboardingT } from '../i18n';

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

/** "3 districts · 12 wards", in level order. Level names are the workspace's own, so they stay as named. */
function summaryLine(hierarchy: HierarchySummary, t: OnboardingT): string {
  const parts = hierarchy.levels
    .filter((level) => hierarchy.counts[level])
    .map((level) => {
      const count = hierarchy.counts[level];
      const word = level.toLowerCase();
      return `${count} ${count === 1 ? word : plural(word)}`;
    });
  return parts.length ? parts.join(' · ') : t('geography.nothing_in_it_yet', 'Nothing in it yet');
}

export default function GeographyStep() {
  const { state, completePhase } = useApp();
  const navigate = useNavigate();
  const t = useOnboardingT();
  // Boundaries live at the workspace tenant, which every later step reads them from.
  const tenant = state.targetTenant || state.tenant;
  const done = state.completedPhases.includes(STEP.number);

  const [source, setSource] = useState<BoundarySource | null>(null);
  const [hierarchies, setHierarchies] = useState<HierarchySummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  // Fetching boundaries needs the turbopass service; say so up front when it's missing.
  // One /health read serves both the Fetch sources and Preconfigured.
  const health = useTurbopassHealth();
  const boundarySources = health?.sources ?? null;
  // "Preconfigured": the official set turbopass holds for the tenant's country.
  const preconfigured = usePreconfiguredBoundaries(tenant, health?.officialCountries ?? null);
  const [preconfiguredSet, setPreconfiguredSet] = useState<OfficialSet | null>(null);

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
    {
      ready: hasBoundaries,
      hint: hierarchies && !hasBoundaries ? t('geography.gate_hint', 'Bring in a boundary hierarchy to continue.') : undefined,
    },
    probe,
  );

  if (source) {
    const close = () => {
      setSource(null);
      setPreconfiguredSet(null);
    };
    return (
      <div className="space-y-6">
        <StepHeader
          eyebrow={t('steps.geography', 'Geography')}
          title={
            preconfiguredSet
              ? t('geography.preconfigured_title', 'Preconfigured boundaries')
              : source === 'osm'
                ? t('geography.fetch_title', 'Fetch boundaries')
                : t('geography.excel_title', 'Upload from Excel')
          }
          done={done}
        >
          {preconfiguredSet
            ? t(
                'geography.preconfigured_intro',
                'Official boundaries for %{country}. Search for your city or region, then pick which levels become your boundary hierarchy.',
                { country: countryName(preconfiguredSet.country) },
              )
            : source === 'osm'
              ? t('geography.fetch_intro', 'Search for your area and pick which administrative levels become your boundary hierarchy.')
              : t('geography.excel_intro', 'Define your levels, fill the template with your areas, and upload it.')}
        </StepHeader>
        <BoundaryImport
          source={source}
          hasHierarchies={!!hierarchies?.length}
          sourceChoices={boundarySources}
          preconfigured={preconfiguredSet}
          workspaceName={preconfigured.workspaceName}
          onCancel={close}
          onDone={() => {
            close();
            reload();
            toast({ title: t('geography.imported', 'Boundaries imported') });
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <StepHeader eyebrow={t('step.your_account', 'Your account')} title={t('steps.geography', 'Geography')} done={done}>
        {t('geography.intro', 'The boundary hierarchies your complaint services work in. Bring them in from one of three sources.')}
      </StepHeader>

      <section className="space-y-4">
        <h3 className="text-lg font-semibold text-foreground">
          {t('geography.how_heading', 'How do you want to bring in your geography?')}
        </h3>
        {/* Three across only from lg: with the onboarding sidebar open on a tablet
            (820px), three cards are ~156px and the Preconfigured button overflows. */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:gap-6">
          <PreconfiguredCard
            state={preconfigured.state}
            onRetry={preconfigured.retry}
            onUse={() => {
              if (preconfigured.state.status !== 'ready') return;
              setPreconfiguredSet(preconfigured.state.set);
              setSource('osm');
            }}
          />
          <OptionCard
            icon={MapPin}
            title={t('geography.fetch_title', 'Fetch boundaries')}
            action={t('geography.fetch_action', 'Search boundaries')}
            onClick={() => setSource('osm')}
            disabledReason={
              boundarySources?.length === 0 ? t('geography.turbopass_unavailable', TURBOPASS_UNAVAILABLE_MESSAGE) : undefined
            }
          >
            {t(
              'geography.fetch_body',
              'Pull administrative boundaries, with map polygons, from the official sets (OCHA COD-AB, geoBoundaries) or OpenStreetMap.',
            )}
          </OptionCard>
          <OptionCard
            icon={Download}
            title={t('geography.excel_title', 'Upload from Excel')}
            action={t('common.upload_file', 'Upload a file')}
            onClick={() => setSource('excel')}
          >
            {t('geography.excel_body', 'Bring in your own levels and areas from a spreadsheet.')}
          </OptionCard>
        </div>
      </section>

      {loadError ? (
        <Alert variant="destructive">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>{t('geography.load_failed', 'Couldn’t load your boundaries. %{reason}', { reason: loadError })}</span>
            <Button variant="outline" size="sm" onClick={reload}>
              {t('common.try_again', 'Try again')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : !hierarchies ? (
        <div className="h-40 rounded-lg border border-dashed border-border bg-muted/40 animate-pulse" aria-busy="true" />
      ) : hierarchies.length === 0 ? (
        <EmptyState icon={MapPin} title={t('geography.empty_title', 'No boundaries yet')}>
          {t(
            'geography.empty_body',
            'Your complaint services are routed inside a boundary hierarchy: countries, districts, wards. Bring one in from a source above to get started.',
          )}
        </EmptyState>
      ) : (
        <section className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {hierarchies.length === 1
              ? t('geography.hierarchy_count_one', '%{count} hierarchy', { count: 1 })
              : t('geography.hierarchy_count_other', '%{count} hierarchies', { count: hierarchies.length })}
          </p>
          <ul className="space-y-3">
            {hierarchies.map((hierarchy) => (
              <li key={hierarchy.hierarchyType} className="flex items-start gap-3 rounded-lg border border-border bg-card p-4">
                <div className="w-10 h-10 rounded-md bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
                  <MapPin className="w-5 h-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-foreground">{hierarchy.hierarchyType}</p>
                  <p className="text-sm text-muted-foreground">{summaryLine(hierarchy, t)}</p>
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
            {t('probe.check_again', 'Check again')}
          </Button>
        )}
      </div>
    </div>
  );
}
