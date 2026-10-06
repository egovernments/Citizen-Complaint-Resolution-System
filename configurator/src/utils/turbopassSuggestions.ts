// Pure helpers for Phase 2's turbopass boundary search (#1016): how a
// suggestion is labelled, and when a typed term may resolve to a place without
// the operator choosing one.

/** Name properties a place may be known by. Geoapify and the overture
 *  search-api put the primary name in `name`; OSM-style variants stay covered
 *  so a translated/anglicized name still resolves (#757). */
export const NAME_KEYS = ['name', 'name:en', 'int_name', 'alt_name'] as const;

/** The part of a search-result feature these helpers read. */
export interface SuggestionFeature {
  properties?: Record<string, unknown> | null;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Case-, diacritic- and whitespace-insensitive form ("Moçambique" → "mocambique"). */
export function normalizePlaceName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** True when one of the place's name variants IS the term (after
 *  normalization). Deliberately not a substring test: "Delhi" must not match
 *  "Delhi Govt Flats". */
export function matchesNameFamily(props: Record<string, unknown> | null | undefined, term: string): boolean {
  const t = normalizePlaceName(term);
  if (!t || !props) return false;
  return NAME_KEYS.some(k => {
    const v = str(props[k]);
    return v !== '' && normalizePlaceName(v) === t;
  });
}

export interface SuggestionLabel {
  text: string;
  type: string;
}

/** Dropdown label. The overture search-api's `formatted` already carries the
 *  subtype and parents ("Delhi — region, India"); the badge adds subtype and
 *  admin level, so same-name places stay distinguishable even against an older
 *  search-api whose `formatted` is only "Delhi, IN". */
export function formatSuggestionLabel(item: SuggestionFeature | null | undefined): SuggestionLabel {
  const p = item?.properties ?? {};
  const text = str(p.formatted) || str(p.name);
  const level = Number.parseInt(String(p.admin_level), 10);
  const levelTag = Number.isNaN(level) ? '' : `L${level}`;
  // How many areas lie inside it (overture only) — tells the operator a pick's
  // size before fetching it: "1 sub-area" is valid but tiny, a country is huge.
  const n = p.descendant_count;
  const areasTag = typeof n === 'number'
    ? (n === 0 ? 'no sub-areas' : `${n.toLocaleString('en-US')} ${n === 1 ? 'sub-area' : 'sub-areas'}`)
    : '';
  // The official sets' local level name ("Ward") reads better than "ADM3".
  const subtype = str(p.level_name) || str(p.subtype);
  if (subtype) return { text, type: `[${[subtype, levelTag, areasTag].filter(Boolean).join(' · ')}]` };
  const resultType = str(p.result_type);
  if (resultType) return { text, type: `[${resultType}]` };
  return { text, type: `[${levelTag || 'location'}]` };
}

export type PickReason = 'single-exact' | 'ambiguous' | 'no-exact' | 'no-results';

export interface PickResult<T extends SuggestionFeature = SuggestionFeature> {
  /** The place to use without asking, or null when the operator must choose. */
  pick: T | null;
  reason: PickReason;
  /** What to offer the operator: exact-name matches first, then the rest in server order. */
  candidates: T[];
  exactCount: number;
}

/** Decide whether Search may proceed without the operator picking a
 *  suggestion: only when exactly one result is named exactly the typed term.
 *  Several exact matches (a region AND neighbourhoods called "Delhi"), or none
 *  (only "Delhi Govt Flats"), mean the operator chooses — never whatever the
 *  server happened to return first. */
export function pickSuggestion<T extends SuggestionFeature>(
  features: T[] | null | undefined,
  term: string,
): PickResult<T> {
  const all = Array.isArray(features) ? features : [];
  const exact = all.filter(f => matchesNameFamily(f?.properties, term));
  const candidates = [...exact, ...all.filter(f => !exact.includes(f))];
  if (all.length === 0) return { pick: null, reason: 'no-results', candidates, exactCount: 0 };
  if (exact.length === 1) return { pick: exact[0], reason: 'single-exact', candidates, exactCount: 1 };
  return { pick: null, reason: exact.length > 1 ? 'ambiguous' : 'no-exact', candidates, exactCount: exact.length };
}

