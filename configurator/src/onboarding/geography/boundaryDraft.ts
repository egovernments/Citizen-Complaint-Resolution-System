import { useSyncExternalStore } from 'react';
import { apiClient, boundaryService, localizationService, mdmsService, ApiClientError } from '@/api';
import { reportStepError, trackImport, type OnboardingMethod } from '../telemetry';
import { labelLocales } from '../labelLocales';
import { englishT, MessageError, type OnboardingT } from '../i18n';
import { deriveMapPosition, widenMapPosition, type BoundingBox } from '@/utils/mapConfigFromBoundaries';
import { MDMS_SCHEMAS } from '@/api/config';
import type { OsmAdminLevel } from '@/utils/osmBoundaries';
import type { ParsedGeoJsonSidecar } from '@/utils/boundaryGeoJson';
import type { SuggestionFeature } from '@/utils/turbopassSuggestions';
import type { OfficialSet } from '@/utils/officialBoundaries';
import type { Boundary, BoundaryExcelRow, BoundaryHierarchy } from '@/api/types';
import type { BoundaryCreateFailure } from '@/api/services/boundary';
import type { BoundarySource } from './BoundaryImport';

/** What the import screen needs to reopen where the operator left it. */
export type ImportResume =
  | {
      kind: 'osm';
      searchTerm: string;
      pickedSuggestion: SuggestionFeature | null;
      turbopassSource: string;
      fetchedPlace: { id: string; name: string; label: string; country: string | null };
      adminLevels: OsmAdminLevel[];
      attribution: string | null;
      officialSet: OfficialSet | null;
    }
  | {
      kind: 'excel';
      hierarchy: BoundaryHierarchy;
      file: File | null;
      parsed: BoundaryExcelRow[];
      valid: BoundaryExcelRow[];
      invalid: { boundary: BoundaryExcelRow; error: string }[];
      polygonFile: File | null;
      polygonSidecar: ParsedGeoJsonSidecar | null;
    };

/**
 * One pick from a source: the areas a Preconfigured, Fetch or Excel import
 * handed back, and what reopens that import for Edit.
 */
export interface BoundarySelection {
  id: string;
  source: BoundarySource;
  /** Which of Geography's three ways it came from, for telemetry. */
  method: OnboardingMethod;
  hierarchyType: string;
  /** Level names, broadest first. */
  levels: string[];
  /** The hierarchy is already defined on the server (Excel's "use an existing hierarchy"). */
  hierarchyExists: boolean;
  boundaries: Boundary[];
  /** Areas already in an existing hierarchy without a name, which the save labels but doesn't create. */
  unnamed: { code: string; name: string }[];
  /** Rows already in an existing hierarchy as they are: left alone. */
  alreadyThere: number;
  /** Where the areas came from, e.g. "the official boundaries for Kenya (OCHA COD-AB)". */
  sourceText: string;
  /** Areas left out before save (unnamed, or in no area of the level above). */
  skipped: number;
  attribution: string | null;
  /** Geography's Preconfigured choice the import was opened with. */
  preconfigured: OfficialSet | null;
  resume: ImportResume;
}

export type NewSelection = Omit<BoundarySelection, 'id'>;

/**
 * Boundaries the operator has added in Geography but not saved, in the order
 * they were added. boundary-service can't delete a hierarchy or an area, so
 * nothing is written until the step's Save and continue: until then any area
 * can be removed, and any selection reopened.
 */
export interface BoundaryDraft {
  selections: BoundarySelection[];
}

/** The one hierarchy every area in the list goes into. */
export interface ListHierarchy {
  hierarchyType: string;
  /** Broadest first: the longest of the selections' levels, or the server's. */
  levels: string[];
  hierarchyExists: boolean;
}

