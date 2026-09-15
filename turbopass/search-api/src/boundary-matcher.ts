// Name matching + ranking for the offline Overture boundary search.
//
// Everything here is pure (no DB, no Nest) so it can be unit-tested directly;
// BoundaryService loads the rows from SQLite once and delegates to it.
//
// Matching runs over an in-memory index of every boundary's name rather than
// in SQL, because: it works on any existing boundaries.sqlite with no schema
// change or rebuild; SQLite's LIKE is neither diacritic-insensitive nor safe
// for a user-typed `%` / `_`; and typo tolerance needs an edit distance SQLite
// doesn't have. The index holds names only (no geometry), so the full IN+KE+MZ
// build (~65k rows) costs a few MB.

export const MATCH_MODES = ['exact', 'prefix', 'substring', 'fuzzy'] as const;
export type MatchMode = (typeof MATCH_MODES)[number];

export function isMatchMode(v: unknown): v is MatchMode {
  return (
    typeof v === 'string' && (MATCH_MODES as readonly string[]).includes(v)
  );
}

/** Case-, diacritic- and whitespace-insensitive form used for every comparison. */
export function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Edits `fuzzy` tolerates, scaled to the query so short queries don't match
 * half the dataset: none below 4 characters, 1 up to 6, 2 beyond.
 */
export function maxEditsFor(queryLength: number): number {
  if (queryLength < 4) return 0;
  if (queryLength <= 6) return 1;
  return 2;
}

/**
 * Optimal-string-alignment distance — Levenshtein plus adjacent transposition,
 * so "dehli" → "delhi" costs 1, not 2. Bounded: returns `max + 1` as soon as
 * the distance is known to exceed `max`.
 */
export function osaDistance(a: string, b: string, max: number): number {
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  if (la === 0 || lb === 0)
    return Math.max(la, lb) > max ? max + 1 : Math.max(la, lb);

  let prev2 = new Array<number>(lb + 1).fill(0);
  let prev = Array.from({ length: lb + 1 }, (_, j) => j);
  let cur = new Array<number>(lb + 1).fill(0);
  for (let i = 1; i <= la; i++) {
    cur[0] = i;
    let rowMin = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= lb; j++) {
      const cb = b.charCodeAt(j - 1);
      let v = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (ca === cb ? 0 : 1),
      );
      if (
        i > 1 &&
        j > 1 &&
        ca === b.charCodeAt(j - 2) &&
        a.charCodeAt(i - 2) === cb
      ) {
        v = Math.min(v, prev2[j - 2] + 1);
      }
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    // Safe early exit: a transposition from row i-1 costs at least as much as
    // some cell of row i, so a whole row above `max` can never come back down.
    if (rowMin > max) return max + 1;
    [prev2, prev, cur] = [prev, cur, prev2];
  }
  return prev[lb] > max ? max + 1 : prev[lb];
}

/** One row of the `boundaries` table, minus geometry. */
export interface BoundaryRow {
  id: string;
  division_id: string | null;
  name: string | null;
  subtype: string | null;
  class: string | null;
  country: string | null;
  admin_level: number | null;
  parent_id: string | null;
}

export interface BoundaryHit {
  id: string;
  name: string;
  subtype: string | null;
  admin_level: number | null;
  country: string | null;
  country_name: string | null;
  /** Immediate parent (via parent_id), whatever its level. */
  parent_name: string | null;
  /** Nearest `region` ancestor (admin_level 1), when it isn't the place itself. */
  region_name: string | null;
  descendant_count: number;
  /** How the name matched: exact, prefix, substring, or fuzzy (typo-tolerant). */
  match_type: MatchMode;
  /** Edit distance for a fuzzy match; 0 otherwise. */
  distance: number;
  /** 1.0 (exact) down to 0.4 (fuzzy, 2 edits). Only meaningful for ordering. */
  score: number;
  /** Disambiguating display label, e.g. "Delhi — region, India". */
  formatted: string;
}

const TYPE_RANK: Record<MatchMode, number> = {
  exact: 0,
  prefix: 1,
  substring: 2,
  fuzzy: 3,
};

