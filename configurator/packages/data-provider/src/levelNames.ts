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
 * digit-mcp/src/utils/level-names.ts carries a copy of these rules: change both together.
 */

/** boundary_relationship.boundarytype is varchar(64); Postgres counts characters (code points). */
export const MAX_LEVEL_NAME_LENGTH = 64;

// Control characters (C0, DEL, C1). Tabs and line breaks are folded into spaces first; what is
// left is invisible, pasted in by accident, and NUL can't be stored by Postgres at all.
const CONTROL_CHAR = /\p{Cc}/u;

/** The name as it is saved: composed (NFC), each run of whitespace one space, trimmed. */
export function normalizeLevelName(name: string): string {
  return name.normalize('NFC').replace(/\s+/g, ' ').trim();
}

/** Two names with the same key are the same level name: case and spaces don't count. */
export function levelNameKey(name: string): string {
  return normalizeLevelName(name).replace(/ /g, '').toLowerCase();
}

export type LevelNameProblem =
  | { kind: 'required' }
  | { kind: 'control_char' }
  | { kind: 'too_long'; length: number; max: number }
  /** `of` is the index of the earlier level with the same name. */
  | { kind: 'duplicate'; of: number };

/** What is wrong with each name, in order (null when it is fine). A repeated name is reported on the later level. */
export function levelNameProblems(names: readonly string[]): (LevelNameProblem | null)[] {
  const first = new Map<string, number>();
  return names.map((raw, index): LevelNameProblem | null => {
    const name = normalizeLevelName(raw ?? '');
    if (!name) return { kind: 'required' };
    if (CONTROL_CHAR.test(name)) return { kind: 'control_char' };
    const length = [...name].length;
    if (length > MAX_LEVEL_NAME_LENGTH) return { kind: 'too_long', length, max: MAX_LEVEL_NAME_LENGTH };
    const key = levelNameKey(name);
    const earlier = first.get(key);
    if (earlier !== undefined) return { kind: 'duplicate', of: earlier };
    first.set(key, index);
    return null;
  });
}

const quoted = (name: string) => {
  const chars = [...normalizeLevelName(name)];
  return `"${chars.length > 40 ? `${chars.slice(0, 40).join('')}…` : chars.join('')}"`;
};

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
      return `Level ${problem.of + 1} (${quoted(names[problem.of] ?? '')}) already has this name. Give each level a different name; capital letters and spaces don’t make names different.`;
  }
}

/** The first problem in a list of level names, as a sentence naming the level, or null when all are fine. */
export function levelNamesError(names: readonly string[]): string | null {
  const problems = levelNameProblems(names);
  const index = problems.findIndex((p) => p !== null);
  if (index < 0) return null;
  const named = normalizeLevelName(names[index] ?? '') ? ` (${quoted(names[index] ?? '')})` : '';
  return `Level ${index + 1}${named}: ${levelNameProblemText(problems[index]!, names)}`;
}
