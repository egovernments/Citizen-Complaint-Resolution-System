import { useEffect, useRef, useState } from 'react';
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
import { boundaryService, mdmsService, ApiClientError } from '@/api';
import type { BoundaryCreateFailure } from '@/api/services/boundary';
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
  retryHierarchyRecord,
  saveBoundaryDraft,
  useBoundarySave,
  usePendingHierarchyRecord,
  useBoundaryDraft,
  type BoundaryDraft,
  type BoundarySelection,
} from './boundaryDraft';
import { plural } from '@/utils/plural';
import { PreconfiguredCard } from './PreconfiguredCard';
import { MessageError, useOnboardingT, type OnboardingT } from '../i18n';
import { reportStepError, trackMethod } from '../telemetry';

const STEP = stepById('geography');
/** Areas a failed save lists by name; the rest are counted. */
const MAX_FAILURES_SHOWN = 10;
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
      // A failed read fails the load: read as empty, it would reopen the sources on a saved hierarchy.
      const boundaries = await boundaryService.searchBoundaries(tenant, { hierarchyType: hierarchy.hierarchyType });
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

/** The hierarchy the step's check reads (its CMS-BOUNDARY.HierarchySchema row); undefined when unrecorded or unreadable. */
async function recordedHierarchy(tenant: string): Promise<string | undefined> {
  try {
    return await mdmsService.getRecordedHierarchyType(tenant);
  } catch {
    return undefined;
  }
}

/**
 * The saved hierarchy that has areas on one level only, or null. The step's check
 * needs an area inside another, so it can never pass on its own: a save the server
 * partly refused leaves this (#2795), and Upload from Excel stays open to finish it.
 * It's the recorded hierarchy (the one the check reads), or else the one with areas.
 */
