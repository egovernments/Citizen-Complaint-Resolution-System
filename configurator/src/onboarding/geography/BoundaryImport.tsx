import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useApp } from '../../App';
import {
  MapPin,
  Search,
  Plus,
  FolderOpen,
  Download,
  Upload,
  Check,
  ChevronRight,
  Loader2,
  AlertTriangle,
  AlertCircle,
  X,
  RefreshCw,
  ArrowLeft,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { DigitCard } from '@/components/digit/DigitCard';
import { Header, SubHeader } from '@/components/digit/Header';
import { LabelFieldPair, CardLabel, Field } from '@/components/digit/LabelFieldPair';
import { SubmitBar } from '@/components/digit/SubmitBar';
import { Banner } from '@/components/digit/Banner';
import { apiClient, boundaryService, localizationService, mdmsService, ApiClientError } from '@/api';
import { WORKSPACE_HIERARCHY_TYPE } from '@/api/services/boundary';
import { reportStepError, trackStepAction } from '../telemetry';
import { parseExcelFile, parseBoundaryExcel } from '@/utils/excelParser';
import { downloadBoundaryTemplate } from '@/utils/templateBuilder';
import { parseGeoJsonSidecar, geometryForBoundary, type ParsedGeoJsonSidecar } from '@/utils/boundaryGeoJson';
import { TURBOPASS_BASE } from '@/hooks/useTurbopassSources';
import { buildOsmBoundaries, computeContainingParents, groupFetchedLevels, type OsmAdminLevel, type SkippedOsmFeature } from '@/utils/osmBoundaries';
import {
  deadEndMessage,
  formatSuggestionLabel,
  pickPromptMessage,
  pickSuggestion,
  attributionLine,
  chooseTurbopassSource,
  fetchSourceFor,
  isOfflineSource,
  sourceLabel,
  sourceOptionLabel,
  tagWithSource,
  tooFewLevelsMessage,
  turbopassErrorMessage,
  turbopassSearchUrl,
} from '@/utils/turbopassSuggestions';
import { summarizeBoundaryQuality } from '@/utils/boundaryQuality';
import { validateGoogleMapsKey, type GoogleKeyCheck } from '@/utils/googleMaps';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useMapProviderConfig } from '@/hooks/useMapProviderConfig';
import { BoundaryMap } from '@/components/ui/BoundaryMap';
import { deriveMapPosition } from '@/utils/mapConfigFromBoundaries';
import type { BoundaryHierarchy, Boundary, BoundaryExcelRow } from '@/api/types';

type Step =
  // shared
  | 'complete'
  // Excel path (develop's original flow)
  | 'excel-landing' | 'create-hierarchy' | 'select-hierarchy' | 'template' | 'upload' | 'verify'
  // OSM path
  | 'osm-search' | 'map-levels' | 'osm-review' | 'creating';

type BoundaryPath = 'osm' | 'excel' | null;

// The included levels, ascending by OSM admin_level.
function getSelectedLevels(levels: OsmAdminLevel[]): OsmAdminLevel[] {
  return [...levels].filter(l => l.selected).sort((a, b) => a.level - b.level);
}

// A valid hierarchy is a CONTIGUOUS subset of the discovered levels (>= 2),
// each named. Contiguous because the hierarchy is a strict parent→child chain:
// a gap would reparent a deep level's features onto the level above, silently
// collapsing the skipped tier.
function validateLevelSelection(levels: OsmAdminLevel[]): { valid: boolean; error: string | null } {
  const allSorted = [...levels].sort((a, b) => a.level - b.level);
  const selected = getSelectedLevels(levels);
  if (selected.length < 2) {
    return { valid: false, error: 'Select at least two levels to form a hierarchy.' };
  }
  const idx = selected.map(l => allSorted.findIndex(x => x.level === l.level));
  const contiguous = idx[idx.length - 1] - idx[0] === idx.length - 1;
  if (!contiguous) {
    const gaps = allSorted
      .slice(idx[0], idx[idx.length - 1] + 1)
      .filter(l => !l.selected)
      .map(l => `Level ${l.level}`);
    return {
      valid: false,
      error:
        `Selected levels must be contiguous — you can't skip a level in between, ` +
        `the hierarchy is a strict parent→child chain. Re-include ${gaps.join(', ')}, ` +
        `or trim from the top/bottom of the range instead.`,
    };
  }
  const unnamed = selected.filter(l => !l.mappedName.trim());
  if (unnamed.length) {
    return { valid: false, error: `Name every selected level (missing: ${unnamed.map(l => `Level ${l.level}`).join(', ')}).` };
  }
  return { valid: true, error: null };
}


// Boundary data source served by turbopass. Unset (the default), Phase 2 asks
// the search-api's /health and uses 'official' — per country, the OCHA COD-AB
// or geoBoundaries set that nests deepest (#1994) — when its DB has them, else
// 'overture'. Both are offline: no API key, no per-call cost. Set
// VITE_TURBOPASS_SOURCE at build time to pin one: official | overture | cod |
// geoboundaries | geoapify (hosted; needs GEOAPIFY_API_KEY on the search-api).
const CONFIGURED_TURBOPASS_SOURCE: string | undefined = import.meta.env.VITE_TURBOPASS_SOURCE;

// How the overture search matches the typed name: 'exact' | 'prefix' |
// 'substring' (default — the same candidates as before, now ranked exact →
// prefix → substring, broadest level first) | 'fuzzy' (also tolerates a typo
// or two). The geoapify source ignores it.
const TURBOPASS_MATCH: string = import.meta.env.VITE_TURBOPASS_MATCH || 'substring';

/** The `message` of a Nest error body, when it has one. */
async function serverMessage(res: Response): Promise<string | undefined> {
  const body = await res.json().catch(() => null);
  const m = body?.message;
  return typeof m === 'string' ? m : Array.isArray(m) ? m.join('; ') : undefined;
}

// Hierarchy type the OSM onboarding path writes. Deployment-agnostic: reads the
// configured HIERARCHY_TYPE from the served globalConfigs (ansible renders it
// from host_vars `hierarchy_type`) so the hierarchy created here matches what
// the citizen/PGR UI later resolves boundaries against — otherwise the citizen
// complaint form's boundary picker 400s (HIERARCHY_DEFINITION_DOES_NOT_EXIST).
// Falls back to DIGIT's default 'ADMIN' when globalConfigs isn't present, so a
// deployment that doesn't override HIERARCHY_TYPE keeps the previous behaviour.
// globalConfigs.js is injected as a <script> before this bundle, so the read
// resolves at module-eval time in the built app.
function getConfiguredHierarchyType(): string {
  if (typeof window !== 'undefined') {
    const gc = (
      window as unknown as { globalConfigs?: { getConfig?: (k: string) => unknown } }
    ).globalConfigs?.getConfig?.('HIERARCHY_TYPE');
    if (typeof gc === 'string' && gc) return gc;
  }
  return 'ADMIN';
}
const OSM_HIERARCHY_TYPE = getConfiguredHierarchyType();

