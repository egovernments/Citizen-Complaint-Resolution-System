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
  const subtype = str(p.subtype);
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

/** /boundary/search URL. `onboardableOnly` asks the overture source for places
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
  if (onboardableOnly && source === 'overture') qs.set('min_descendants', '1');
  return `${base}/boundary/search?${qs.toString()}`;
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

export function sourceLabel(source: string): string {
  if (source === 'overture') return 'the offline boundary service';
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