/** Operator-facing prompt for a PickResult that needs a choice; null when none is needed. */
export function pickPromptMessage(result: Pick<PickResult, 'reason' | 'exactCount'>, term: string): string | null {
  const t = term.trim();
  switch (result.reason) {
    case 'single-exact':
      return null;
    case 'ambiguous':
      return `${result.exactCount} places are named "${t}". Pick the one you mean from the suggestions.`;
    case 'no-exact':
      return `No place is named exactly "${t}". Pick one of the suggestions, or refine the search.`;
    case 'no-results':
      return `No administrative area matches "${t}". Refine the search.`;
  }
}

/** Sources the search-api serves from its own DB (no API key): Overture, and
 *  the government-derived sets — `official` picks, per country, whichever of
 *  OCHA COD-AB / geoBoundaries nests deepest (#1994). */
export const OFFLINE_SOURCES = ['official', 'overture', 'cod', 'geoboundaries'] as const;

export function isOfflineSource(source: string): boolean {
  return (OFFLINE_SOURCES as readonly string[]).includes(source);
}

/** The source Phase 2 starts on: the build-time VITE_TURBOPASS_SOURCE when
 *  set, else the first source the server can answer (`choices`, from
 *  availableSources: official first). `overture` only while /health hasn't
 *  answered (null) or lists nothing — never a source /health says is down,
 *  which would leave every search answering 503. */
export function chooseTurbopassSource(configured: string | undefined, choices: string[] | null | undefined): string {
  const fixed = (configured ?? '').trim();
  if (fixed) return fixed;
  return choices?.[0] ?? 'overture';
}

/** Every source the search-api can serve, in the order Phase 2 offers them. */
export const SOURCE_ORDER = ['official', 'cod', 'geoboundaries', 'overture', 'geoapify'] as const;

/** Sources the server says it can answer (/health `sources`), in offer order.
 *  Empty when /health was unreadable or nothing is loaded. */
export function availableSources(sources: Record<string, unknown> | null | undefined): string[] {
  return SOURCE_ORDER.filter((s) => sources?.[s] === true);
}

/** Dropdown label for a source. */
export function sourceOptionLabel(source: string): string {
  switch (source) {
    case 'official':
      return 'Official — best of COD-AB / geoBoundaries per country';
    case 'cod':
      return 'OCHA COD-AB';
    case 'geoboundaries':
      return 'geoBoundaries';
    case 'overture':
      return 'Overture Maps (OpenStreetMap-derived)';
    case 'geoapify':
      return 'Geoapify (hosted)';
    default:
      return source;
  }
}

/** Shown instead of the search when the deployment has no boundary service. */
export const TURBOPASS_UNAVAILABLE_MESSAGE =
  "Boundary search isn't set up on this deployment: the turbopass boundary service isn't reachable, " +
  'or has no boundary data loaded. An administrator can enable it (enable_turbopass, with a boundary DB — ' +
  'see turbopass/README.md). Until then, use Upload from Excel.';

/** A search result tagged with the source that produced it, so a later fetch
 *  asks that source even if the operator has switched sources since. */
export type SourcedFeature<T extends SuggestionFeature = SuggestionFeature> = T & { querySource: string };

export function tagWithSource<T extends SuggestionFeature>(features: T[] | null | undefined, source: string): SourcedFeature<T>[] {
  return (Array.isArray(features) ? features : []).map((f) => ({ ...f, querySource: source }));
}

/** The source to fetch a picked place from: the one that found it. */
export function fetchSourceFor(item: { querySource?: unknown } | null | undefined, current: string): string {
  return typeof item?.querySource === 'string' && item.querySource ? item.querySource : current;
}

/** /boundary/search URL. `onboardableOnly` asks an offline source for places
 *  with at least one area inside them (min_descendants=1): a place with nothing
 *  inside can never form a hierarchy. Geoapify has no such filter. */
export function turbopassSearchUrl(
  base: string,
  term: string,
  source: string,
  match: string,
  onboardableOnly: boolean,
): string {
  const qs = new URLSearchParams({ q: term, source, match });
  if (onboardableOnly && isOfflineSource(source)) qs.set('min_descendants', '1');
  return `${base}/boundary/search?${qs.toString()}`;
}

const DATASET_NAMES: Record<string, string> = {
  cod: 'OCHA COD-AB',
  geoboundaries: 'geoBoundaries',
  overture: 'Overture Maps',
  geoapify: 'Geoapify',
};