// Post-create pipeline shared by BOTH paths after createBoundaries succeeds:
// localizations (boundary names are required for the citizen UI; the rest is
// best-effort), localization cache-bust, and the boundary-path repair tool.
// Returns a message for the operator when the hierarchy record didn't save.
async function runPostCreatePipeline(
  tenantId: string,
  created: Boundary[],
  hierarchyType: string,
  levels: { boundaryType: string }[],
): Promise<string | null> {
  // Make this the tenant's PGR hierarchy (CMS-BOUNDARY.HierarchySchema) when it
  // has none yet: digit-ui, the dashboard and PGR read it in place of the
  // deployment-wide HIERARCHY_TYPE / pgrBoundary*Level globalConfigs (#2260).
  // The boundaries exist either way, so the rest still runs, but the operator
  // is told: without this row the Geography step can't complete.
  let schemaError: string | null = null;
  if (levels.length > 0) {
    try {
      await mdmsService.ensureHierarchySchema(tenantId, {
        hierarchy: hierarchyType,
        highestHierarchy: levels[0].boundaryType,
        lowestHierarchy: levels[levels.length - 1].boundaryType,
      });
    } catch (e) {
      console.warn('[geography] CMS-BOUNDARY.HierarchySchema not written', e);
      reportStepError('geography', 'hierarchy_schema', e, tenantId);
      const reason = e instanceof ApiClientError ? e.firstError : e instanceof Error ? e.message : String(e);
      schemaError = `Boundaries were created, but the hierarchy record didn't save: ${reason}`;
    }
  }

  // Create localizations for boundaries
  const boundaryData = created.map(b => ({
    code: b.code,
    name: b.name,
  }));

  // Seed under every locale the tenant actually serves (StateInfo.languages),
  // not a hardcoded en_IN — the digit-ui citizen app reads boundary names under
  // its ACTIVE locale (e.g. en_KE / sw_KE for Kenya), so seeding only en_IN left
  // the create-complaint locality dropdown AND the OSM map ward tooltips showing
  // raw boundary codes. Fall back to en_IN when StateInfo has no languages so an
  // India tenant behaves exactly as before.
  const configuredLocales = await mdmsService.getStateInfoLocales(tenantId).catch(() => []);
  const locales = configuredLocales.length > 0 ? configuredLocales : ['en_IN'];

  for (const locale of locales) {
    await localizationService.uploadBoundaryLocalizations(
      tenantId,
      boundaryData,
      hierarchyType,
      locale
    );

    // Create level-label localization keys so DIGIT-UI renders "MUNICÍPIO" / "DISTRITO"
    // instead of the raw key "maputo_hierarchy_type_MUNICÍPIO" in the complaint form.
    await localizationService.uploadHierarchyLevelLocalizations(
      tenantId,
      hierarchyType,
      levels,
      locale
    ).catch(e => console.warn(`hierarchy-level localization failed (non-fatal) for ${locale}`, e));
  }

  await localizationService.cacheBust().catch(e => console.warn('cache-bust failed', e));

  // The boundaries just onboarded describe exactly the area this tenant serves,
  // so they already answer where the citizen map should open, how far in, and
  // which extent the address search may return results from. Derive all three
  // rather than asking an admin to type eight numbers they cannot sanity-check
  // without a map in front of them — and note a wrong search extent is not
  // cosmetic: Nominatim's bounded search DISCARDS anything outside the box.
  //
  // Best-effort. Boundaries are the operator's real work here; failing Phase 2
  // over a map default would be a poor trade. An unwritten MapConfig just means
  // the map keeps its built-in defaults.
  try {
    const derived = deriveMapPosition(created);
    if (derived) {
      await mdmsService.upsertMapConfig(tenantId, {
        ...derived,
        // The wards the map draws are the ones we just created, for this tenant.
        boundaryTenantId: tenantId,
      });
    } else {
      console.warn('[geography] no boundary geometry — leaving MapConfig at its defaults');
    }
  } catch (e) {
    console.warn('[geography] map position not written (non-fatal)', e);
  }

  // Clear ancestralmaterializedpath so boundary-service includeChildren=true
  // doesn't combine two overlapping queries and return each node twice in the
  // citizen create-complaint dropdown. Fire-and-forget: if the MCP REST shim
  // isn't deployed, Phase 2 still completes and an operator can run
  // fix_boundary_paths via the MCP tool manually.
  try {
    const { token } = apiClient.getAuth();
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 10_000);
    const res = await fetch(`${window.location.origin}/v1/tools/fix_boundary_paths`, {
      method: 'POST',
      signal: ac.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ tenant_id: tenantId }),
    });
    clearTimeout(timer);
    if (!res.ok) console.warn(`[geography] boundary path fix returned ${res.status}`);
  } catch (e) {
    console.warn('[geography] boundary path fix skipped (MCP not reachable):', e);
  }
  return schemaError;
}

export type BoundarySource = 'osm' | 'excel';

/**
 * Bringing a boundary hierarchy in, from OpenStreetMap or from an Excel sheet.
 * Geography opens it for the source picked there, and it hands back when the
 * boundaries are created (onDone) or the operator backs out (onCancel).
 */
