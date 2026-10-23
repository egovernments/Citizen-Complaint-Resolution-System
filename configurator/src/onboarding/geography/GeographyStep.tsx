import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, MapPin } from 'lucide-react';
import { useApp } from '../../App';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { boundaryService, ApiClientError } from '@/api';
import { toast } from '@/hooks/use-toast';
import { StepHeader } from '../StepHeader';
import { EmptyState, OptionCard, StepActions } from '../StepParts';
import { adjacentSteps, stepById } from '../steps';
import { probeGate, useStepProbe } from '../stepProbe';
import { GEOGRAPHY_MULTIPLE_SELECTIONS_ENABLED } from '@/config/featureFlags';
import { useTurbopassHealth } from '@/hooks/useTurbopassSources';
import { usePreconfiguredBoundaries } from '@/hooks/usePreconfiguredBoundaries';
import { countryName, type OfficialSet } from '@/utils/officialBoundaries';
import { TURBOPASS_UNAVAILABLE_MESSAGE } from '@/utils/turbopassSuggestions';
import BoundaryImport, { type BoundarySource } from './BoundaryImport';
import { BoundaryList } from './BoundaryList';
import {
  addSelection,
  keepUnsaved,
  listHierarchy,
  removeSelection,
  saveBoundaryDraft,
  useBoundaryDraft,
  type BoundaryDraft,
  type BoundarySelection,
} from './boundaryDraft';
import { plural } from '@/utils/plural';
import { PreconfiguredCard } from './PreconfiguredCard';
import { MessageError, useOnboardingT, type OnboardingT } from '../i18n';
import { reportStepError, trackMethod } from '../telemetry';

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

/** One unsaved selection, summarised like a saved hierarchy. */
function selectionSummary(selection: BoundarySelection): HierarchySummary {
  const counts: Record<string, number> = {};
  for (const boundary of selection.boundaries) counts[boundary.boundaryType] = (counts[boundary.boundaryType] ?? 0) + 1;
  return { hierarchyType: selection.hierarchyType, levels: selection.levels, counts, total: selection.boundaries.length };
}