/** "Boundary data: OCHA COD-AB (CC BY-IGO)" for the fetched features, or null
 *  when they carry no source. The official sets' licences require attribution,
 *  and a set can mix licences across levels (geoBoundaries does). */
export function attributionLine(features: SuggestionFeature[] | null | undefined): string | null {
  const bySource = new Map<string, Set<string>>();
  for (const f of features ?? []) {
    const src = str(f?.properties?.source);
    if (!src) continue;
    const licences = bySource.get(src) ?? new Set<string>();
    const licence = str(f?.properties?.licence);
    if (licence) licences.add(licence);
    bySource.set(src, licences);
  }
  if (bySource.size === 0) return null;
  const parts = [...bySource].map(([src, licences]) => {
    const name = DATASET_NAMES[src] ?? src;
    if (src === 'overture') return `${name} (ODbL)`;
    if (src === 'geoapify') return `${name} (© OpenStreetMap contributors, ODbL)`;
    return licences.size ? `${name} (${[...licences].sort().join('; ')})` : name;
  });
  return `Boundary data: ${parts.join(', ')}`;
}

/** Why a place can't be onboarded on its own: nothing lies inside it (#1016
 *  point 3). Points at its parent when the source says what that is. */
export function deadEndMessage(item: SuggestionFeature | null | undefined): string {
  const p = item?.properties ?? {};
  const name = str(p.name) || str(p.formatted) || 'This place';
  const subtype = str(p.subtype);
  const parent = str(p.parent_name);
  const head = `"${name}"${subtype ? ` (${subtype})` : ''} has no smaller areas inside it, so it can't form a hierarchy.`;
  return parent ? `${head} It lies in ${parent} — search for that instead.` : `${head} Search for a larger area that contains it.`;
}

/** Why a fetched place can't be onboarded when it yielded fewer than two
 *  levels. A place with nothing inside it gets deadEndMessage; one with areas
 *  inside that all came back as a single usable level (e.g. the place itself
 *  had no polygon) is told so, instead of being wrongly called empty. */
export function tooFewLevelsMessage(item: SuggestionFeature | null | undefined, fetchedAreas: number): string {
  const p = item?.properties ?? {};
  const inside = typeof p.descendant_count === 'number' ? p.descendant_count : Math.max(fetchedAreas - 1, 0);
  if (inside === 0) return deadEndMessage(item);
  const name = str(p.name) || str(p.formatted) || 'This place';
  return `"${name}" has ${inside.toLocaleString('en-US')} ${inside === 1 ? 'area' : 'areas'} inside it, but they came back as a single level with map polygons, so they can't form a hierarchy of two levels. Pick a larger area, or try another boundary source.`;
}

export function sourceLabel(source: string): string {
  if (source === 'overture') return 'the offline boundary service';
  if (source === 'official') return 'the official boundary sets (OCHA COD-AB / geoBoundaries)';
  if (source === 'cod') return 'OCHA COD-AB';
  if (source === 'geoboundaries') return 'geoBoundaries';
  if (source === 'geoapify') return 'Geoapify';
  return source;
}

export interface TurbopassFailure {
  kind: 'search' | 'fetch' | 'network';
  source: string;
  status?: number;
  serverMessage?: string;
  place?: string;
}

/** Operator-facing text for a failed turbopass call. A server fault must not
 *  read like a bad search term (#1016 point 1), and names the real source. */
export function turbopassErrorMessage(f: TurbopassFailure): string {
  const where = sourceLabel(f.source);
  // 413 is the server's size cap: its message already names the place and count.
  if (f.kind === 'fetch' && f.status === 413 && f.serverMessage) return f.serverMessage;
  const detail = f.status ? ` (HTTP ${f.status}${f.serverMessage ? `: ${f.serverMessage}` : ''})` : '';
  if (f.kind === 'fetch') {
    return `Couldn't fetch the boundaries of "${f.place || 'the selected place'}" from ${where}${detail}. Try again, or pick a different place.`;
  }
  if (f.kind === 'search') {
    return `Boundary search is unavailable right now — ${where} returned an error${detail}. This is a server problem, not your search: try again, or ask an administrator to check the turbopass service.`;
  }
  return `Couldn't reach ${where}. Check the connection and that the turbopass service is deployed, then try again.`;
}
