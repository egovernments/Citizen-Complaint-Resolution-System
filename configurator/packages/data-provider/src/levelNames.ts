/**
 * The rules for a boundary hierarchy's level names (each level's boundaryType), shared by every
 * configurator screen that names levels (#2803).
 *
 * boundary-service accepts any name and answers 200, but egov-persister then writes every area's
 * level into boundary_relationship.boundarytype, a varchar(64). A longer name fails there, after
 * the fact, and the persister's retries hold up its one consumer for every tenant. Two levels with
 * the same name, or names only capital letters or spaces apart, make a hierarchy whose levels
 * can't be told apart (and share one ADMIN_<NAME> label key), so they are refused too.
 *
 * digit-mcp/src/utils/level-names.ts carries a copy of these rules (digit-mcp builds on its own):
 * change both together. digit-mcp's test-level-names.ts checks that the two copies agree.
 */

/** boundary_relationship.boundarytype is varchar(64); Postgres counts characters (code points). */
export const MAX_LEVEL_NAME_LENGTH = 64;

// Characters nobody sees: control characters (C0, DEL, C1) and format characters (zero-width
// space, direction marks, word joiner, soft hyphen…). Tabs and line breaks are folded into spaces
// first; what is left is invisible, pasted in by accident, and NUL can't be stored by Postgres at
// all. The zero-width joiner and non-joiner are part of the spelling in some scripts (Sinhala
// "ශ්‍රී"), so they are allowed, and left out of the key.
const HIDDEN_CHAR = /(?![‌‍])[\p{Cc}\p{Cf}]/u;
const JOINERS = /[‌‍]/g;

/** The name as it is saved: composed (NFC), each run of whitespace one space, trimmed. */
export function normalizeLevelName(name: string): string {
  return name.normalize('NFC').replace(/\s+/g, ' ').trim();
}

/** Two names with the same key are the same level name: case, spaces and joiners don't count. */
export function levelNameKey(name: string): string {
  return normalizeLevelName(name).replace(/ /g, '').replace(JOINERS, '').toLowerCase();
}

export type LevelNameProblem =
  | { kind: 'required' }
  | { kind: 'control_char' }
  | { kind: 'too_long'; length: number; max: number }
  /** `of` is the index of the earlier level with the same name. */
  | { kind: 'duplicate'; of: number };

/**
 * The length problem of this exact string, or null when the database can store it. For a string
 * as it is sent (a level name, a hierarchy type), not tidied first.
 */
export function tooLongForLevel(name: string): Extract<LevelNameProblem, { kind: 'too_long' }> | null {
  const length = [...name].length;
  return length > MAX_LEVEL_NAME_LENGTH ? { kind: 'too_long', length, max: MAX_LEVEL_NAME_LENGTH } : null;
}

/** What is wrong with each name, in order (null when it is fine). A repeated name is reported on the later level. */
export function levelNameProblems(names: readonly string[]): (LevelNameProblem | null)[] {
  const first = new Map<string, number>();
  return names.map((raw, index): LevelNameProblem | null => {
    const name = normalizeLevelName(raw ?? '');
    if (!name) return { kind: 'required' };
    if (HIDDEN_CHAR.test(name)) return { kind: 'control_char' };
    const tooLong = tooLongForLevel(name);
    if (tooLong) return tooLong;
    const key = levelNameKey(name);
    const earlier = first.get(key);
    if (earlier !== undefined) return { kind: 'duplicate', of: earlier };
    first.set(key, index);
    return null;
  });
}

/** Which problems count. */
export interface LevelNameCheck {
  /** Blank names are rows the save leaves out: not a problem, though they keep their place in "Level N". */
  skipBlank?: boolean;
  /** The hierarchy is already saved, and its names can't change: only names the database can't store count. */
  saved?: boolean;
}

export interface FirstLevelNameProblem {
  /** The name's place in the list, blanks included. */
  index: number;
  problem: LevelNameProblem;
  /** The name for a message: tidied, and cut to 40 characters. */
  name: string;
}

/** A name for a message: tidied, and cut to 40 characters. */
export function shortLevelName(name: string): string {
  const chars = [...normalizeLevelName(name)];
  return chars.length > 40 ? `${chars.slice(0, 40).join('')}…` : chars.join('');
}

/** The first name with a problem that counts, or null when there is none. */
export function firstLevelNameProblem(names: readonly string[], check: LevelNameCheck = {}): FirstLevelNameProblem | null {
  const counts = (p: LevelNameProblem) =>
    check.saved ? p.kind === 'too_long' || p.kind === 'control_char' : !(check.skipBlank && p.kind === 'required');
  const problems = levelNameProblems(names);
  const index = problems.findIndex((p) => p !== null && counts(p));
  if (index < 0) return null;
  return { index, problem: problems[index]!, name: shortLevelName(names[index] ?? '') };
}

/** One problem in plain English, for screens without the onboarding translator. */
export function levelNameProblemText(problem: LevelNameProblem, names: readonly string[]): string {
  switch (problem.kind) {
    case 'required':
      return 'Enter a name for this level.';
    case 'control_char':
      return 'This name contains a hidden control character, often from copy and paste. Delete the name and type it again.';
    case 'too_long':
      return `This name is ${problem.length} characters long. Use ${problem.max} characters or fewer.`;
    case 'duplicate':
      return `Level ${problem.of + 1} ("${shortLevelName(names[problem.of] ?? '')}") already has this name. Give each level a different name; capital letters and spaces don’t make names different.`;
  }
}

/** The first problem in a list of level names, as a sentence naming the level, or null when all are fine. */
export function levelNamesError(names: readonly string[], check: LevelNameCheck = {}): string | null {
  const first = firstLevelNameProblem(names, check);
  if (!first) return null;
  const named = first.name ? ` ("${first.name}")` : '';
  return `Level ${first.index + 1}${named}: ${levelNameProblemText(first.problem, names)}`;
}

/**
 * The level an area goes under, spelled as the hierarchy spells it: boundary-service matches an
 * area's level to the hierarchy's exactly. That is the one of `levels` with the same name once
 * tidied (a hierarchy saved before names were tidied keeps its spelling), else the name tidied.
 */
export function levelNameIn(levels: readonly string[], name: string): string {
  if (levels.includes(name)) return name;
  const tidy = normalizeLevelName(name);
  return levels.find((level) => normalizeLevelName(level) === tidy) ?? tidy;
}