// One unsaved list per workspace, held in this tab's memory: a reload drops it,
// unless it's what a save left unsaved (see "Leftovers" below).
const drafts = new Map<string, BoundaryDraft>();
// A save in flight, as its progress (0–100), so the step shows it after leaving and coming back.
const saves = new Map<string, number>();
// The hierarchy record (CMS-BOUNDARY.HierarchySchema) a save couldn't write: the
// step can't complete without it, so Save and continue writes it again.
const pendingRecords = new Map<string, { hierarchy: string; highestHierarchy: string; lowestHierarchy: string }>();
const listeners = new Set<() => void>();
let lastSelectionId = 0;

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setBoundaryDraft(tenantId: string, draft: BoundaryDraft | null) {
  if (draft?.selections.length) drafts.set(tenantId, draft);
  else drafts.delete(tenantId);
  storeLeftovers(tenantId);
  listeners.forEach((listener) => listener());
}

/*
 * Leftovers (#2795): the areas a save didn't write, with the reasons it gave,
 * survive a reload. The areas that did land close the sources and can pass the
 * step's check, so without the leftovers a reload would let the step complete
 * with them missing and no way left to add them. Kept in this browser per
 * workspace and hierarchy, following every change to the list, until they're
 * all saved or removed. A list nothing has been saved from still lives in this
 * tab only.
 */
type ExcelResume = Extract<ImportResume, { kind: 'excel' }>;
/** A selection as storage keeps it: an upload's files by name only. */
type StoredSelection = Omit<BoundarySelection, 'resume'> & {
  resume:
    | Extract<ImportResume, { kind: 'osm' }>
    | (Omit<ExcelResume, 'file' | 'polygonFile'> & { file: string | null; polygonFile: string | null });
};
interface StoredLeftovers {
  selections: StoredSelection[];
  failed: BoundaryCreateFailure[];
}

const leftoverKey = (tenantId: string, hierarchyType: string) => `ccrs-geography-unsaved:${tenantId}:${hierarchyType}`;
// The workspaces whose list is a save's leftovers, by the hierarchy it goes into.
const leftovers = new Map<string, string>();
// Why the last save left out the areas still in that list.
const leftoverFailures = new Map<string, BoundaryCreateFailure[]>();

function storable(selection: BoundarySelection): StoredSelection {
  if (selection.resume.kind !== 'excel') return selection as StoredSelection;
  const { file, polygonFile, ...resume } = selection.resume;
  return { ...selection, resume: { ...resume, file: file?.name ?? null, polygonFile: polygonFile?.name ?? null } };
}

/** A stored upload's file: only its name is read back (the list's title, Edit's "File:"); the rows are in `parsed`. */
function namedFile(name: string | null): File | null {
  if (!name) return null;
  try {
    return new File([], name);
  } catch {
    return null;
  }
}

function revived(selection: StoredSelection): BoundarySelection {
  const id = `selection-${++lastSelectionId}`;
  if (selection.resume.kind !== 'excel') return { ...selection, id } as BoundarySelection;
  const resume: ExcelResume = { ...selection.resume, file: namedFile(selection.resume.file), polygonFile: namedFile(selection.resume.polygonFile) };
  return { ...selection, id, resume };
}

/** Without what only Edit reopens with (a fetch's every outline, an upload's outlines file), for a list too big to store whole. */
function slim(stored: StoredLeftovers): StoredLeftovers {
  return {
    ...stored,
    selections: stored.selections.map((selection) => ({
      ...selection,
      resume:
        selection.resume.kind === 'osm'
          ? { ...selection.resume, adminLevels: [], pickedSuggestion: null }
          : { ...selection.resume, polygonFile: null, polygonSidecar: null },
    })),
  };
}

function writeLeftovers(key: string, stored: StoredLeftovers | null) {
  try {
    if (!stored) {
      window.localStorage.removeItem(key);
      return;
    }
    try {
      window.localStorage.setItem(key, JSON.stringify(stored));
    } catch {
      window.localStorage.setItem(key, JSON.stringify(slim(stored)));
    }
  } catch {
    // Storage unavailable or full: the list lives as long as the page, as before.
  }
}

