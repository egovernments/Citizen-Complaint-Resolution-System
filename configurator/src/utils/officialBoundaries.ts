// The official boundary set turbopass holds for a country (GET
// /boundary/official?country=), and how confident the configurator can say it
// is. Confidence is evidence, not a verdict: the bootstrap compares the chosen
// set with the other official source (OCHA COD-AB vs geoBoundaries), level by
// level, and counts an area as matched when the other source has one covering
// nearly the same ground. Two independent publishers drawing the same areas is
// what "confirmed" means; it does not mean the government endorsed this file,
// and "one source only" means it couldn't be checked, not that it is wrong.
import { DATASET_NAMES } from './turbopassSuggestions';
import { plural } from './plural';

export interface OfficialLevel {
  level: string;
  admin_level: number;
  /** What the country calls this level ("Ward"), or null when unknown. */
  name: string | null;
  areas: number;
  coverage: number | null;
  /** Areas the other source has at this level; 0 = none, null = not measured. */
  other_areas: number | null;
  /** % of this level's areas matched in the other source; null = nothing to compare. */
  matched: number | null;
  /** The few unmatched areas, by name. */
  unmatched: string[];
}

export interface OfficialSet {
  country: string;
  source: string;
  licence: string | null;
  dataset_date: string | null;
  quality: string | null;
  url: string | null;
  agreement_measured: boolean;
  /** The comparison crashed when the boundary DB was built (older servers omit this). */
  agreement_failed?: boolean;
  levels: OfficialLevel[];
  other: { source: string; usable: boolean; dataset_date: string | null; quality: string | null; note: string | null } | null;
}

export type LevelStatus = 'confirmed' | 'partly' | 'differs' | 'single' | 'unmeasured';

/** At least this share of a level's areas matched → "Confirmed". */
export const CONFIRMED_PCT = 90;
/** At least this share → "Partly"; below it → "Differs". */
export const PARTLY_PCT = 50;
/** The other source is this many years older → disagreement reads as "the map changed". */
export const OLDER_SOURCE_YEARS = 5;

export function levelStatus(level: Pick<OfficialLevel, 'other_areas' | 'matched'>): LevelStatus {
  if (level.other_areas === null) return 'unmeasured';
  if (level.other_areas === 0 || level.matched === null) return 'single';
  if (level.matched >= CONFIRMED_PCT) return 'confirmed';
  if (level.matched >= PARTLY_PCT) return 'partly';
  return 'differs';
}

export const STATUS_LABEL: Record<LevelStatus, string> = {
  confirmed: 'Confirmed',
  partly: 'Partly confirmed',
  differs: 'Differs',
  single: 'One source only',
  unmeasured: 'Not measured',
};

/**
 * One line under a level: what its status rests on. The figures are for the
 * whole country; `place` names the smaller area actually fetched, when it is
 * one, so a district's 3 regions aren't read against the country's 30.
 */
export function statusDetail(level: OfficialLevel, set: OfficialSet, place?: string | null): string {
  const other = set.other ? datasetName(set.other.source) : 'the other source';
  const across = place ? `Across all of ${countryName(set.country)}, not just ${place}: ` : '';
  switch (levelStatus(level)) {
    case 'single':
      return `${other} has no areas at this level, so it couldn't be checked.`;
    case 'unmeasured':
      return `Not checked: ${other} couldn't be compared at this level (it failed to load, or its version of the level didn't nest).`;
    default:
      return (
        `${across}${level.matched}% of ${level.areas.toLocaleString('en-US')} areas closely match ${other}` +
        ` (${(level.other_areas ?? 0).toLocaleString('en-US')} areas there).` +
        (level.unmatched.length ? ` Drawn differently: ${joinNames(level.unmatched)}.` : '')
      );
  }
}

export function datasetName(source: string): string {
  return DATASET_NAMES[source] ?? source;
}