export default function GeographyStep() {
  const { state, completePhase, addUndo } = useApp();
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
  // Boundaries added but not saved: kept in this tab until Save and continue writes them.
  const draft = useBoundaryDraft(tenant);
  // The list's selection an Edit reopened.
  const [editing, setEditing] = useState<BoundarySelection | null>(null);
  const [saving, setSaving] = useState(false);
  // How far Save and continue has got, 0–100, while it writes the list.
  const [saveProgress, setSaveProgress] = useState(0);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Save and continue asks first when it would save new boundaries: they can't be changed after.
  const [confirmSave, setConfirmSave] = useState(false);
  // Set once this visit saves: the server's check that follows reads as part of saving.
  const [justSaved, setJustSaved] = useState(false);

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
  // Nothing can be added while a save runs. Otherwise one set of boundaries unless
  // the build allows more: the sources wait until the unsaved one is removed, and
  // stay closed once boundaries are saved.
  const listFullReason = saving
    ? t('geography.saving', 'Saving your boundaries…')
    : GEOGRAPHY_MULTIPLE_SELECTIONS_ENABLED
      ? undefined
      : draft
        ? t('geography.list.one_at_a_time', 'Remove the boundaries below to choose different ones.')
        : hasBoundaries
          ? t('geography.list.saved_already', 'Your boundaries are saved, so no more can be added.')
          : undefined;
  const { probe, recheck } = useStepProbe(
    state.tenant,
    'GEOGRAPHY',
    (hierarchies ?? []).map((hierarchy) => `${hierarchy.hierarchyType}:${hierarchy.total}`).join(','),
  );
  // With unsaved boundaries, Save and continue saves them first, so the server's check can't pass yet.
  const gate = draft
    ? { disabled: saving, hint: undefined, canRecheck: false }
    : probeGate(
        'GEOGRAPHY',
        {
          ready: hasBoundaries,
          hint: hierarchies && !hasBoundaries ? t('geography.gate_hint', 'Bring in a boundary hierarchy to continue.') : undefined,
        },
        probe,
      );

  /** Writes the unsaved list. True when everything landed; otherwise the reason stays on screen. */
  const saveDraft = async (toSave: BoundaryDraft): Promise<boolean> => {
    setSaving(true);
    setSaveProgress(0);
    setSaveError(null);
    try {
      const result = await saveBoundaryDraft(tenant, toSave, t, setSaveProgress);
      // Whatever didn't land stays in the list for another try; the hierarchy is fixed now either way.
      keepUnsaved(tenant, toSave, result.created);
      setJustSaved(true);
      reload();
      const wanted = toSave.selections.reduce((count, selection) => count + selection.boundaries.length, 0);
      if (wanted > 0 && result.created.length === 0) {
        setSaveError(
          [t('geography.osm.create_failed', 'Failed to create boundaries.'), result.failed[0]?.error].filter(Boolean).join(' '),
        );
        return false;
      }
      if (result.created.length) addUndo('create_boundaries', `Created ${result.created.length} boundaries`);
      const failures = [
        result.failed.length > 0
          ? `${t('geography.create_failures', '%{count} boundaries failed to create.', { count: result.failed.length })} ${t(
              'geography.save_retry',
              'They are still in the list below: Save and continue tries them again.',
            )}`
          : null,
        result.schemaError,
      ].filter(Boolean);
      if (failures.length) {
        setSaveError(failures.join(' '));
        return false;
      }
      return true;
    } catch (err) {
      console.error(err);
      reportStepError('geography', 'save_boundaries', err, tenant);
      setSaveError(
        err instanceof MessageError
          ? t(err.key, err.english, err.params)
          : err instanceof ApiClientError
            ? err.firstError
            : err instanceof Error
              ? err.message
              : t('geography.osm.create_failed', 'Failed to create boundaries.'),
      );
      return false;
    } finally {
      setSaving(false);
    }
  };

  if (source) {
    const close = () => {
      setSource(null);
      setPreconfiguredSet(null);
      setEditing(null);
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
          resume={editing?.resume ?? null}
          list={listHierarchy(draft, editing?.id)}
          onCancel={() => {
            trackMethod('geography', preconfiguredSet ? 'preconfigured' : source === 'osm' ? 'fetch' : 'excel', true);
            close();
          }}
          onDone={(selection) => {
            const added = addSelection(tenant, selection, t, editing?.id);
            if (added.error) return added.error;
            close();
            setSaveError(null);
            if (added.duplicates > 0) {
              toast({
                title:
                  added.duplicates === 1
                    ? t('geography.list.duplicates_one', '1 boundary was already in your list, so it was left out.')
                    : t('geography.list.duplicates_other', '%{count} boundaries were already in your list, so they were left out.', {
                        count: added.duplicates.toLocaleString('en-US'),
                      }),
              });
            }
            return null;
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
            disabledReason={listFullReason}
            onUse={() => {
              if (preconfigured.state.status !== 'ready') return;
              setPreconfiguredSet(preconfigured.state.set);
              setSource('osm');
              trackMethod('geography', 'preconfigured');
            }}
          />
          <OptionCard
            icon={MapPin}
            title={t('geography.fetch_title', 'Fetch boundaries')}
            action={t('geography.fetch_action', 'Search boundaries')}
            onClick={() => {
              setSource('osm');
              trackMethod('geography', 'fetch');
            }}
            disabledReason={
              boundarySources?.length === 0 ? t('geography.turbopass_unavailable', TURBOPASS_UNAVAILABLE_MESSAGE) : listFullReason
            }
          >
            {t(
              'geography.fetch_body_plain',
              'Search for your area and bring in its administrative boundaries, with map outlines.',
            )}
          </OptionCard>
          <OptionCard
            icon={Download}
            title={t('geography.excel_title', 'Upload from Excel')}
            action={t('common.upload_file', 'Upload a file')}
            onClick={() => {
              setSource('excel');
              trackMethod('geography', 'excel');
            }}
            disabledReason={listFullReason}
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
      ) : hierarchies.length === 0 && !draft ? (
        <EmptyState icon={MapPin} title={t('geography.empty_title', 'No boundaries yet')}>
          {t(
            'geography.empty_body',
            'Your complaint services are routed inside a boundary hierarchy: countries, districts, wards. Bring one in from a source above to get started.',
          )}
        </EmptyState>
      ) : (
        <section className="space-y-3">
          {hierarchies.length > 0 && (
            <p className="text-sm text-muted-foreground">
              {hierarchies.length === 1
                ? t('geography.hierarchy_count_one', '%{count} hierarchy', { count: 1 })
                : t('geography.hierarchy_count_other', '%{count} hierarchies', { count: hierarchies.length })}
            </p>
          )}
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
            {draft && (
              <BoundaryList
                draft={draft}
                summarize={(selection) => summaryLine(selectionSummary(selection), t)}
                disabled={saving}
                onEdit={(selection) => {
                  setEditing(selection);
                  setPreconfiguredSet(selection.preconfigured);
                  setSource(selection.source);
                }}
                onRemove={(selection) => removeSelection(tenant, selection.id)}
              />
            )}
          </ul>
        </section>
      )}

      {saving && (
        <div className="rounded-lg border border-border bg-card p-4" aria-busy="true" data-testid="geography-saving">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs sm:text-sm font-medium">{t('geography.saving', 'Saving your boundaries…')}</span>
            <span className="text-xs sm:text-sm text-primary font-medium">{saveProgress}%</span>
          </div>
          <Progress value={saveProgress} className="h-2" />
          <p className="text-xs sm:text-sm text-muted-foreground mt-2">
            {t('geography.saving_keep_open', 'A large set can take a few minutes. Keep this page open.')}
          </p>
        </div>
      )}

      {saveError && (
        <Alert variant="destructive">
          <AlertDescription>{saveError}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <StepActions
          onBack={previous && !saving ? () => navigate(previous.path) : undefined}
          onContinue={async () => {
            if (draft) {
              setConfirmSave(true);
              return;
            }
            if (!await completePhase(STEP.number)) return;
            if (next) navigate(next.path);
          }}
          busy={saving}
          disabled={gate.disabled}
          // Right after a save the server's check runs while the boundaries settle, so it reads as saving.
          hint={justSaved && !draft && hasBoundaries && probe.status === 'checking' ? t('geography.probe_saving', 'Saving') : gate.hint}
        />
        {gate.canRecheck && (
          <Button variant="ghost" size="sm" onClick={recheck}>
            {t('probe.check_again', 'Check again')}
          </Button>
        )}
      </div>

      <AlertDialog open={confirmSave} onOpenChange={setConfirmSave}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('geography.save_confirm_title', 'Save these boundaries?')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('geography.save_confirm_body', 'Once saved, you won’t be able to edit or remove them.')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel', 'Cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                setConfirmSave(false);
                if (!draft || !(await saveDraft(draft))) return;
                if (!await completePhase(STEP.number)) return;
                if (next) navigate(next.path);
              }}
            >
              {t('step.save_continue', 'Save and continue')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