function readLeftovers(key: string): StoredLeftovers | null {
  try {
    const raw = window.localStorage.getItem(key);
    const stored = raw ? (JSON.parse(raw) as Partial<StoredLeftovers>) : null;
    const usable =
      Array.isArray(stored?.selections) &&
      stored.selections.length > 0 &&
      stored.selections.every((s) => Array.isArray(s?.boundaries) && !!s.resume) &&
      Array.isArray(stored.failed);
    return usable ? (stored as StoredLeftovers) : null;
  } catch {
    return null;
  }
}

/** Keeps the stored leftovers in step with the list; once the list is empty, they're gone. */
function storeLeftovers(tenantId: string) {
  const storedIn = leftovers.get(tenantId);
  if (storedIn === undefined) return;
  const draft = drafts.get(tenantId);
  const hierarchyType = draft ? listHierarchy(draft)?.hierarchyType : undefined;
  if (hierarchyType !== storedIn) writeLeftovers(leftoverKey(tenantId, storedIn), null);
  if (!draft || !hierarchyType) {
    leftovers.delete(tenantId);
    leftoverFailures.delete(tenantId);
    return;
  }
  const listed = new Set(draftBoundaries(draft).map((b) => b.code));
  const failed = (leftoverFailures.get(tenantId) ?? []).filter((f) => listed.has(f.boundary.code));
  leftovers.set(tenantId, hierarchyType);
  leftoverFailures.set(tenantId, failed);
  writeLeftovers(leftoverKey(tenantId, hierarchyType), {
    selections: draft.selections.map(storable),
    // The page shows only each area's name and code beside the reason; its outline is in the selection.
    failed: failed.map(({ boundary, error, code }) => ({ boundary: { ...boundary, geometry: undefined }, error, code })),
  });
}

/**
 * After a reload: puts back what a save left unsaved in one of these hierarchies
 * (the ones the server has), and returns why the save left each area out. Null
 * when there's nothing to put back, or the list already holds something.
 */
export function restoreLeftovers(tenantId: string, hierarchyTypes: string[]): BoundaryCreateFailure[] | null {
  if (drafts.has(tenantId) || saves.has(tenantId)) return null;
  for (const hierarchyType of hierarchyTypes) {
    const stored = readLeftovers(leftoverKey(tenantId, hierarchyType));
    if (!stored) continue;
    leftovers.set(tenantId, hierarchyType);
    leftoverFailures.set(tenantId, stored.failed);
    setBoundaryDraft(tenantId, { selections: stored.selections.map(revived) });
    return leftoverFailures.get(tenantId) ?? [];
  }
  return null;
}

export function useBoundaryDraft(tenantId: string): BoundaryDraft | null {
  return useSyncExternalStore(subscribe, () => drafts.get(tenantId) ?? null);
}

const NO_FAILURES: BoundaryCreateFailure[] = [];

/**
 * Why the last save left out the areas in the list, while the list is what a save left out;
 * null for a list nothing has been saved from. Its hierarchy is on the server now, with its
 * level names fixed, so this list can't change: only Retry writes it.
 */
export function useSaveLeftovers(tenantId: string): BoundaryCreateFailure[] | null {
  return useSyncExternalStore(subscribe, () =>
    drafts.has(tenantId) && leftovers.has(tenantId) ? (leftoverFailures.get(tenantId) ?? NO_FAILURES) : null,
  );
}

/** How far a running save has got (0–100), or null when none is running. */
export function saveProgressOf(tenantId: string): number | null {
  return saves.get(tenantId) ?? null;
}

export function useBoundarySave(tenantId: string): number | null {
  return useSyncExternalStore(subscribe, () => saveProgressOf(tenantId));
}

/** Whether a save left the hierarchy record unwritten. */
export function usePendingHierarchyRecord(tenantId: string): boolean {
  return useSyncExternalStore(subscribe, () => pendingRecords.has(tenantId));
}

function notify() {
  listeners.forEach((listener) => listener());
}

/** Every area in the list, selection by selection. */
export function draftBoundaries(draft: BoundaryDraft): Boundary[] {
  return draft.selections.flatMap((selection) => selection.boundaries);
}

