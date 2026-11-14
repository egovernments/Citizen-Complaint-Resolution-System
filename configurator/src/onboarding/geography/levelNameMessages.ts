import { MAX_LEVEL_NAME_LENGTH, levelNameProblems, normalizeLevelName, type LevelNameProblem } from '@digit-mcp/data-provider';
import { englishT, type OnboardingT } from '../i18n';

/**
 * Onboarding's words for the level-name rules (#2803). The rules live in @digit-mcp/data-provider's
 * levelNames, so every screen that names levels checks the same thing.
 */

/** The message under a level's name field, or null when the name is fine. A blank name is left to the screen's own "name every level" message. */
export function levelNameMessage(
  problem: LevelNameProblem | null,
  levelLabel: (index: number) => string,
  t: OnboardingT = englishT,
): string | null {
  if (!problem) return null;
  switch (problem.kind) {
    case 'required':
      return null;
    case 'control_char':
      return t(
        'geography.levels.name_control_char',
        'This name contains a hidden control character, often from copy and paste. Delete the name and type it again.',
      );
    case 'too_long':
      return t('geography.levels.name_too_long', 'This name is %{length} characters long. Use %{max} characters or fewer.', {
        length: problem.length,
        max: problem.max,
      });
    case 'duplicate':
      return t(
        'geography.levels.name_duplicate',
        '%{other} already has this name. Give each level a different name; capital letters and spaces don’t make names different.',
        { other: levelLabel(problem.of) },
      );
  }
}

/** The message under each name field (null where the name is fine), for names in level order. */
export function levelNameMessages(names: readonly string[], levelLabel: (index: number) => string, t: OnboardingT = englishT): (string | null)[] {
  return levelNameProblems(names).map((problem) => levelNameMessage(problem, levelLabel, t));
}

/** Why a hierarchy type name can't be saved, or null: boundary-service stores it in a 64-character column too. */
export function hierarchyTypeMessage(hierarchyType: string, t: OnboardingT = englishT): string | null {
  const length = [...hierarchyType.trim()].length;
  if (length <= MAX_LEVEL_NAME_LENGTH) return null;
  return t('geography.excel.type_too_long', 'The hierarchy type name is %{length} characters long. Use %{max} characters or fewer.', {
    length,
    max: MAX_LEVEL_NAME_LENGTH,
  });
}

/** The sentence below the levels when any name can't be used. */
export const fixLevelNames = (t: OnboardingT = englishT) =>
  t('geography.levels.names_invalid', 'Some level names can’t be used. Fix the names marked above, then continue.');

/**
 * What is wrong with the first level name that can't be used, as a sentence naming it, or null.
 * `exists`: the hierarchy is already on the server, where its names can't change, so only what the
 * persister can't store counts.
 */
export function levelNamesProblem(levels: readonly string[], t: OnboardingT = englishT, exists = false): string | null {
  const problems = levelNameProblems(levels);
  const index = problems.findIndex((p) => p !== null && (!exists || p.kind === 'too_long' || p.kind === 'control_char'));
  if (index < 0) return null;
  const problem = problems[index]!;
  const chars = [...normalizeLevelName(levels[index] ?? '')];
  const name = chars.length > 40 ? `${chars.slice(0, 40).join('')}…` : chars.join('');
  switch (problem.kind) {
    case 'required':
      return t('geography.level_name.required', 'One of the levels has no name.');
    case 'control_char':
      return t('geography.level_name.control_char', 'The level name "%{name}" contains a hidden control character, often from copy and paste.', { name });
    case 'too_long':
      return t('geography.level_name.too_long', 'The level name "%{name}" is %{length} characters long. A level name can have at most %{max}.', {
        name,
        length: problem.length,
        max: problem.max,
      });
    case 'duplicate':
      return t(
        'geography.level_name.duplicate',
        'Two levels are called "%{name}". Each level needs a different name; capital letters and spaces don’t make names different.',
        { name },
      );
  }
}