export function matchScore(type: MatchMode, distance: number): number {
  switch (type) {
    case 'exact':
      return 1;
    case 'prefix':
      return 0.9;
    case 'substring':
      return 0.75;
    case 'fuzzy':
      return Math.round((0.6 - 0.1 * distance) * 100) / 100;
  }
}

/** "Delhi — neighborhood, Rewa, Madhya Pradesh, India"; blanks and repeats dropped. */
export function formatBoundaryLabel(
  name: string,
  subtype: string | null,
  context: (string | null | undefined)[],
): string {
  const ctx: string[] = [];
  for (const c of context) {
    if (c && c !== ctx[ctx.length - 1]) ctx.push(c);
  }
  const head = subtype ? `${name} — ${subtype}` : name;
  return ctx.length ? `${head}, ${ctx.join(', ')}` : head;
}

interface Entry {
  row: BoundaryRow;
  norm: string;
  /** Words of a multi-word name, for fuzzy matching one word ("dehli" ~ "new delhi"). */
  tokens: string[];
}

interface Scored {
  entry: Entry;
  type: MatchMode;
  distance: number;
}

const levelOf = (r: BoundaryRow) => r.admin_level ?? Number.MAX_SAFE_INTEGER;

function classify(
  entry: Entry,
  q: string,
  mode: MatchMode,
  maxEdits: number,
): Omit<Scored, 'entry'> | null {
  const n = entry.norm;
  if (n === q) return { type: 'exact', distance: 0 };
  if (mode === 'exact') return null;
  if (n.startsWith(q)) return { type: 'prefix', distance: 0 };
  if (mode === 'prefix') return null;
  if (n.includes(q)) return { type: 'substring', distance: 0 };
  if (mode === 'substring' || maxEdits === 0) return null;
  // Past the substring test, no whole name or word equals q, so 1 is the floor.
  let best = osaDistance(n, q, maxEdits);
  for (const t of entry.tokens) {
    if (best <= 1) break;
    best = Math.min(best, osaDistance(t, q, maxEdits));
  }
  return best <= maxEdits ? { type: 'fuzzy', distance: best } : null;
}

// Every mode ranks the same way: exact → prefix → substring → fuzzy (fewer
// edits first), then the broadest place (lowest admin_level), then the shorter
// name. This is what puts the Delhi *region* above "Delhi Govt Flats".
function compareScored(a: Scored, b: Scored): number {
  const ra = a.entry.row;
  const rb = b.entry.row;
  return (
    TYPE_RANK[a.type] - TYPE_RANK[b.type] ||
    a.distance - b.distance ||
    levelOf(ra) - levelOf(rb) ||
    a.entry.norm.length - b.entry.norm.length ||
    (a.entry.norm < b.entry.norm ? -1 : a.entry.norm > b.entry.norm ? 1 : 0) ||
    (ra.id < rb.id ? -1 : ra.id > rb.id ? 1 : 0)
  );
}

export class BoundaryIndex {
  private readonly entries: Entry[] = [];
  private readonly byId = new Map<string, BoundaryRow>();
  private readonly descendants = new Map<string, number>();
  private readonly countryNames = new Map<string, string>();

  constructor(rows: BoundaryRow[]) {
    for (const r of rows) this.byId.set(r.id, r);

    // Descendant counts, deepest level first so a child's total is final before
    // it is added to its parent (build_hierarchy.py only links a parent at a
    // strictly lower admin_level).
    for (const r of [...rows].sort((a, b) => levelOf(b) - levelOf(a))) {
      if (!r.parent_id || !this.byId.has(r.parent_id)) continue;
      const own = this.descendants.get(r.id) ?? 0;
      this.descendants.set(
        r.parent_id,
        (this.descendants.get(r.parent_id) ?? 0) + 1 + own,
      );
    }

    // Overture ships some divisions as two areas under one division_id — `land`
    // and `maritime` (every country, plus coastal regions such as Kwale). They
    // are one place, so list it once: keep the area the hierarchy actually
    // hangs off (more descendants — that id is what /boundary/fetch expands),
    // preferring `land` on a tie.
    const reps = new Map<string, BoundaryRow>();
    for (const r of rows) {
      if (!r.name) continue;
      const key = r.division_id || r.id;
      const current = reps.get(key);
      if (!current || this.isBetterRepresentative(r, current)) reps.set(key, r);
    }
    for (const r of reps.values()) {
      const norm = normalizeName(r.name as string);
      const words = norm.split(/[\s\-–—,/()]+/).filter(Boolean);
      this.entries.push({
        row: r,
        norm,
        tokens: words.length > 1 ? words : [],
      });
      if (
        r.subtype === 'country' &&
        r.country &&
        !this.countryNames.has(r.country)
      ) {
        this.countryNames.set(r.country, r.name as string);
      }
    }
  }