/** How many areas from other selections sit inside this selection's areas: it can't go before them. */
export function areasInside(draft: BoundaryDraft, id: string): number {
  const own = new Set(draft.selections.find((s) => s.id === id)?.boundaries.map((b) => b.code));
  return draft.selections
    .filter((s) => s.id !== id)
    .flatMap((s) => s.boundaries)
    .filter((b) => b.parent && own.has(b.parent)).length;
}

/** The hierarchy the list uses, leaving out one selection (the one an Edit reopened). */
export function listHierarchy(draft: BoundaryDraft | null, except?: string): ListHierarchy | null {
  const others = (draft?.selections ?? []).filter((selection) => selection.id !== except);
  if (others.length === 0) return null;
  const defined = others.find((selection) => selection.hierarchyExists);
  const longest = others.reduce((levels, selection) => (selection.levels.length > levels.length ? selection.levels : levels), others[0].levels);
  return { hierarchyType: others[0].hierarchyType, levels: defined ? defined.levels : longest, hierarchyExists: !!defined };
}

/**
 * Why a selection can't join the list, or null when it can. Everything goes into
 * one hierarchy, so its levels must be named as the list's are, from the top; a
 * hierarchy already on the server can't gain levels.
 */
export function selectionMismatch(
  list: ListHierarchy | null,
  selection: Pick<NewSelection, 'hierarchyType' | 'levels'>,
  t: OnboardingT = englishT,
): string | null {
  if (!list) return null;
  if (selection.hierarchyType !== list.hierarchyType) {
    return t(
      'geography.list.type_mismatch',
      'Your list is in the "%{listType}" hierarchy, and these boundaries go into "%{type}". Everything you add goes into one hierarchy.',
      { listType: list.hierarchyType, type: selection.hierarchyType },
    );
  }
  const shorter = selection.levels.length <= list.levels.length ? selection.levels : list.levels;
  const longer = shorter === selection.levels ? list.levels : selection.levels;
  const fits = shorter.every((level, i) => level === longer[i]) && !(list.hierarchyExists && longer === selection.levels && longer.length > shorter.length);
  return fits
    ? null
    : t('geography.list.levels_mismatch', 'Your list uses the levels %{levels}. Name these levels the same way, starting from the top, to add them to it.', {
        levels: list.levels.join(' → '),
      });
}

/** An area already saved in the hierarchy, as boundaryService.existingBoundaries reads it. */
export type SavedArea = { code: string; name?: string; parent?: string };

export interface AddResult {
  /** Areas that joined the list. */
  added: number;
  /** Areas left out because they're already saved in the hierarchy. */
  alreadySaved: number;
  /** Areas left out because the same area (code, name, level and parent) is already in the list. */
  duplicates: number;
  /** Why nothing changed, for the import screen to show. */
  error: string | null;
}

/**
 * Adds a selection to the list, or puts it in place of `replaces` (Edit). An
 * area already in the list (same code, name, level and parent), or already
 * saved (`saved`: same code and parent; its label may have been edited since),
 * is left out. A different area whose
 * code is taken (codes come from names, so two counties' "Central" share one)
 * gets the next free code, and its children follow it; a sheet's codes are the
 * operator's own, so a sheet with such a code is refused instead.
 */