function unfinishedHierarchy(hierarchies: HierarchySummary[] | null, recorded?: string): HierarchySummary | null {
  if (!hierarchies) return null;
  const target = hierarchies.find((h) => h.hierarchyType === recorded) ?? hierarchies.find((h) => h.total > 0);
  if (!target || target.total === 0) return null;
  const levelsWithAreas = Object.values(target.counts).filter((count) => count > 0).length;
  return levelsWithAreas < 2 ? target : null;
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
  // The hierarchy the step's check reads, read with them.
  const [recorded, setRecorded] = useState<string | undefined>(undefined);
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
  // A running save, kept in the store so it's still shown after leaving the step and coming back.
  const saveProgress = useBoundarySave(tenant);
  const saving = saveProgress !== null;
  // A save left the hierarchy record unwritten: Save and continue writes it.
  const pendingRecord = usePendingHierarchyRecord(tenant);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [saveError, setSaveError] = useState<string | null>(null);
  // The areas the last save didn't write, each with the server's reason, shown under saveError.
  const [saveFailures, setSaveFailures] = useState<BoundaryCreateFailure[]>([]);
  // Save and continue asks first when it would save new boundaries: they can't be changed after.
  const [confirmSave, setConfirmSave] = useState(false);
  // Set once this visit saves: the server's check that follows reads as part of saving.
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadHierarchies(tenant), recordedHierarchy(tenant)])
      .then(([loaded, recordedType]) => {
        if (cancelled) return;
        setHierarchies(loaded);
        setRecorded(recordedType);
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
  // Saved boundaries the step's check can't pass on (#2795): Upload from Excel stays open to finish them.
  const unfinished = unfinishedHierarchy(hierarchies, recorded);
  // Nothing can be added while a save runs. Otherwise one set of boundaries unless
  // the build allows more: the sources wait for the saved ones to be read, stay
  // closed once boundaries are saved (unless they're unfinished), and wait until
  // an unsaved one is removed.
  const listFullReason = saving
    ? t('geography.saving', 'Saving your boundaries…')
    : GEOGRAPHY_MULTIPLE_SELECTIONS_ENABLED
      ? undefined
      : !hierarchies
        ? t('geography.list.checking_saved', 'Checking your saved boundaries…')
        : hasBoundaries && !unfinished
          ? t('geography.list.saved_already', 'Your boundaries are saved, so no more can be added.')
          : draft
            ? t('geography.list.one_at_a_time', 'Remove the boundaries below to choose different ones.')
            : undefined;
  // Fetch and Preconfigured write into the deployment's hierarchy, which may not be the
  // unfinished one, and a second hierarchy never completes the step: only Excel finishes it.
  const fetchClosedReason = listFullReason ?? (unfinished ? t('geography.list.finish_with_excel', 'To finish your saved boundaries, use Upload from Excel.') : undefined);
  const { probe, recheck } = useStepProbe(
    state.tenant,
    'GEOGRAPHY',
    (hierarchies ?? []).map((hierarchy) => `${hierarchy.hierarchyType}:${hierarchy.total}`).join(','),
  );
  // With unsaved boundaries, or a hierarchy record still to write, Save and continue
  // writes them first, so the server's check can't pass yet.
  const gate = draft || pendingRecord
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
    setSaveError(null);
    setSaveFailures([]);
    try {
      const result = await saveBoundaryDraft(tenant, toSave, t, hasBoundaries);
      // Whatever didn't land stays in the list for another try; the hierarchy is fixed now either way.
      keepUnsaved(tenant, result.created);
      setJustSaved(true);
      reload();
      // Which areas didn't land and why, so they can be fixed (Edit) or tried again (#2795).
      setSaveFailures(result.failed);
      const notSaved =
        result.failed.length > 0
          ? `${
              result.failed.length === 1
                ? t('geography.not_saved_one', '1 area wasn’t saved, so this step isn’t complete yet.')
                : t('geography.not_saved_other', '%{count} areas weren’t saved, so this step isn’t complete yet.', {
                    count: result.failed.length.toLocaleString('en-US'),
                  })
            } ${t('geography.not_saved_next', 'They’re still in the list below: fix them with Edit, or press Save and continue to try them again.')}`
          : null;
      const wanted = toSave.selections.reduce((count, selection) => count + selection.boundaries.length, 0);
      if (wanted > 0 && result.created.length === 0) {
        setSaveError(
          notSaved ??
            `${t('geography.osm.create_failed', 'Failed to create boundaries.')} ${t(
              'geography.save_retry',
              'They are still in the list below: Save and continue tries them again.',
            )}`,
        );
        return false;
      }
      if (result.created.length) addUndo('create_boundaries', `Created ${result.created.length} boundaries`);
      const failures = [
        notSaved,
        result.schemaError
          ? `${result.schemaError} ${t('geography.schema_retry', 'Save and continue tries it again.')}`
          : null,
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
          addTo={source === 'excel' && !editing ? (unfinished?.hierarchyType ?? null) : null}
          onCancel={() => {
            trackMethod('geography', preconfiguredSet ? 'preconfigured' : source === 'osm' ? 'fetch' : 'excel', true);
            close();
          }}
          onDone={(selection, saved) => {
            const added = addSelection(tenant, selection, t, editing?.id, saved);
            if (added.error) return added.error;
            close();
            setSaveError(null);
            setSaveFailures([]);
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
            if (added.alreadySaved > 0) {
              toast({
                title:
                  added.alreadySaved === 1
                    ? t('geography.list.saved_one', '1 boundary is already saved, so it was left out.')
                    : t('geography.list.saved_other', '%{count} boundaries are already saved, so they were left out.', {
                        count: added.alreadySaved.toLocaleString('en-US'),
                      }),
              });
            }
            return null;
          }}
        />
      </div>
    );
  }

  const unsavedList = draft && (
    <BoundaryList
      draft={draft}
      summarize={(selection) => summaryLine(selectionSummary(selection), t)}
      disabled={saving}
      // With the flag off and boundaries saved, a removed leftover can't be brought back.
      removeBody={
        !GEOGRAPHY_MULTIPLE_SELECTIONS_ENABLED && hasBoundaries && !unfinished
          ? t(
              'geography.list.remove_final',
              'These boundaries haven’t been saved. Your other boundaries are, so once these are removed they can’t be added again.',
            )
          : undefined
      }
      onEdit={(selection) => {
        setEditing(selection);
        setPreconfiguredSet(selection.preconfigured);
        setSource(selection.source);
      }}
      onRemove={(selection) => removeSelection(tenant, selection.id)}
    />
  );

  return (
    <div className="space-y-8">
      <StepHeader eyebrow={t('step.your_account', 'Your account')} title={t('steps.geography', 'Geography')} done={done}>
        {t('geography.intro', 'The boundary hierarchies your complaint services work in. Bring them in from one of three sources.')}
      </StepHeader>

      {unfinished && !draft && !saving && (
        <Alert variant="warning" data-testid="geography-unfinished">
          <AlertDescription>
            {t(
              'geography.unfinished',
              'Your boundaries were only partly saved. %{hierarchy} has %{summary} but nothing on the level below, so this step can’t be completed yet. Use Upload from Excel to add the missing areas.',
              { hierarchy: unfinished.hierarchyType, summary: summaryLine(unfinished, t) },
            )}
          </AlertDescription>
        </Alert>
      )}

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
            disabledReason={fetchClosedReason}
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
              boundarySources?.length === 0 ? t('geography.turbopass_unavailable', TURBOPASS_UNAVAILABLE_MESSAGE) : fetchClosedReason
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
        <div className="space-y-3">
          <Alert variant="destructive">
            <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
              <span>{t('geography.load_failed', 'Couldn’t load your boundaries. %{reason}', { reason: loadError })}</span>
              <Button variant="outline" size="sm" onClick={reload}>
                {t('common.try_again', 'Try again')}
              </Button>
            </AlertDescription>
          </Alert>
          {unsavedList && <ul className="space-y-3">{unsavedList}</ul>}
        </div>
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
            {unsavedList}
          </ul>
        </section>
      )}

      {saving && (
        <div className="rounded-lg border border-border bg-card p-4" aria-busy="true" data-testid="geography-saving">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs sm:text-sm font-medium">{t('geography.saving', 'Saving your boundaries…')}</span>
            <span className="text-xs sm:text-sm text-primary font-medium">{saveProgress}%</span>
          </div>
          <Progress value={saveProgress ?? 0} className="h-2" />
          <p className="text-xs sm:text-sm text-muted-foreground mt-2">
            {t('geography.saving_keep_open', 'A large set can take a few minutes. Keep this page open.')}
          </p>
        </div>
      )}

      {saveError && (
        <Alert variant="destructive">
          <AlertDescription>
            {saveError}
            {saveFailures.length > 0 && (
              <ul className="mt-2 space-y-1" data-testid="geography-save-failures">
                {saveFailures.slice(0, MAX_FAILURES_SHOWN).map(({ boundary, error, code }) => (
                  <li key={boundary.code}>
                    <span className="font-medium">
                      {boundary.name && boundary.name !== boundary.code ? `${boundary.name} (${boundary.code})` : boundary.code}
                    </span>
                    {': '}
                    {/* The server's own words when it said why; its code in small print. */}
                    {code ? error : t('geography.not_saved_unconfirmed', 'The server didn’t confirm it was saved.')}
                    {code && <span className="ml-1 text-xs opacity-70">({code})</span>}
                  </li>
                ))}
                {saveFailures.length > MAX_FAILURES_SHOWN && (
                  <li>
                    {t('geography.not_saved_more', 'and %{count} more', {
                      count: (saveFailures.length - MAX_FAILURES_SHOWN).toLocaleString('en-US'),
                    })}
                  </li>
                )}
              </ul>
            )}
          </AlertDescription>
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
            if (pendingRecord) {
              setSaveError(null);
              setSaveFailures([]);
              const failed = await retryHierarchyRecord(tenant, t);
              if (failed) {
                setSaveError(failed);
                return;
              }
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
                // Left the step while it saved: don't pull the operator back.
                if (!mounted.current) return;
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