/** The four-digit years in a dataset date ("2011/2014/2018", "2019-10-31"). */
export function datasetYears(date: string | null | undefined): number[] {
  return (date?.match(/(?:19|20)\d\d/g) ?? []).map(Number).sort((a, b) => a - b);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Oct 2019" for a full date, "2012–2021" for a geoBoundaries year list. */
export function formatDatasetDate(date: string | null | undefined): string | null {
  const full = date?.match(/^((?:19|20)\d\d)-(\d\d)/);
  if (full) return `${MONTHS[Number(full[2]) - 1] ?? ''} ${full[1]}`.trim();
  const years = datasetYears(date);
  if (!years.length) return null;
  return years[0] === years[years.length - 1] ? String(years[0]) : `${years[0]}–${years[years.length - 1]}`;
}

/** "OCHA COD-AB · Oct 2019" */
export function sourceLine(set: OfficialSet): string {
  const date = formatDatasetDate(set.dataset_date);
  return date ? `${datasetName(set.source)} · ${date}` : datasetName(set.source);
}

function newest(date: string | null | undefined): number | null {
  const years = datasetYears(date);
  return years.length ? years[years.length - 1] : null;
}

function levelWord(level: OfficialLevel): string {
  return plural((level.name ?? `level ${level.admin_level} area`).toLowerCase());
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function levelList(levels: OfficialLevel[]): string {
  return capitalise(joinNames(levels.map(levelWord)));
}

/**
 * One sentence on how far the set is confirmed and what rests on one source,
 * in the country's own level names, e.g. "Confirmed down to sub-counties.
 * Wards come from one source only." Null when agreement wasn't measured.
 */
export function confidenceHeadline(set: OfficialSet): string | null {
  const levels = set.levels;
  if (!set.agreement_measured || levels.length === 0) return null;
  const status = levels.map(levelStatus);
  const of = (s: LevelStatus) => levels.filter((_, i) => status[i] === s);
  const single = of('single');
  const unmeasured = of('unmeasured');
  const deepest = levels[levels.length - 1];
  // Nothing could be compared (the other source was down at build time): no verdict.
  if (unmeasured.length === levels.length) return null;
  const notChecked = unmeasured.length ? `${levelList(unmeasured)} couldn't be checked.` : null;

  if (single.length === levels.length) {
    return levels.length === 1
      ? `One source only: ${deepest.areas.toLocaleString('en-US')} ${levelWord(deepest)}, with no second source to check against.`
      : `One source only, down to ${levelWord(deepest)}, with no second source to check against.`;
  }
  if (status.every((s) => s === 'confirmed')) {
    const span = levels.length === 1 ? 'at its one level' : levels.length === 2 ? 'at both levels' : `at all ${levels.length} levels`;
    return `Confirmed by two sources ${span}, down to ${levelWord(deepest)}.`;
  }

  const parts: string[] = [];
  // Level words are plural ("wards"), so the verb is too.
  const singleSentence = single.length ? `${levelList(single)} come from one source only.` : null;
  const mine = newest(set.dataset_date);
  const theirs = newest(set.other?.dataset_date);
  const otherIsOlder = mine !== null && theirs !== null && theirs < mine;
  const otherDates = formatDatasetDate(set.other?.dataset_date);
  const second = otherIsOlder ? `an older source${otherDates ? ` (${otherDates})` : ''}` : 'a second source';
  const confirmed = of('confirmed');

  // Nothing confirmed and the other source is years older: the map changed.
  const compared = levels.filter((l) => ['partly', 'differs'].includes(levelStatus(l)));
  if (!confirmed.length && compared.length && otherIsOlder && mine! - theirs! > OLDER_SOURCE_YEARS) {
    const first = compared.find((l) => l.other_areas !== l.areas) ?? compared[0];
    parts.push(
      `Differs from ${second}: ${first.areas.toLocaleString('en-US')} ${levelWord(first)} here, ` +
        `${(first.other_areas ?? 0).toLocaleString('en-US')} there. This set is the newer one.`,
    );
  } else {
    if (confirmed.length) {
      const run = status.findIndex((s) => s !== 'confirmed');
      parts.push(
        run >= 2 && confirmed.length === run
          ? `Confirmed down to ${levelWord(levels[run - 1])}.`
          : `${levelList(confirmed)} confirmed.`,
      );
    }
    const partly = of('partly');
    const differs = of('differs');
    if (!confirmed.length && partly.length && !differs.length) {
      parts.push(`Partly matches ${second}.`);
    } else {
      if (partly.length) parts.push(`${levelList(partly)} partly match ${second}.`);
      if (differs.length) parts.push(`${levelList(differs)} differ from ${second}.`);
    }
    const named = levels.find((l) => ['partly', 'differs'].includes(levelStatus(l)) && l.unmatched.length);
    if (named) parts.push(`${joinNames(named.unmatched)} ${named.unmatched.length === 1 ? 'is' : 'are'} drawn differently.`);
  }
  if (singleSentence) parts.push(singleSentence);
  if (notChecked) parts.push(notChecked);
  return parts.join(' ');
}

export type Confidence = 'high' | 'medium' | 'low';

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  high: 'High confidence',
  medium: 'Medium confidence',
  low: 'Low confidence',
};

/** What each label rests on — the tag's tooltip. */
export const CONFIDENCE_HINT: Record<Confidence, string> = {
  high: 'Every level a second, independently drawn source has is confirmed by it.',
  medium: 'Some levels only partly match a second source, or differ from an older one because the map has since changed.',
  low: "No level could be checked against a second source, or a level differs from a source that isn't older.",
};

/**
 * One label for the whole set, from the same per-level statuses the headline
 * reads, so the two never disagree:
 *   high   — every level a second source has is Confirmed. Levels only one
 *            source has don't count against it (Kenya's wards, Rwanda's
 *            villages exist in one source almost everywhere).
 *   medium — a checked level only partly matches, or differs from a source
 *            more than OLDER_SOURCE_YEARS older: the map changed, and this set
 *            is the newer one (Ethiopia, Burundi).
 *   low    — no level could be checked at all, or a level differs from a
 *            source that isn't older.
 * No age rule on its own: a fully confirmed set doesn't drop for being old.
 * Null when this server measured no agreement.
 */
export function confidenceLevel(set: OfficialSet): Confidence | null {
  if (!set.agreement_measured || set.levels.length === 0) return null;
  const checked = set.levels
    .map(levelStatus)
    .filter((s) => s === 'confirmed' || s === 'partly' || s === 'differs');
  // Nothing compared because the comparison couldn't run is unknown, not Low.
  if (checked.length === 0) return set.levels.some((l) => levelStatus(l) === 'unmeasured') ? null : 'low';
  if (checked.every((s) => s === 'confirmed')) return 'high';
  if (checked.includes('differs')) {
    const mine = newest(set.dataset_date);
    const theirs = newest(set.other?.dataset_date);
    const mapChanged = mine !== null && theirs !== null && mine - theirs > OLDER_SOURCE_YEARS;
    if (!mapChanged) return 'low';
  }
  return 'medium';
}

/** The OptionCard / summary line naming the country: "Kenya". */
export function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** The official set for a country: the set, null when this server has none
 *  for it (404), or 'unavailable' when turbopass can't answer. */
export async function fetchOfficialSet(base: string, country: string): Promise<OfficialSet | null | 'unavailable'> {
  try {
    const res = await fetch(`${base}/boundary/official?country=${encodeURIComponent(country)}`);
    if (res.status === 404) return null;
    if (!res.ok) return 'unavailable';
    const body = (await res.json()) as OfficialSet;
    return body && Array.isArray(body.levels) ? body : 'unavailable';
  } catch {
    return 'unavailable';
  }
}