export function addSelection(
  tenantId: string,
  selection: NewSelection,
  t: OnboardingT = englishT,
  replaces?: string,
  saved: SavedArea[] = [],
): AddResult {
  const draft = drafts.get(tenantId) ?? { selections: [] };
  const error = selectionMismatch(listHierarchy(draft, replaces), selection, t);
  if (error) return { added: 0, alreadySaved: 0, duplicates: 0, error };

  const others = draft.selections.filter((s) => s.id !== replaces);
  const listed = new Map(others.flatMap((s) => s.boundaries.map((b) => [b.code, b] as const)));
  const savedByCode = new Map(saved.map((area) => [area.code, area]));
  const used = new Set([...listed.keys(), ...savedByCode.keys(), ...selection.boundaries.map((b) => b.code)]);
  const renamed = new Map<string, string>();
  const clashes: string[] = [];
  const boundaries: Boundary[] = [];
  let duplicates = 0;
  let alreadySaved = 0;
  // Parents before children, so a parent's new code reaches its children.
  const depth = (b: Boundary) => selection.levels.indexOf(b.boundaryType);
  for (const b of [...selection.boundaries].sort((x, y) => depth(x) - depth(y))) {
    const parent = b.parent ? (renamed.get(b.parent) ?? b.parent) : b.parent;
    const there = listed.get(b.code);
    const savedThere = there ? undefined : savedByCode.get(b.code);
    if (!there && !savedThere) {
      boundaries.push({ ...b, parent });
    } else if (there && there.name === b.name && there.boundaryType === b.boundaryType && (there.parent ?? '') === (parent ?? '')) {
      duplicates++;
    } else if (savedThere && (savedThere.parent ?? '') === (parent ?? '')) {
      alreadySaved++;
    } else if (selection.source === 'excel') {
      clashes.push(b.code);
    } else {
      let n = 2;
      while (used.has(`${b.code}_${n}`)) n++;
      const code = `${b.code}_${n}`;
      used.add(code);
      renamed.set(b.code, code);
      boundaries.push({ ...b, code, parent });
    }
  }
  if (clashes.length) {
    return {
      added: 0,
      alreadySaved: 0,
      duplicates: 0,
      error: t('geography.list.code_clash', 'These codes are already in your list for other areas: %{codes}. Give them their own codes in the sheet.', {
        codes: clashes.join(', '),
      }),
    };
  }

  // An Edit may not drop an area that another selection's areas sit inside.
  const replaced = draft.selections.find((s) => s.id === replaces);
  if (replaced) {
    const dropped = new Set(replaced.boundaries.map((b) => b.code));
    for (const b of boundaries) dropped.delete(b.code);
    const orphaned = others.flatMap((s) => s.boundaries).filter((b) => b.parent && dropped.has(b.parent)).length;
    if (orphaned) {
      return {
        added: 0,
        alreadySaved: 0,
        duplicates: 0,
        error: t('geography.list.orphans', 'This leaves out areas that %{count} other areas in your list sit inside. Remove those first.', {
          count: orphaned.toLocaleString('en-US'),
        }),
      };
    }
  }
  // A sheet that only names areas already saved still joins: Save and continue uploads the names.
  if (boundaries.length === 0 && selection.unnamed.length === 0) {
    // An Edit to nothing new says so and leaves the item as it was.
    if (replaced) {
      return {
        added: 0,
        alreadySaved: 0,
        duplicates: 0,
        error: t('geography.list.edit_nothing_new', 'Everything in this selection is already in your list or saved, so nothing changed.'),
      };
    }
    return { added: 0, alreadySaved, duplicates, error: null };
  }

  const entry: BoundarySelection = { ...selection, boundaries, id: replaces ?? `selection-${++lastSelectionId}` };
  // The page drops a save's reasons once the list changes this way, so a reload doesn't bring them back.
  leftoverFailures.delete(tenantId);
  setBoundaryDraft(tenantId, {
    selections: replaced ? draft.selections.map((s) => (s.id === replaces ? entry : s)) : [...draft.selections, entry],
  });
  return { added: boundaries.length, alreadySaved, duplicates, error: null };
}

/**
 * What's left after a save: the areas that didn't land, kept for Retry to try
 * again. Read from the list as it is now. The save fixed the hierarchy on the
 * server, so they're marked as going into an existing one, with its levels, and
 * the list can't change any more (useSaveLeftovers). Names were uploaded with
 * it, unless the save stopped before (`namesUploaded`). They and the save's
 * reasons (`failed`) survive a reload.
 */
export function keepUnsaved(tenantId: string, created: Boundary[], failed: BoundaryCreateFailure[] = [], namesUploaded = true) {
  const draft = drafts.get(tenantId);
  if (!draft) return;
  const hierarchy = listHierarchy(draft);
  const levels = hierarchy?.levels;
  const saved = new Set(created.map((b) => b.code));
  if (hierarchy) leftovers.set(tenantId, hierarchy.hierarchyType);
  leftoverFailures.set(tenantId, failed);
  setBoundaryDraft(tenantId, {
    selections: draft.selections
      .map((s) => ({
        ...s,
        hierarchyExists: true,
        levels: levels ?? s.levels,
        unnamed: namesUploaded ? [] : s.unnamed,
        boundaries: s.boundaries.filter((b) => !saved.has(b.code)),
      }))
      .filter((s) => s.boundaries.length > 0 || s.unnamed.length > 0),
  });
}