export default function BoundaryImport({
  source,
  hasHierarchies,
  sourceChoices,
  onDone,
  onCancel,
}: {
  source: BoundarySource;
  /** With none yet, "create a hierarchy" is the only way in, so the choice is skipped. */
  hasHierarchies: boolean;
  /** Sources turbopass can answer, from Geography's /health read: null while
   *  asking, [] when it isn't deployed or holds no data. */
  sourceChoices: string[] | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { addUndo, state } = useApp();
  // Phase 2 writes boundaries at the onboarding tenant (the Phase-1 city, e.g.
  // mz.maputo). The configurator reads boundaries at THIS tenant everywhere —
  // its reference-data fetches and later phases all query targetTenant — so the
  // writer MUST match the readers. (An earlier attempt to write these at the
  // state root to satisfy PGR split the configurator's read/write and 400'd its
  // reference-data load: "Hierarchy definition does not exist". PGR is instead
  // pointed at the city via the digit-ui ui_state_tenant_id config, not by
  // moving where the configurator stores boundaries.) Fall back to the session
  // tenant if Phase 1 was skipped (URL-direct).
  const boundaryTenant = state.targetTenant || state.tenant;

  const [step, setStep] = useState<Step>(source === 'osm' ? 'osm-search' : hasHierarchies ? 'excel-landing' : 'create-hierarchy');
  const [path] = useState<BoundaryPath>(source);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Hierarchy state (Excel path)
  const [existingHierarchies, setExistingHierarchies] = useState<BoundaryHierarchy[]>([]);
  const [selectedHierarchy, setSelectedHierarchy] = useState<BoundaryHierarchy | null>(null);
  const [hierarchyLevels, setHierarchyLevels] = useState(['Country', 'State', 'City', 'Ward']);
  const [hierarchyType, setHierarchyType] = useState('ADMIN');
  const [loadingHierarchies, setLoadingHierarchies] = useState(false);

  // Boundary data state (Excel path)
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [parsedBoundaries, setParsedBoundaries] = useState<BoundaryExcelRow[]>([]);
  const [, setParsedLevels] = useState<string[]>([]);
  const [validBoundaries, setValidBoundaries] = useState<BoundaryExcelRow[]>([]);
  const [invalidBoundaries, setInvalidBoundaries] = useState<{ boundary: BoundaryExcelRow; error: string }[]>([]);

  // Optional polygon sidecar: GeoJSON FeatureCollection that supplies real
  // outlines for the citizen UI's OSM map. Without it every boundary gets
  // the unit-square placeholder that Bomet + Nairobi ship with today.
  const [polygonFile, setPolygonFile] = useState<File | null>(null);
  const [polygonSidecar, setPolygonSidecar] = useState<ParsedGeoJsonSidecar | null>(null);
  const [polygonError, setPolygonError] = useState<string | null>(null);

  // OSM path state
  const [searchTerm, setSearchTerm] = useState('');
  const [adminLevels, setAdminLevels] = useState<OsmAdminLevel[]>([]);
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  // Full turbopass suggestion the operator picked (null once they edit the
  // text again) — its place_id drives the turbopass /boundary/fetch call.
  const [pickedSuggestion, setPickedSuggestion] = useState<any | null>(null);
  const [skippedFeatures, setSkippedFeatures] = useState<SkippedOsmFeature[]>([]);
  const [pendingBoundaries, setPendingBoundaries] = useState<Boundary[]>([]);
  // The place whose boundaries were fetched — named on the level screen.
  const [fetchedPlace, setFetchedPlace] = useState<{ id: string; label: string; country: string | null } | null>(null);
  // Credit line for the fetched data — the official sets' licences require it.
  const [fetchedAttribution, setFetchedAttribution] = useState<string | null>(null);
  const [turbopassSource, setTurbopassSource] = useState(() =>
    chooseTurbopassSource(CONFIGURED_TURBOPASS_SOURCE, null),
  );
  const sourceRef = useRef(turbopassSource);

  // Switching source drops everything the old one returned: a suggestion's
  // place_id only exists in the source that found it. Choosing the source
  // already in use changes nothing — a late /health must not wipe a pick.
  const changeSource = useCallback((next: string) => {
    if (next === sourceRef.current) return;
    sourceRef.current = next;
    setTurbopassSource(next);
    setSuggestions([]);
    setShowSuggestions(false);
    setPickedSuggestion(null);
    setError(null);
  }, []);

  // Once Geography's /health read lands, start on the first source the server
  // can answer, unless the build pins one.
  useEffect(() => {
    if (sourceChoices === null || (CONFIGURED_TURBOPASS_SOURCE ?? '').trim()) return;
    changeSource(chooseTurbopassSource(undefined, sourceChoices));
  }, [sourceChoices, changeSource]);

  // Google Maps (optional, #1994): kept in this tenant's MapConfig, so every
  // map that honours MapConfig switches together.
  const mapProvider = useMapProviderConfig(boundaryTenant);
  const [googleKeyDraft, setGoogleKeyDraft] = useState('');
  const [googleKeyStatus, setGoogleKeyStatus] = useState<{ kind: 'ok' | 'warn' | 'error'; text: string } | null>(null);
  const [savingGoogleKey, setSavingGoogleKey] = useState(false);

  // Recomputed only when the fetched place or the level SELECTION changes —
  // not on every keystroke in a level-name field (the quality check runs the
  // same point-in-polygon build the create step does).
  const levelSelectionKey = `${fetchedPlace?.id ?? ''}|${adminLevels
    .map((l) => `${l.level}:${l.selected ? 1 : 0}`)
    .join(',')}`;
  // Which area contains which is pure geometry: computed once per fetch, then
  // every selection toggle and the create step reuse it.
  const containingParents = useMemo(
    () => computeContainingParents(adminLevels),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the levels' features change only with a new fetch
    [fetchedPlace?.id],
  );
  const boundaryQuality = useMemo(
    () => summarizeBoundaryQuality(adminLevels, containingParents),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the selection; level names don't change it
    [levelSelectionKey],
  );
  const selectedFeatures = useMemo(
    () => ({ type: 'FeatureCollection' as const, features: adminLevels.filter((l) => l.selected).flatMap((l) => l.features) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- redraw the preview only when the selection changes
    [levelSelectionKey],
  );

  // Created boundaries tracking (both paths)
  const [createdCounts, setCreatedCounts] = useState<Record<string, number>>({});
  const [totalCreated, setTotalCreated] = useState(0);

  // Fetch existing hierarchies on mount
  useEffect(() => {
    fetchHierarchies();
  }, [boundaryTenant]);

  const fetchHierarchies = async () => {
    setLoadingHierarchies(true);
    try {
      const hierarchies = await boundaryService.getHierarchies(boundaryTenant);
      setExistingHierarchies(hierarchies);
      if (hierarchies.length > 0) {
        setSelectedHierarchy(hierarchies[0]);
      }
    } catch (err) {
      console.error('Failed to fetch hierarchies:', err);
      // Don't show error - just means no hierarchies exist yet
    } finally {
      setLoadingHierarchies(false);
    }
  };

  // Turbopass type-ahead for the OSM search box. Suggestions are sugar — the
  // operator can always type a name and hit Search — so degrade silently when
  // the proxy isn't deployed: clear suggestions, console.debug at most.
  useEffect(() => {
    if (searchTerm.length <= 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    // Only fetch if showSuggestions is true (meaning user is actively typing, not just selected an item)
    if (!showSuggestions) return;

    let stale = false;
    const timeoutId = setTimeout(async () => {
      try {
        // Only places with areas inside them: anything else can't form a hierarchy.
        const res = await fetch(turbopassSearchUrl(TURBOPASS_BASE, searchTerm, turbopassSource, TURBOPASS_MATCH, true));
        if (!res.ok) throw new Error(`Turbopass boundary search returned ${res.status}`);
        const data = await res.json();
        // An answer for a term or source the operator has since changed is dropped.
        if (!stale) setSuggestions(tagWithSource(data.features, turbopassSource).slice(0, 5));
      } catch (e) {
        console.debug('Turbopass boundary suggestions unavailable', e);
        if (!stale) setSuggestions([]);
      }
    }, 500);

    return () => {
      stale = true;
      clearTimeout(timeoutId);
    };
  }, [searchTerm, showSuggestions, turbopassSource]);

  // ============================================
  // Excel path handlers (develop's original flow)
  // ============================================

  const handleCreateHierarchy = async () => {
    if (!hierarchyType.trim()) {
      setError('Hierarchy type name is required');
      return;
    }
    if (hierarchyType.trim().toUpperCase() === WORKSPACE_HIERARCHY_TYPE) {
      setError(`"${WORKSPACE_HIERARCHY_TYPE}" is reserved for the workspace root. Choose another hierarchy name.`);
      return;
    }

    const validLevels = hierarchyLevels.filter(l => l.trim());
    if (validLevels.length < 2) {
      setError('At least 2 hierarchy levels are required');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const newHierarchy = await boundaryService.createHierarchyFromLevels(
        boundaryTenant,
        hierarchyType,
        validLevels
      );

      setSelectedHierarchy(newHierarchy);
      setExistingHierarchies(prev => [...prev, newHierarchy]);
      addUndo('create_hierarchy', `Created hierarchy: ${hierarchyType}`);
      trackStepAction('geography', 'entity_create', 'boundary', {
        tenant: boundaryTenant,
        source: 'excel',
        kind: 'hierarchy',
        levels: validLevels.length,
      });
      setStep('template');
    } catch (err) {
      console.error('Hierarchy creation error:', err);
      reportStepError('geography', 'create_hierarchy', err, boundaryTenant);
      if (err instanceof ApiClientError) {
        setError(err.firstError);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Failed to create hierarchy. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSelectHierarchy = () => {
    if (!selectedHierarchy) {
      setError('Please select a hierarchy');
      return;
    }
    setStep('template');
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset so the same filename re-fires onChange on the next pick. Without
    // this, after a failed validation the user fixes the workbook + re-picks
    // the same file and nothing happens — the browser de-dupes the change.
    e.target.value = '';
    if (!file) return;

    setError(null);
    setLoading(true);

    try {
      const workbook = await parseExcelFile(file);
      const result = parseBoundaryExcel(workbook);

      if (result.validation.valid) {
        setUploadedFile(file);
        setParsedBoundaries(result.data);
        setParsedLevels(result.hierarchyLevels);

        // Validate boundaries
        validateBoundaries(result.data);
        setStep('verify');
      } else {
        setError(result.validation.errors.map(e => e.message).join(', '));
      }
    } catch (err) {
      console.error('Excel parse error:', err);
      setError('Failed to parse Excel file. Please ensure it is a valid .xlsx file.');
    } finally {
      setLoading(false);
    }
  };

  const handlePolygonUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setPolygonError(null);
    try {
      const text = await file.text();
      const parsed = parseGeoJsonSidecar(text);
      setPolygonFile(file);
      setPolygonSidecar(parsed);
    } catch (err) {
      setPolygonError(err instanceof Error ? err.message : String(err));
      setPolygonFile(null);
      setPolygonSidecar(null);
    }
  };

  const handlePolygonClear = () => {
    setPolygonFile(null);
    setPolygonSidecar(null);
    setPolygonError(null);
  };

  const validateBoundaries = (boundaries: BoundaryExcelRow[]) => {
    const valid: BoundaryExcelRow[] = [];
    const invalid: { boundary: BoundaryExcelRow; error: string }[] = [];
    const existingCodes = new Set<string>();

    // Track codes for parent validation
    boundaries.forEach(b => existingCodes.add(b.code));

    for (const boundary of boundaries) {
      const errors: string[] = [];

      // Check for duplicate codes
      if (!boundary.code) {
        errors.push('Missing boundary code');
      }

      if (!boundary.name) {
        errors.push('Missing boundary name');
      }

      if (!boundary.boundaryType) {
        errors.push('Missing boundary type');
      }

      // Check if parent exists (for non-root boundaries)
      if (boundary.parentCode && !existingCodes.has(boundary.parentCode)) {
        errors.push(`Parent "${boundary.parentCode}" not found`);
      }

      if (errors.length > 0) {
        invalid.push({ boundary, error: errors.join('; ') });
      } else {
        valid.push(boundary);
      }
    }

    setValidBoundaries(valid);
    setInvalidBoundaries(invalid);
  };

  const handleUploadBoundaries = async () => {
    if (!selectedHierarchy || validBoundaries.length === 0) {
      setError('No valid boundaries to upload');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Convert Excel rows to Boundary objects, attaching real geometry
      // (polygon sidecar > lat/long > undefined → service defaults to the
      // unit-square placeholder for unmatched rows).
      const boundariesToCreate: Boundary[] = validBoundaries.map(row => ({
        tenantId: boundaryTenant,
        code: row.code,
        name: row.name,
        boundaryType: row.boundaryType,
        parent: row.parentCode,
        hierarchyType: selectedHierarchy.hierarchyType,
        latitude: row.latitude,
        longitude: row.longitude,
        geometry: geometryForBoundary(row, polygonSidecar ?? undefined),
      }));

      // Create boundaries
      const result = await boundaryService.createBoundaries(boundariesToCreate, (created, total) => {
        // Progress callback
        console.log(`Created ${created}/${total} boundaries`);
      });

      // Track counts by level
      const counts: Record<string, number> = {};
      result.success.forEach(b => {
        counts[b.boundaryType] = (counts[b.boundaryType] || 0) + 1;
      });

      setCreatedCounts(counts);
      setTotalCreated(result.success.length);

      // Localizations + cache-bust + boundary-path repair (shared with OSM path)
      const schemaError = await runPostCreatePipeline(
        boundaryTenant,
        result.success,
        selectedHierarchy.hierarchyType,
        selectedHierarchy.boundaryHierarchy
      );

      addUndo('create_boundaries', `Created ${result.success.length} boundaries`);
      trackStepAction('geography', 'entity_import', 'boundary', {
        tenant: boundaryTenant,
        source: 'excel',
        count: result.success.length,
        failed: result.failed.length,
      });
      setStep('complete');

      const failures = [
        result.failed.length > 0 ? `${result.failed.length} boundaries failed to create.` : null,
        schemaError,
      ].filter(Boolean);
      if (failures.length) setError(failures.join(' '));
    } catch (err) {
      console.error('Boundary upload error:', err);
      reportStepError('geography', 'import_excel', err, boundaryTenant);
      if (err instanceof ApiClientError) {
        setError(err.firstError);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Failed to upload boundaries. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const getHierarchyLevels = (hierarchy: BoundaryHierarchy): string[] => {
    if (!hierarchy.boundaryHierarchy) return [];
    return hierarchy.boundaryHierarchy.map(level => level.boundaryType);
  };

  const handleDownloadTemplate = () => {
    const levels = selectedHierarchy
      ? getHierarchyLevels(selectedHierarchy)
      : hierarchyLevels;
    const type = selectedHierarchy?.hierarchyType || hierarchyType || 'ADMIN';
    downloadBoundaryTemplate(type, levels);
  };

  // ============================================
  // OSM path handlers
  // ============================================

  const handleSearch = async () => {
    const term = searchTerm.trim();
    if (!term) {
      setError("Please enter a location name to search.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      let suggestion = pickedSuggestion;
      if (!suggestion) {
        // The operator hit Search without choosing a suggestion. Resolve the
        // typed term only when exactly one result carries exactly that name;
        // otherwise show the ranked, disambiguated candidates and let the
        // operator choose, rather than taking whatever came back first (#1016:
        // "Delhi" used to resolve to "Delhi Govt Flats").
        const res = await fetch(turbopassSearchUrl(TURBOPASS_BASE, term, turbopassSource, TURBOPASS_MATCH, true));
        if (!res.ok) {
          setError(turbopassErrorMessage({
            kind: 'search', source: turbopassSource, status: res.status, serverMessage: await serverMessage(res),
          }));
          return;
        }
        const data = await res.json();
        const result = pickSuggestion(tagWithSource(data.features, turbopassSource), term);
        if (result.reason === 'no-results' && isOfflineSource(turbopassSource)) {
          // Nothing with areas inside it matched. If the name exists only as a
          // place with nothing inside it, say so — and where it lies.
          const all = await fetch(turbopassSearchUrl(TURBOPASS_BASE, term, turbopassSource, TURBOPASS_MATCH, false))
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null);
          const leaf = all?.features?.[0];
          setError(leaf ? deadEndMessage(leaf) : pickPromptMessage(result, term));
          return;
        }
        if (!result.pick) {
          setSuggestions(result.candidates.slice(0, 5));
          setShowSuggestions(result.candidates.length > 0);
          setError(pickPromptMessage(result, term));
          return;
        }
        suggestion = result.pick;
        setPickedSuggestion(suggestion);
      }

      const placeId = suggestion?.properties?.place_id;
      const placeName = suggestion?.properties?.name || term;
      if (!placeId) {
        setError('Pick a place from the suggestions.');
        return;
      }
      // Overture says up front when nothing lies inside the place (#1016 point 3).
      if (suggestion.properties.descendant_count === 0) {
        setError(deadEndMessage(suggestion));
        return;
      }

      // Fetch from the source that found the place, whatever the dropdown says now.
      const source = fetchSourceFor(suggestion, turbopassSource);
      const res = await fetch(`${TURBOPASS_BASE}/boundary/fetch?id=${encodeURIComponent(placeId)}&source=${encodeURIComponent(source)}`);
      if (!res.ok) {
        setError(turbopassErrorMessage({
          kind: 'fetch', source, status: res.status, serverMessage: await serverMessage(res), place: placeName,
        }));
        return;
      }
      const geojson = await res.json();

      // The fetch returns the picked place and what lies inside it — never
      // anything above it — so every polygon with an admin level belongs. The
      // old target-level detection name-matched the search term against the
      // features and could latch onto the wrong one (#1016 point 1).
      const extractedLevels = groupFetchedLevels(geojson.features);

      if (extractedLevels.length === 0) {
        setError(`No administrative boundaries came back for "${placeName}". Try a different place.`);
        return;
      }
      // A hierarchy needs two levels. Stop here with the reason rather than
      // open a level screen that can't be completed (#1016 point 3) — this is
      // the check that covers Geoapify, which can't say so up front.
      if (extractedLevels.length < 2) {
        setError(tooFewLevelsMessage(suggestion, (geojson.features ?? []).length));
        return;
      }

      setFetchedPlace({
        id: placeId,
        label: suggestion.properties.formatted || placeName,
        country: suggestion.properties.country_name || null,
      });
      setFetchedAttribution(attributionLine(geojson.features));
      setAdminLevels(extractedLevels);
      setStep('map-levels');
    } catch (e) {
      console.error(e);
      setError(turbopassErrorMessage({ kind: 'network', source: turbopassSource }));
    } finally {
      setLoading(false);
    }
  };

  // Google Maps key (optional, #1994): check it with Google first, then store
  // it in this tenant's MapConfig so every map that reads MapConfig switches.
  const saveGoogleMapsKey = async () => {
    const key = googleKeyDraft.trim();
    setSavingGoogleKey(true);
    setGoogleKeyStatus(null);
    let check: GoogleKeyCheck | null = null;
    try {
      try {
        check = await validateGoogleMapsKey(key);
      } catch (e) {
        setGoogleKeyStatus({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
        return;
      }
      await mdmsService.upsertMapConfig(boundaryTenant, { mapProvider: 'google', googleMapsApiKey: key });
      await mapProvider.reload();
      setGoogleKeyDraft('');
      setGoogleKeyStatus(check === 'ok'
        ? { kind: 'ok', text: `Saved. Maps for ${boundaryTenant} now draw on Google Maps.` }
        : {
            kind: 'warn',
            text: `Saved, but Google didn't confirm the key in time, so it isn't verified. If Google rejects it later, ` +
              `maps for ${boundaryTenant} fall back to OpenStreetMap tiles and say why.`,
          });
    } catch (e) {
      setGoogleKeyStatus({
        kind: 'error',
        text: `${check === 'ok' ? 'Google accepted the key' : "Google didn't confirm the key in time"}, and saving it to Map Config failed: ${e instanceof Error ? e.message : String(e)}. ` +
          'A deployment whose MapConfig schema predates the mapProvider field rejects it — see docs/features/maps/README.md.',
      });
    } finally {
      setSavingGoogleKey(false);
    }
  };

  const switchToOpenStreetMap = async () => {
    setSavingGoogleKey(true);
    setGoogleKeyStatus(null);
    try {
      await mdmsService.upsertMapConfig(boundaryTenant, { mapProvider: 'leaflet' });
      await mapProvider.reload();
      setGoogleKeyStatus({ kind: 'ok', text: `Maps for ${boundaryTenant} are back on OpenStreetMap tiles.` });
    } catch (e) {
      setGoogleKeyStatus({ kind: 'error', text: `Couldn't update Map Config: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setSavingGoogleKey(false);
    }
  };

  // Build the boundary payload from the mapped levels. Features that are
  // unnamed or whose centroid lands in no immediate-parent polygon are
  // EXCLUDED (never silently re-parented) — if any were dropped, show the
  // review step so the operator knows exactly what's missing before create.
  const handlePrepareOsmCreate = () => {
    const { valid, error: selError } = validateLevelSelection(adminLevels);
    if (!valid) {
      setError(selError);
      return;
    }
    setError(null);

    const sortedLevels = getSelectedLevels(adminLevels);
    const { boundaries, skipped } = buildOsmBoundaries(sortedLevels, boundaryTenant, OSM_HIERARCHY_TYPE, containingParents);

    if (boundaries.length === 0) {
      setError("All fetched features were skipped (unnamed, name not romanizable, or no parent found). Nothing to create.");
      return;
    }

    setPendingBoundaries(boundaries);
    setSkippedFeatures(skipped);

    if (skipped.length > 0) {
      setStep('osm-review');
    } else {
      void runOsmCreate(boundaries);
    }
  };

  const runOsmCreate = async (boundariesToCreate: Boundary[]) => {
    const validLevels = getSelectedLevels(adminLevels);
    const levelNames = validLevels.map(l => l.mappedName.trim());

    if (OSM_HIERARCHY_TYPE === WORKSPACE_HIERARCHY_TYPE) {
      setError(`"${WORKSPACE_HIERARCHY_TYPE}" is reserved for the workspace root. Set HIERARCHY_TYPE to another hierarchy name.`);
      return;
    }

    setLoading(true);
    setError(null);
    setStep('creating');

    try {
      // Step 1: Create Hierarchy
      try {
        await boundaryService.createHierarchyFromLevels(
          boundaryTenant,
          OSM_HIERARCHY_TYPE,
          levelNames
        );
        addUndo('create_hierarchy', `Created hierarchy: ${OSM_HIERARCHY_TYPE}`);
      } catch (e: any) {
        const msg = String(e?.message || e);
        if (msg.toLowerCase().includes('already exist') || msg.includes('DUPLICATE')) {
          // An ADMIN hierarchy already exists. Proceeding blindly is only
          // safe when its level names match the operator's mapping — if they
          // differ, every boundary create fails slowly (validation retries)
          // with a misleading error. Compare order-sensitively and abort
          // with a clear message when they diverge.
          const hierarchies = await boundaryService.getHierarchies(boundaryTenant);
          const existing = hierarchies.find(h => h.hierarchyType === OSM_HIERARCHY_TYPE);
          const existingLevels = (existing?.boundaryHierarchy ?? []).map(l => l.boundaryType);
          const sameLevels =
            existingLevels.length === levelNames.length &&
            existingLevels.every((lvlName, idx) => lvlName === levelNames[idx]);
          if (!sameLevels) {
            setError(
              `A "${OSM_HIERARCHY_TYPE}" hierarchy already exists on ${boundaryTenant} with levels ` +
              `[${existingLevels.join(' → ')}], which do not match your mapped levels ` +
              `[${levelNames.join(' → ')}]. Boundaries cannot be created against mismatched ` +
              `level names. Either rename your mapped levels to match the existing hierarchy, ` +
              `or use the Excel path's "use existing hierarchy" option.`
            );
            setStep('map-levels');
            return;
          }
          console.log("Hierarchy already exists with matching levels, proceeding to create boundaries...");
        } else {
          throw e;
        }
      }

      // Create boundaries
      const result = await boundaryService.createBoundaries(boundariesToCreate, () => {});

      const counts: Record<string, number> = {};
      result.success.forEach(b => {
        counts[b.boundaryType] = (counts[b.boundaryType] || 0) + 1;
      });

      setCreatedCounts(counts);
      setTotalCreated(result.success.length);

      if (result.success.length > 0) {
        addUndo('create_boundaries', `Created ${result.success.length} boundaries from OSM data`);
      }

      // Localizations + cache-bust + boundary-path repair (shared with Excel path)
      const schemaError = await runPostCreatePipeline(
        boundaryTenant,
        result.success,
        OSM_HIERARCHY_TYPE,
        levelNames.map(n => ({ boundaryType: n }))
      );

      trackStepAction('geography', 'entity_import', 'boundary', {
        tenant: boundaryTenant,
        source: 'osm',
        count: result.success.length,
        failed: result.failed.length,
        levels: levelNames.length,
      });
      setStep('complete');

      const failures = [
        result.failed.length > 0 ? `${result.failed.length} boundaries failed to create.` : null,
        schemaError,
      ].filter(Boolean);
      if (failures.length) setError(failures.join(' '));
    } catch (e) {
      console.error(e);
      reportStepError('geography', 'import_osm', e, boundaryTenant);
      setError(e instanceof Error ? e.message : "Failed to create boundaries.");
      setStep('map-levels');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Hidden file picker. Lives at page root so the "Re-upload Fixed File"
          button in the `verify` step can trigger it — the dropzone (and the
          original input) only exist while step === 'template', so on `verify`
          the previous getElementById call would return null and silently
          no-op (CCRS#563). */}
      <input
        id="boundary-file-upload"
        type="file"
        accept=".xlsx,.xls"
        onChange={handleFileUpload}
        className="hidden"
        disabled={loading}
      />
      {/* Hidden picker for the optional polygon GeoJSON sidecar — opens
          from the "Polygon outlines (optional)" picker rendered on the
          template & verify steps. */}
      <input
        id="boundary-polygon-upload"
        type="file"
        accept=".geojson,.json,application/geo+json,application/json"
        onChange={handlePolygonUpload}
        className="hidden"
        disabled={loading}
      />
      {/* Error display */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="flex items-center justify-between">
            <span>{error}</span>
            <Button variant="ghost" size="sm" onClick={() => setError(null)} className="h-6 w-6 p-0">
              <X className="h-4 w-4" />
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Excel landing: new vs existing hierarchy */}
      {step === 'excel-landing' && (
        <DigitCard>
          <SubHeader>Add to an existing hierarchy or start a new one?</SubHeader>

          <div className="grid sm:grid-cols-2 gap-4">
            <button
              onClick={() => setStep('select-hierarchy')}
              disabled={loadingHierarchies}
              className="flex flex-col rounded-lg border border-border bg-card p-4 text-left transition-colors hover:border-primary/60 hover:bg-primary/5 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="w-10 h-10 rounded-md bg-primary/10 text-primary flex items-center justify-center">
                {loadingHierarchies ? <Loader2 className="w-5 h-5 animate-spin" /> : <FolderOpen className="w-5 h-5" />}
              </span>
              <span className="mt-3 text-base font-medium text-foreground">Use an existing hierarchy</span>
              <span className="mt-1 text-sm text-muted-foreground">
                {existingHierarchies.length === 1
                  ? 'Upload more areas into the hierarchy you already have.'
                  : `Upload more areas into one of your ${existingHierarchies.length} hierarchies.`}
              </span>
            </button>

            <button
              onClick={() => setStep('create-hierarchy')}
              className="flex flex-col rounded-lg border border-border bg-card p-4 text-left transition-colors hover:border-primary/60 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="w-10 h-10 rounded-md bg-primary/10 text-primary flex items-center justify-center">
                <Plus className="w-5 h-5" />
              </span>
              <span className="mt-3 text-base font-medium text-foreground">Create a new hierarchy</span>
              <span className="mt-1 text-sm text-muted-foreground">Define its levels, like County → Sub-county → Ward.</span>
            </button>
          </div>

          <div className="mt-6">
            <Button variant="ghost" size="sm" onClick={onCancel} className="gap-1.5 text-primary hover:text-primary">
              <ArrowLeft className="w-4 h-4" />
              Back
            </Button>
          </div>
        </DigitCard>
      )}

      {/* Create Hierarchy */}
      {step === 'create-hierarchy' && (
        <DigitCard>
          <SubHeader>Create Boundary Hierarchy</SubHeader>
          <p className="text-xs sm:text-sm text-muted-foreground mb-4 sm:mb-6">Define the boundary hierarchy for tenant: <span className="text-primary font-medium">{boundaryTenant.toUpperCase()}</span></p>

          <div className="space-y-6">
            <LabelFieldPair>
              <CardLabel required>Hierarchy Type Name</CardLabel>
              <Field>
                <Input
                  id="hierarchyType"
                  value={hierarchyType}
                  onChange={(e) => setHierarchyType(e.target.value)}
                  placeholder="ADMIN"
                  className="border-input-border focus:border-primary"
                />
                <p className="text-xs text-muted-foreground mt-1">Common types: ADMIN, REVENUE, ADMIN1, ADMIN2</p>
              </Field>
            </LabelFieldPair>

            <div className="mb-4 sm:mb-6">
              <CardLabel className="mb-2">Define Levels (top to bottom)</CardLabel>
              <div className="border border-border rounded p-3 sm:p-4 mt-2 bg-muted/30">
                {hierarchyLevels.map((level, idx) => (
                  <div key={idx} className="flex items-center gap-2 sm:gap-3 mb-3 last:mb-0">
                    <span className="text-xs sm:text-sm text-muted-foreground w-14 sm:w-16 flex-shrink-0 font-condensed">Level {idx + 1}:</span>
                    <Input
                      value={level}
                      onChange={(e) => {
                        const newLevels = [...hierarchyLevels];
                        newLevels[idx] = e.target.value;
                        setHierarchyLevels(newLevels);
                      }}
                      className="flex-1 border-input-border focus:border-primary"
                    />
                    {idx === 0 && <span className="text-xs text-primary hidden sm:inline">[Root]</span>}
                    {idx === hierarchyLevels.length - 1 && <span className="text-xs text-primary hidden sm:inline">[Lowest]</span>}
                    {hierarchyLevels.length > 2 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setHierarchyLevels(hierarchyLevels.filter((_, i) => i !== idx))}
                        className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setHierarchyLevels([...hierarchyLevels, ''])}
                  className="mt-3 border-primary text-primary hover:bg-primary/10"
                >
                  <Plus className="w-4 h-4 mr-1" /> Add Level
                </Button>
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row justify-between gap-3 sm:gap-0 mt-6">
            <Button variant="ghost" size="sm" onClick={hasHierarchies ? () => setStep('excel-landing') : onCancel} className="gap-1.5 text-primary hover:text-primary">
              <ArrowLeft className="w-4 h-4" />
              Back
            </Button>
            <SubmitBar
              label={loading ? 'Creating...' : 'Create Hierarchy'}
              onSubmit={handleCreateHierarchy}
              disabled={loading}
              icon={loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ChevronRight className="w-4 h-4" />}
            />
          </div>
        </DigitCard>
      )}

      {/* Select Hierarchy */}
      {step === 'select-hierarchy' && (
        <DigitCard>
          <div className="flex items-center justify-between mb-4 sm:mb-6">
            <div>
              <SubHeader>Select Existing Hierarchy</SubHeader>
              <p className="text-xs sm:text-sm text-muted-foreground">Available hierarchies for tenant: <span className="text-primary font-medium">{boundaryTenant.toUpperCase()}</span></p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={fetchHierarchies}
              disabled={loadingHierarchies}
              className="text-primary"
            >
              <RefreshCw className={`w-4 h-4 ${loadingHierarchies ? 'animate-spin' : ''}`} />
            </Button>
          </div>

          {existingHierarchies.length === 0 ? (
            <div className="text-center py-8">
              <MapPin className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground mb-4">No hierarchies found for this tenant.</p>
              <Button
                variant="outline"
                onClick={() => setStep('create-hierarchy')}
                className="border-primary text-primary"
              >
                <Plus className="w-4 h-4 mr-2" /> Create New Hierarchy
              </Button>
            </div>
          ) : (
            <div className="space-y-3 mb-4 sm:mb-6">
              {existingHierarchies.map((hierarchy) => (
                <button
                  key={hierarchy.hierarchyType}
                  onClick={() => setSelectedHierarchy(hierarchy)}
                  className={`w-full p-3 sm:p-4 border-2 rounded text-left transition-all ${
                    selectedHierarchy?.hierarchyType === hierarchy.hierarchyType
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-primary/50'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                      selectedHierarchy?.hierarchyType === hierarchy.hierarchyType ? 'border-primary bg-primary' : 'border-muted-foreground'
                    }`}>
                      {selectedHierarchy?.hierarchyType === hierarchy.hierarchyType && <Check className="w-3 h-3 text-primary-foreground" />}
                    </div>
                    <div className="min-w-0">
                      <p className="font-condensed font-medium text-foreground text-sm sm:text-base">{hierarchy.hierarchyType}</p>
                      <p className="text-xs sm:text-sm text-muted-foreground truncate">
                        Levels: <span className="text-primary">{getHierarchyLevels(hierarchy).join(' → ')}</span>
                      </p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          <div className="flex flex-col sm:flex-row justify-between gap-3 sm:gap-0">
            <Button variant="ghost" size="sm" onClick={() => setStep('excel-landing')} className="gap-1.5 text-primary hover:text-primary"><ArrowLeft className="w-4 h-4" />Back</Button>
            <SubmitBar
              label="Use Selected Hierarchy"
              onSubmit={handleSelectHierarchy}
              disabled={!selectedHierarchy}
              icon={<ChevronRight className="w-4 h-4" />}
            />
          </div>
        </DigitCard>
      )}

      {/* Template */}
      {step === 'template' && selectedHierarchy && (
        <DigitCard>
          <SubHeader>Boundary Data Upload</SubHeader>
          <p className="text-xs sm:text-sm text-muted-foreground mb-4 sm:mb-6">
            Hierarchy: <span className="text-primary font-medium">{selectedHierarchy.hierarchyType}</span> •
            Levels: <span className="text-primary">{getHierarchyLevels(selectedHierarchy).join(' → ')}</span>
          </p>

          <div className="p-4 bg-primary/5 border border-primary/20 rounded mb-4 sm:mb-6">
            <div className="flex items-center gap-2 text-primary mb-2">
              <Download className="w-5 h-5" />
              <strong className="text-sm font-condensed">Download Template</strong>
            </div>
            <p className="text-xs sm:text-sm mb-2 text-foreground">Boundary_Template_{selectedHierarchy.hierarchyType}.xlsx</p>
            <p className="text-xs sm:text-sm mb-2 text-muted-foreground">Required columns:</p>
            <ul className="text-xs sm:text-sm space-y-1 mb-3 sm:mb-4 text-muted-foreground">
              <li>• <strong>code</strong> - Unique boundary code</li>
              <li>• <strong>name</strong> - Display name</li>
              <li>• <strong>boundaryType</strong> - Level type ({getHierarchyLevels(selectedHierarchy).join(', ')})</li>
              <li>• <strong>parentCode</strong> - Parent boundary code (optional for root)</li>
            </ul>
            <Button size="sm" className="bg-primary hover:bg-primary/90 text-white" onClick={handleDownloadTemplate}>
              <Download className="w-4 h-4 mr-2" />
              Download Template
            </Button>
          </div>

          <div
            className="border-2 border-dashed border-primary/30 rounded p-6 sm:p-8 text-center hover:border-primary hover:bg-primary/5 transition-colors cursor-pointer mb-4"
            onClick={() => document.getElementById('boundary-file-upload')?.click()}
          >
            {loading ? (
              <>
                <Loader2 className="w-8 h-8 text-primary mx-auto mb-3 animate-spin" />
                <p className="text-sm font-condensed font-medium text-foreground">Parsing Excel file...</p>
              </>
            ) : (
              <>
                <Upload className="w-8 h-8 text-primary mx-auto mb-3" />
                <p className="text-sm font-condensed font-medium text-foreground mb-2">
                  Drop your filled boundary template here
                </p>
                <p className="text-xs text-muted-foreground">or click to browse</p>
              </>
            )}
          </div>

          {/* Hint about the optional polygon sidecar — the actual picker
              lives on the verify step (after XLSX parse). Putting it here
              would be invisible: handleFileUpload immediately transitions
              to 'verify' the moment a file is dropped. */}
          <p className="text-xs text-muted-foreground mb-4 flex items-center gap-2">
            <MapPin className="w-3 h-3 inline" />
            After upload, you'll be able to attach an optional GeoJSON file for real boundary outlines on the map.
          </p>

          <Alert variant="warning" className="mb-4 sm:mb-6">
            <AlertTriangle className="w-4 h-4" />
            <AlertDescription>
              <strong className="block mb-2 text-sm">Important Rules:</strong>
              <ul className="text-xs sm:text-sm space-y-1">
                <li>• Each boundary must have a unique code</li>
                <li>• Parent boundary must exist before child</li>
                <li>• Do not skip hierarchy levels</li>
              </ul>
            </AlertDescription>
          </Alert>

          <div className="flex flex-col sm:flex-row justify-between gap-3 sm:gap-0">
            <Button variant="ghost" size="sm" onClick={() => setStep('excel-landing')} className="gap-1.5 text-primary hover:text-primary"><ArrowLeft className="w-4 h-4" />Back</Button>
          </div>
        </DigitCard>
      )}

      {/* Verify */}
      {step === 'verify' && selectedHierarchy && (
        <DigitCard>
          <SubHeader>Verify Boundary Data</SubHeader>

          <div className="flex items-center gap-2 text-primary mb-3 sm:mb-4">
            <Check className="w-4 h-4 sm:w-5 sm:h-5" />
            <span className="text-sm sm:text-base truncate">File: {uploadedFile?.name}</span>
          </div>

          {/* Optional polygon GeoJSON sidecar — real outlines for the
              citizen UI's OSM map. Without it boundaries land with the
              unit-square placeholder (same as Bomet/Naipepea today).
              Match by `properties.code` (preferred) or normalized
              `properties.name`. Sits on the verify step because the
              template step transitions away the instant an XLSX drops. */}
          <div
            className="border border-dashed border-primary/30 rounded p-4 mb-4 hover:border-primary/60 transition-colors cursor-pointer"
            onClick={() => !polygonFile && document.getElementById('boundary-polygon-upload')?.click()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-foreground mb-1">
                  <MapPin className="w-4 h-4 text-primary" />
                  <strong className="text-sm font-condensed">Polygon outlines (optional)</strong>
                </div>
                {!polygonFile && !polygonError && (
                  <p className="text-xs text-muted-foreground">
                    Drop a GeoJSON FeatureCollection to draw real boundary outlines on the citizen map.
                    Skip to use the default placeholder shape.
                  </p>
                )}
                {polygonFile && polygonSidecar && (() => {
                  const matched = validBoundaries.filter(r =>
                    geometryForBoundary(r, polygonSidecar)?.type === 'Polygon'
                  ).length;
                  return (
                    <p className="text-xs text-muted-foreground">
                      <span className="text-primary font-medium">{polygonFile.name}</span>
                      {' '}— <span className="text-primary font-medium">{matched}</span> of {validBoundaries.length} boundaries will get real outlines
                      {' '}({polygonSidecar.totalFeatures} features in file, {polygonSidecar.matchedByCode} matched by code, {polygonSidecar.matchedByName} by name).
                    </p>
                  );
                })()}
                {polygonError && (
                  <p className="text-xs text-destructive">{polygonError}</p>
                )}
              </div>
              {polygonFile ? (
                <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); handlePolygonClear(); }} className="h-6 w-6 p-0 shrink-0">
                  <X className="h-4 w-4" />
                </Button>
              ) : (
                <Upload className="w-5 h-5 text-primary shrink-0" />
              )}
            </div>
          </div>

          <div className="overflow-x-auto -mx-4 sm:mx-0 mb-3 sm:mb-4">
            <div className="px-4 sm:px-0">
              <Tabs defaultValue="all">
                <TabsList className="w-full sm:w-auto flex-wrap h-auto gap-1 p-1 bg-muted">
                  <TabsTrigger value="all" className="text-xs sm:text-sm data-[state=active]:bg-primary data-[state=active]:text-white">
                    All ({parsedBoundaries.length})
                  </TabsTrigger>
                  <TabsTrigger value="valid" className="text-xs sm:text-sm data-[state=active]:bg-success data-[state=active]:text-white">
                    Valid ({validBoundaries.length})
                  </TabsTrigger>
                  <TabsTrigger value="errors" className="text-xs sm:text-sm data-[state=active]:bg-destructive data-[state=active]:text-white">
                    Errors ({invalidBoundaries.length})
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="all" className="mt-4">
                  <BoundaryTable boundaries={parsedBoundaries} invalidBoundaries={invalidBoundaries} />
                </TabsContent>

                <TabsContent value="valid" className="mt-4">
                  <BoundaryTable boundaries={validBoundaries} invalidBoundaries={[]} />
                </TabsContent>

                <TabsContent value="errors" className="mt-4">
                  {invalidBoundaries.length > 0 ? (
                    <BoundaryTable
                      boundaries={invalidBoundaries.map(i => i.boundary)}
                      invalidBoundaries={invalidBoundaries}
                    />
                  ) : (
                    <p className="text-muted-foreground text-center py-4">No errors found</p>
                  )}
                </TabsContent>
              </Tabs>
            </div>
          </div>

          <p className="text-xs sm:text-sm text-muted-foreground mb-4 sm:mb-6">
            Summary: {parsedBoundaries.length} total |
            <span className="text-success"> {validBoundaries.length} valid</span> |
            <span className="text-destructive"> {invalidBoundaries.length} errors</span>
          </p>

          <div className="flex flex-col sm:flex-row justify-between gap-3 sm:gap-0">
            <Button variant="ghost" size="sm" onClick={() => setStep('template')} className="gap-1.5 text-primary hover:text-primary"><ArrowLeft className="w-4 h-4" />Back</Button>
            <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
              {invalidBoundaries.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => document.getElementById('boundary-file-upload')?.click()}
                  className="border-primary text-primary hover:bg-primary/10"
                >
                  Re-upload Fixed File
                </Button>
              )}
              <SubmitBar
                label={loading ? 'Uploading...' : `Upload ${validBoundaries.length} Boundaries`}
                onSubmit={handleUploadBoundaries}
                disabled={loading || validBoundaries.length === 0}
                icon={loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ChevronRight className="w-4 h-4" />}
              />
            </div>
          </div>
        </DigitCard>
      )}

      {/* OSM: search */}
      {step === 'osm-search' && (
        <DigitCard>
          <div className="border border-border rounded-xl p-8 bg-card text-center space-y-4">
            <Search className="h-12 w-12 mx-auto text-primary opacity-80" />
            <h2 className="text-xl font-semibold">Fetch boundaries</h2>
            <p className="text-muted-foreground max-w-md mx-auto">
              Enter the name of your city or region to fetch its administrative boundaries and their map polygons.
            </p>

            {sourceChoices && sourceChoices.length > 0 && (
              <div className="max-w-sm mx-auto text-left space-y-1">
                <label htmlFor="boundary-source" className="text-sm font-medium">Boundary source</label>
                <Select value={turbopassSource} onValueChange={changeSource} disabled={loading}>
                  <SelectTrigger id="boundary-source" data-testid="boundary-source">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(sourceChoices.includes(turbopassSource) ? sourceChoices : [turbopassSource, ...sourceChoices]).map((s) => (
                      <SelectItem key={s} value={s}>{sourceOptionLabel(s)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="relative max-w-sm mx-auto pt-4">
              <div className="flex space-x-2">
                <Input
                  placeholder="e.g., Maputo"
                  value={searchTerm}
                  onChange={(e) => {
                    setSearchTerm(e.target.value);
                    setPickedSuggestion(null);
                    setShowSuggestions(true);
                  }}
                  disabled={loading}
                />
                <Button onClick={handleSearch} disabled={!searchTerm || loading}>
                  {loading ? <Loader2 className="animate-spin h-4 w-4 mr-2" /> : null}
                  Search
                </Button>
              </div>

              {showSuggestions && suggestions.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-popover text-popover-foreground border rounded-md shadow-md overflow-hidden">
                  <ul className="py-1">
                    {suggestions.map((item, i) => {
                      const { text, type } = formatSuggestionLabel(item);
                      return (
                        <li
                          key={i}
                          className="px-3 py-2 cursor-pointer hover:bg-accent hover:text-accent-foreground text-left text-sm flex items-center justify-between"
                          onClick={() => {
                            // The place's own name, not the long label —
                            // handleSearch compares it for an exact name match.
                            setSearchTerm(item.properties?.name || item.name || text);
                            setPickedSuggestion(item);
                            setShowSuggestions(false);
                          }}
                        >
                          <span className="truncate pr-2">{text}</span>
                          <span className="opacity-50 text-xs flex-shrink-0">{type}</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>

            <div className="max-w-sm mx-auto pt-6 text-left">
              <details className="rounded-lg border border-border px-4 py-3" open={mapProvider.provider === 'google' || !!googleKeyStatus}>
                <summary className="cursor-pointer text-sm font-medium">
                  Map provider: {mapProvider.provider === 'google' ? 'Google Maps' : 'OpenStreetMap tiles'} (optional)
                </summary>
                <div className="space-y-3 pt-3 text-sm">
                  <p className="text-muted-foreground">
                    Boundaries come from {sourceLabel(turbopassSource)} either way — a Google Maps key only changes the
                    map they are drawn on, here and on the boundary pages. It is saved in this tenant's Map Config and sent
                    to every browser that shows a map, so restrict it to this site in Google Cloud Console.
                  </p>
                  <div className="flex gap-2">
                    <Input
                      type="password"
                      autoComplete="off"
                      placeholder={mapProvider.googleMapsApiKey ? 'Replace the saved key' : 'Google Maps JavaScript API key'}
                      value={googleKeyDraft}
                      onChange={(e) => setGoogleKeyDraft(e.target.value)}
                      disabled={savingGoogleKey}
                    />
                    <Button variant="outline" onClick={saveGoogleMapsKey} disabled={!googleKeyDraft.trim() || savingGoogleKey}>
                      {savingGoogleKey ? <Loader2 className="animate-spin h-4 w-4" /> : 'Save'}
                    </Button>
                  </div>
                  {mapProvider.provider === 'google' && (
                    <Button variant="link" size="sm" className="px-0 h-auto" onClick={switchToOpenStreetMap} disabled={savingGoogleKey}>
                      Switch back to OpenStreetMap tiles
                    </Button>
                  )}
                  {googleKeyStatus && (
                    <p className={googleKeyStatus.kind === 'ok' ? 'text-green-700' : googleKeyStatus.kind === 'warn' ? 'text-amber-700' : 'text-destructive'}>{googleKeyStatus.text}</p>
                  )}
                </div>
              </details>
            </div>
          </div>

          <div className="mt-6">
            <Button variant="ghost" size="sm" onClick={onCancel} className="gap-1.5 text-primary hover:text-primary">
              <ArrowLeft className="w-4 h-4" />
              Back
            </Button>
          </div>
        </DigitCard>
      )}

      {/* OSM: map admin levels to hierarchy names */}
      {step === 'map-levels' && (() => {
        const levelSel = validateLevelSelection(adminLevels);
        return (
        <DigitCard>
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <Header>Map Admin Levels</Header>
            <SubHeader>
              We found {adminLevels.length} levels of administrative boundaries for {fetchedPlace?.label || searchTerm}.
              Tick the levels to include and name each — the selection must be a
              contiguous range (you can drop the outer levels, but not skip one in the middle).
            </SubHeader>
            {fetchedAttribution && (
              <p className="text-xs text-muted-foreground" data-testid="boundary-attribution">{fetchedAttribution}</p>
            )}

            {boundaryQuality && (
              <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm space-y-2">
                <div className="font-medium">
                  Data check for the selected levels: {boundaryQuality.totalAreas.toLocaleString()} areas,{' '}
                  {boundaryQuality.kept.toLocaleString()} will be created
                  {boundaryQuality.skipped > 0 ? `, ${boundaryQuality.skipped.toLocaleString()} skipped` : ''}
                </div>
                <ul className="space-y-1 text-muted-foreground">
                  {boundaryQuality.levels.map((q) => (
                    <li key={q.level}>
                      Level {q.level}: {q.kept.toLocaleString()} of {q.total.toLocaleString()} areas
                      {q.parentsTotal != null && ` · present in ${q.parentsCovered} of ${q.parentsTotal} areas of the level above`}
                      {q.noParent > 0 && ` · ${q.noParent} lie in no area of the level above (skipped)`}
                      {q.unnamed > 0 && ` · ${q.unnamed} unnamed (skipped)`}
                    </li>
                  ))}
                </ul>
                {boundaryQuality.levels.some((q) => q.parentsTotal != null && (q.parentsCovered ?? 0) < q.parentsTotal) && (
                  <p className="text-xs text-muted-foreground">
                    An area with nothing inside it at the next level is where the map data stops: it becomes a leaf of
                    your hierarchy.
                  </p>
                )}
              </div>
            )}

            <BoundaryMap data={selectedFeatures} height="320px" google={mapProvider.google} />

            <div className="space-y-4 pt-4">
              {adminLevels.map((lvl, index) => (
                <div
                  key={lvl.level}
                  className={`border p-6 rounded-lg space-y-4 transition-colors ${lvl.selected ? 'bg-card/50' : 'bg-muted/30 opacity-60'}`}
                >
                  <div className="flex justify-between items-start gap-3">
                    <label className="flex items-start gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        className="mt-1.5 h-4 w-4 accent-primary cursor-pointer"
                        checked={lvl.selected}
                        disabled={loading}
                        onChange={(e) => {
                          const newLevels = [...adminLevels];
                          newLevels[index] = { ...newLevels[index], selected: e.target.checked };
                          setAdminLevels(newLevels);
                        }}
                      />
                      <span>
                        <h3 className="font-medium text-lg flex items-center">
                          Level {lvl.level}
                          <Badge variant="outline" className="ml-2 bg-background">
                            {lvl.features.length} regions
                          </Badge>
                        </h3>
                        <p className="text-sm text-muted-foreground mt-1">
                          Examples: {lvl.examples.join(', ')}{lvl.examples.length < lvl.features.length ? ', etc.' : ''}
                        </p>
                      </span>
                    </label>
                  </div>

                  {lvl.selected && (
                    <div className="pt-2">
                      <label className="text-sm font-medium mb-1.5 block">Hierarchy Name</label>
                      <Input
                        placeholder="e.g., District"
                        value={lvl.mappedName}
                        onChange={(e) => {
                          const newLevels = [...adminLevels];
                          newLevels[index] = { ...newLevels[index], mappedName: e.target.value };
                          setAdminLevels(newLevels);
                        }}
                        disabled={loading}
                      />
                      {lvl.suggestedName && lvl.mappedName === lvl.suggestedName && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Suggested: what {fetchedPlace?.country || 'this country'} calls this level. Edit it if your tenant uses another name.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {!levelSel.valid && levelSel.error && (
              <Alert variant="warning">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{levelSel.error}</AlertDescription>
              </Alert>
            )}

            <div className="flex flex-col sm:flex-row justify-between gap-3 sm:gap-0">
              <Button variant="ghost" size="sm" onClick={() => setStep('osm-search')} className="gap-1.5 text-primary hover:text-primary"><ArrowLeft className="w-4 h-4" />Back</Button>
              <SubmitBar
                label={loading ? "Creating..." : "Create Hierarchy & Boundaries"}
                onSubmit={handlePrepareOsmCreate}
                disabled={loading || !levelSel.valid}
              />
            </div>
          </div>
        </DigitCard>
        );
      })()}

      {/* OSM: review skipped features before create */}
      {step === 'osm-review' && (
        <DigitCard>
          <SubHeader>Review Before Creating</SubHeader>

          <Alert variant="warning" className="mb-4 sm:mb-6">
            <AlertTriangle className="w-4 h-4" />
            <AlertDescription>
              <strong className="block mb-2 text-sm">
                {skippedFeatures.length} feature(s) will be SKIPPED:
              </strong>
              <ul className="text-xs sm:text-sm space-y-1 max-h-64 overflow-y-auto">
                {skippedFeatures.map((s, i) => (
                  <li key={i}>
                    • <span className="font-medium">{s.name}</span>
                    {' '}— {s.levelName} (OSM level {s.osmLevel}) —
                    {' '}<span className="text-destructive">{s.reason}</span>
                  </li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>

          <p className="text-xs sm:text-sm text-muted-foreground mb-4 sm:mb-6">
            Unnamed features and features whose centroid falls in no parent boundary are
            excluded rather than guessed. If these matter, fix them in OpenStreetMap (or
            use the Excel path) and re-run the search. Creation proceeds with the
            remaining <span className="text-primary font-medium">{pendingBoundaries.length}</span> boundaries.
          </p>

          <div className="flex flex-col sm:flex-row justify-between gap-3 sm:gap-0">
            <Button variant="ghost" size="sm" onClick={() => setStep('map-levels')} className="gap-1.5 text-primary hover:text-primary"><ArrowLeft className="w-4 h-4" />Back</Button>
            <SubmitBar
              label={loading ? 'Creating...' : `Create ${pendingBoundaries.length} Boundaries`}
              onSubmit={() => runOsmCreate(pendingBoundaries)}
              disabled={loading}
              icon={loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ChevronRight className="w-4 h-4" />}
            />
          </div>
        </DigitCard>
      )}

      {/* OSM: creating */}
      {step === 'creating' && (
        <DigitCard>
          <div className="py-24 text-center space-y-6">
            <Loader2 className="h-16 w-16 mx-auto text-primary animate-spin" />
            <div className="space-y-2">
              <h2 className="text-2xl font-semibold">Creating Boundaries</h2>
              <p className="text-muted-foreground">
                Building geographic hierarchy and writing polygons to the database...
              </p>
            </div>
          </div>
        </DigitCard>
      )}

      {/* Complete: Excel path */}
      {step === 'complete' && path === 'excel' && selectedHierarchy && (
        <DigitCard>
          <Banner
            successful={true}
            message="Boundaries created"
            info={`Hierarchy: ${selectedHierarchy.hierarchyType} • Tenant: ${boundaryTenant.toUpperCase()}`}
          />

          <div className="mt-6 p-4 bg-muted rounded overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs sm:text-sm font-condensed">Level</TableHead>
                  <TableHead className="text-xs sm:text-sm font-condensed">Count</TableHead>
                  <TableHead className="text-xs sm:text-sm font-condensed">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {getHierarchyLevels(selectedHierarchy).map((level) => (
                  <TableRow key={level}>
                    <TableCell className="text-xs sm:text-sm">{level}</TableCell>
                    <TableCell className="text-xs sm:text-sm">{createdCounts[level] || 0}</TableCell>
                    <TableCell className="text-success text-xs sm:text-sm">✓ Created</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <p className="text-sm sm:text-base text-muted-foreground mt-4 text-center">
            Total: <span className="text-primary font-medium">{totalCreated} boundaries</span> created
          </p>

          <div className="mt-6 flex justify-center">
            <SubmitBar
              label="Back to Geography"
              onSubmit={onDone}
              icon={<ChevronRight className="w-4 h-4" />}
            />
          </div>
        </DigitCard>
      )}

      {/* Complete: OSM path */}
      {step === 'complete' && path === 'osm' && (
        <DigitCard>
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <Banner
              successful={true}
              message="Boundaries created"
              info={`Successfully generated ${totalCreated} boundaries from OSM data.`}
            />

            <div className="max-w-lg mx-auto mt-6">
              <h3 className="text-lg font-semibold mb-4">Summary</h3>
              <div className="space-y-3">
                {Object.entries(createdCounts).map(([type, count]) => (
                  <div key={type} className="flex justify-between items-center p-3 bg-secondary/50 rounded-lg">
                    <span className="font-medium">{type}</span>
                    <Badge variant="secondary">{count} items</Badge>
                  </div>
                ))}
              </div>
              {skippedFeatures.length > 0 && (
                <p className="text-xs text-muted-foreground mt-4">
                  {skippedFeatures.length} feature(s) were skipped (unnamed, name not romanizable, or no parent found) — see the review step report.
                </p>
              )}
            </div>

            <SubmitBar
              label="Back to Geography"
              onSubmit={onDone}
              icon={<ChevronRight className="w-4 h-4" />}
            />
          </div>
        </DigitCard>
      )}
    </div>
  );
}

// Helper component for boundary table
function BoundaryTable({
  boundaries,
  invalidBoundaries,
}: {
  boundaries: BoundaryExcelRow[];
  invalidBoundaries: { boundary: BoundaryExcelRow; error: string }[];
}) {
  const getError = (code: string) => {
    const invalid = invalidBoundaries.find(i => i.boundary.code === code);
    return invalid?.error;
  };

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/50">
            <TableHead className="text-xs sm:text-sm font-condensed">Status</TableHead>
            <TableHead className="text-xs sm:text-sm font-condensed">Code</TableHead>
            <TableHead className="text-xs sm:text-sm font-condensed">Name</TableHead>
            <TableHead className="text-xs sm:text-sm font-condensed">Type</TableHead>
            <TableHead className="text-xs sm:text-sm font-condensed">Parent</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {boundaries.slice(0, 20).map((row) => {
            const error = getError(row.code);
            return (
              <TableRow key={row.code} className={error ? 'bg-destructive/10' : ''}>
                <TableCell>
                  {error ? (
                    <Badge variant="destructive" className="gap-1 text-xs">
                      <AlertTriangle className="w-3 h-3" /> Error
                    </Badge>
                  ) : (
                    <Badge className="gap-1 text-xs bg-success text-white">
                      <Check className="w-3 h-3" /> Valid
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="font-mono text-xs sm:text-sm">{row.code}</TableCell>
                <TableCell className="text-xs sm:text-sm">{row.name}</TableCell>
                <TableCell className="text-xs sm:text-sm">{row.boundaryType}</TableCell>
                <TableCell className="font-mono text-xs sm:text-sm">
                  {row.parentCode || '-'}
                  {error && <span className="text-destructive block text-xs">{error}</span>}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {boundaries.length > 20 && (
        <p className="text-xs text-muted-foreground text-center py-2">
          Showing first 20 of {boundaries.length} rows
        </p>
      )}
    </div>
  );
}