  get size(): number {
    return this.entries.length;
  }

  /** Areas under `id`, all depths; undefined when the id isn't loaded. */
  descendantsOf(id: string): number | undefined {
    return this.byId.has(id) ? (this.descendants.get(id) ?? 0) : undefined;
  }

  nameOf(id: string): string | null {
    return this.byId.get(id)?.name ?? null;
  }

  // `minDescendants` drops places with fewer areas under them — the configurator
  // asks for 1, because a place with nothing under it can never form a
  // hierarchy (97.9% of the IN+KE+MZ build are such leaves).
  search(
    query: string,
    mode: MatchMode,
    limit: number,
    minDescendants = 0,
  ): BoundaryHit[] {
    const q = normalizeName(query);
    if (!q) return [];
    const maxEdits = mode === 'fuzzy' ? maxEditsFor(q.length) : 0;
    // Keep only the best `limit` while scanning (binary insertion into a
    // sorted window) rather than sorting every candidate: a one-letter query
    // matches ~59k names, and sorting them all dominated the request.
    const best: Scored[] = [];
    if (limit < 1) return [];
    for (const entry of this.entries) {
      if (
        minDescendants > 0 &&
        (this.descendants.get(entry.row.id) ?? 0) < minDescendants
      ) {
        continue;
      }
      const m = classify(entry, q, mode, maxEdits);
      if (!m) continue;
      const s: Scored = { entry, ...m };
      if (best.length === limit && compareScored(s, best[limit - 1]) >= 0) {
        continue;
      }
      let lo = 0;
      let hi = best.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (compareScored(best[mid], s) <= 0) lo = mid + 1;
        else hi = mid;
      }
      best.splice(lo, 0, s);
      if (best.length > limit) best.pop();
    }
    return best.map((s) => this.toHit(s));
  }

  private isBetterRepresentative(a: BoundaryRow, b: BoundaryRow): boolean {
    const da = this.descendants.get(a.id) ?? 0;
    const db = this.descendants.get(b.id) ?? 0;
    if (da !== db) return da > db;
    if ((a.class === 'land') !== (b.class === 'land'))
      return a.class === 'land';
    return a.id < b.id;
  }

  private toHit({ entry, type, distance }: Scored): BoundaryHit {
    const row = entry.row;
    const name = row.name as string;
    const parent = row.parent_id ? this.byId.get(row.parent_id) : undefined;
    let region: BoundaryRow | undefined;
    let countryName: string | null = row.subtype === 'country' ? name : null;
    for (
      let a = parent, hops = 0;
      a && hops < 32;
      a = a.parent_id ? this.byId.get(a.parent_id) : undefined, hops++
    ) {
      if (!region && a.subtype === 'region') region = a;
      if (a.subtype === 'country') {
        countryName = a.name;
        break;
      }
    }
    countryName ??=
      (row.country && this.countryNames.get(row.country)) || row.country;

    return {
      id: row.id,
      name,
      subtype: row.subtype,
      admin_level: row.admin_level,
      country: row.country,
      country_name: countryName,
      parent_name: parent?.name ?? null,
      region_name: region?.name ?? null,
      descendant_count: this.descendants.get(row.id) ?? 0,
      match_type: type,
      distance,
      score: matchScore(type, distance),
      formatted: formatBoundaryLabel(name, row.subtype, [
        parent && parent.subtype !== 'country' ? parent.name : null,
        region?.name,
        row.subtype === 'country' ? null : countryName,
      ]),
    };
  }
}