/** Takes a selection off the list. Refused while areas from other selections sit inside its areas. */
export function removeSelection(tenantId: string, id: string): boolean {
  const draft = drafts.get(tenantId);
  if (!draft || areasInside(draft, id)) return false;
  setBoundaryDraft(tenantId, { selections: draft.selections.filter((selection) => selection.id !== id) });
  return true;
}

/**
 * Why areas can't go into a hierarchy already defined with these levels, or
 * null when they match. With other levels every area create would fail slowly
 * (validation retries) with a misleading error, so it stops before that.
 */
export function levelsMismatch(tenantId: string, hierarchyType: string, existing: string[], mapped: string[]): MessageError | null {
  if (existing.length === mapped.length && existing.every((name, idx) => name === mapped[idx])) return null;
  return new MessageError(
    'geography.osm.levels_mismatch',
    'A "%{type}" hierarchy already exists on %{tenant} with levels [%{existing}], which do not match your mapped levels [%{mapped}]. Boundaries cannot be created against mismatched level names. Either rename your mapped levels to match the existing hierarchy, or use the Excel path\'s "use existing hierarchy" option.',
    { type: hierarchyType, tenant: tenantId, existing: existing.join(' → '), mapped: mapped.join(' → ') },
  );
}

/** Defines the hierarchy, or uses the one already there when its levels match. */
async function ensureHierarchy(tenantId: string, hierarchyType: string, levelNames: string[]) {
  try {
    await boundaryService.createHierarchyFromLevels(tenantId, hierarchyType, levelNames);
  } catch (e) {
    const msg = String((e as Error)?.message || e);
    if (!msg.toLowerCase().includes('already exist') && !msg.includes('DUPLICATE')) throw e;
    const existing = (await boundaryService.getHierarchies(tenantId)).find((h) => h.hierarchyType === hierarchyType);
    const mismatch = levelsMismatch(tenantId, hierarchyType, (existing?.boundaryHierarchy ?? []).map((l) => l.boundaryType), levelNames);
    if (mismatch) throw mismatch;
  }
}

// Post-create pipeline shared by BOTH paths after createBoundaries succeeds:
// localizations (boundary names are required for the citizen UI; the rest is
// best-effort), localization cache-bust, and the boundary-path repair tool.
// Returns a message for the operator when the hierarchy record didn't save.
async function runPostCreatePipeline(
  tenantId: string,
  created: Boundary[],
  hierarchyType: string,
  levels: { boundaryType: string }[],
  t: OnboardingT = englishT,
  // Boundaries already there without a name, which the upload labels but doesn't create.
  unnamed: { code: string; name: string }[] = [],
  // Areas were saved in the hierarchy before: the map keeps covering them.
  keepSavedExtent = false,
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
      schemaError = t('geography.schema_not_saved', 'Boundaries were created, but the hierarchy record didn\'t save: %{reason}', { reason });
    }
  }

  // Create localizations for boundaries
  const boundaryData = [...created, ...unnamed].map(b => ({
    code: b.code,
    name: b.name,
  }));

  // Seed under en_IN (digit-ui's boot locale) plus every StateInfo language:
  // the citizen app reads boundary names under its active locale, so a missing
  // one leaves the locality dropdown and map ward tooltips showing raw codes.
  for (const locale of await labelLocales(tenantId)) {
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
    let derived = deriveMapPosition(created);
    if (derived && keepSavedExtent) {
      const rows = await mdmsService.searchRecords(tenantId, MDMS_SCHEMAS.MAP_CONFIG).catch(() => []);
      const own = rows.find((r) => r.tenantId === tenantId && r.isActive !== false);
      derived = widenMapPosition(derived, (own?.data as { searchViewbox?: BoundingBox } | undefined)?.searchViewbox);
    }
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

export interface DraftSaveResult {
  created: Boundary[];
  failed: BoundaryCreateFailure[];
  /** Set when the areas landed but the hierarchy record didn't. */
  schemaError: string | null;
}

/**
 * Writes the list: the hierarchy, its areas, then what the rest of the platform
 * reads alongside them. A partial save comes back with its failures. Throws when
 * it stops partway: before the hierarchy is defined the list is still good to
 * edit; after, the whole list waits for Retry (which skips areas already saved),
 * since the hierarchy's level names can't change now (#2795).
 * While it runs, useBoundarySave has its progress (0–100); the areas' writes are most of it.
 */
export async function saveBoundaryDraft(
  tenantId: string,
  draft: BoundaryDraft,
  t: OnboardingT = englishT,
  // Areas were already saved in the hierarchy: the map keeps covering them.
  hadSavedAreas = false,
): Promise<DraftSaveResult> {
  const hierarchy = listHierarchy(draft);
  if (!hierarchy) return { created: [], failed: [], schemaError: null };
  const progress = (percent: number) => {
    saves.set(tenantId, percent);
    notify();
  };
  progress(0);
  try {
    if (!hierarchy.hierarchyExists) await ensureHierarchy(tenantId, hierarchy.hierarchyType, hierarchy.levels);
    // The hierarchy is on the server now, its level names fixed, and the areas are next. From here the
    // whole list is kept as what this save leaves out, in this browser too: a save that stops partway
    // (an error, a closed tab) leaves it locked for Retry, never to be edited into other levels (#2795).
    // The end of the save narrows it to the areas that didn't land.
    keepUnsaved(tenantId, [], [], false);
    progress(2);
    const result = await boundaryService.createBoundaries(draftBoundaries(draft), (done, total) =>
      progress(2 + Math.floor((done / total) * 88)),
    );
    progress(92);
    const unnamed = draft.selections.flatMap((selection) => selection.unnamed);
    const schemaError = result.success.length || unnamed.length
      ? await runPostCreatePipeline(
          tenantId,
          result.success,
          hierarchy.hierarchyType,
          hierarchy.levels.map((boundaryType) => ({ boundaryType })),
          t,
          unnamed,
          hadSavedAreas,
        )
      : null;
    if (schemaError) {
      pendingRecords.set(tenantId, {
        hierarchy: hierarchy.hierarchyType,
        highestHierarchy: hierarchy.levels[0],
        lowestHierarchy: hierarchy.levels[hierarchy.levels.length - 1],
      });
    } else if (result.success.length || unnamed.length) {
      pendingRecords.delete(tenantId);
    }
    const created = new Set(result.success.map((b) => b.code));
    for (const selection of draft.selections) {
      const count = selection.boundaries.filter((b) => created.has(b.code)).length;
      trackImport('geography', 'boundary', {
        method: selection.method,
        count,
        failed: selection.boundaries.length - count,
        levels: selection.levels.length,
        already_there: selection.alreadyThere,
      });
    }
    progress(100);
    return { created: result.success, failed: result.failed, schemaError };
  } finally {
    saves.delete(tenantId);
    notify();
  }
}

/** Writes the hierarchy record a save couldn't. Returns why it failed again, or null. */
export async function retryHierarchyRecord(tenantId: string, t: OnboardingT = englishT): Promise<string | null> {
  const record = pendingRecords.get(tenantId);
  if (!record) return null;
  try {
    await mdmsService.ensureHierarchySchema(tenantId, record);
    pendingRecords.delete(tenantId);
    notify();
    return null;
  } catch (e) {
    reportStepError('geography', 'hierarchy_schema', e, tenantId);
    const reason = e instanceof ApiClientError ? e.firstError : e instanceof Error ? e.message : String(e);
    return t('geography.schema_not_saved_retry', 'The hierarchy record didn\'t save: %{reason} Save and continue tries it again.', { reason });
  }
}
