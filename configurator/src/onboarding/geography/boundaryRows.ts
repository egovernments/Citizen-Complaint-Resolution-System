import { englishT, type OnboardingT } from '../i18n';
import type { BoundaryExcelRow, BoundaryLevel } from '@/api/types';

export interface CheckedRows {
  valid: BoundaryExcelRow[];
  invalid: { boundary: BoundaryExcelRow; error: string }[];
}

/**
 * Each level's parent level, broadest first. A hierarchy read from the server
 * says so per level (parentBoundaryType); one without it is taken in order.
 */
function parentLevels(levels: BoundaryLevel[]): Map<string, string | undefined> {
  const named = levels.filter((level) => level.boundaryType?.trim());
  const explicit = named.some((level) => level.parentBoundaryType?.trim());
  const parents = new Map<string, string | undefined>();
  named.forEach((level, index) => {
    const parent = explicit ? level.parentBoundaryType?.trim() || undefined : index > 0 ? named[index - 1].boundaryType : undefined;
    parents.set(level.boundaryType, parent);
  });
  // Top down, so "Use one of" lists them as the hierarchy reads.
  const depth = (type: string, seen = new Set<string>()): number => {
    const parent = parents.get(type);
    if (!parent || !parents.has(parent) || seen.has(type)) return 0;
    seen.add(type);
    return 1 + depth(parent, seen);
  };
  return new Map([...parents].sort(([a], [b]) => depth(a) - depth(b)));
}

/**
 * The Excel preview's check of a boundary sheet against the hierarchy it goes
 * into, before anything is written (#2795, #2796). boundary-service refuses a
 * relationship whose type isn't one of the hierarchy's levels, or whose parent
 * isn't on the level directly above; caught only on save, such a row half-saved
 * the sheet. A row is refused when:
 *   - its code, name or type is missing;
 *   - its type isn't one of the hierarchy's levels;
 *   - it has no parent but isn't on the top level, or is on the top level and has one;
 *   - its parent isn't in the sheet, or isn't on the level directly above it;
 *   - its parent row is refused (it couldn't be saved without it).
 * Each refusal names the row and what to change.
 */
export function checkBoundaryRows(rows: BoundaryExcelRow[], levels: BoundaryLevel[], t: OnboardingT = englishT): CheckedRows {
  const parentOf = parentLevels(levels);
  const levelNames = [...parentOf.keys()];
  const top = levelNames.filter((type) => !parentOf.get(type));
  const byCode = new Map(rows.filter((row) => row.code).map((row) => [row.code, row]));
  const errors = new Map<BoundaryExcelRow, string[]>(rows.map((row) => [row, []]));
  const isLevel = (type: string) => parentOf.has(type);

  for (const row of rows) {
    const found = errors.get(row)!;
    if (!row.code) found.push(t('geography.excel.missing_code', 'Missing boundary code'));
    if (!row.name) found.push(t('geography.excel.missing_name', 'Missing boundary name'));
    if (!row.boundaryType) found.push(t('geography.excel.missing_type', 'Missing boundary type'));

    // A hierarchy without levels can't be checked against; the save says why.
    const checkLevels = levelNames.length > 0;
    if (checkLevels && row.boundaryType && !isLevel(row.boundaryType)) {
      found.push(
        t('geography.excel.type_not_a_level', '"%{type}" isn’t a level of this hierarchy. Use one of: %{levels}.', {
          type: row.boundaryType,
          levels: levelNames.join(', '),
        }),
      );
    }
    const expectedParent = checkLevels && isLevel(row.boundaryType) ? parentOf.get(row.boundaryType) : undefined;

    if (!row.parentCode) {
      if (checkLevels && isLevel(row.boundaryType) && expectedParent) {
        found.push(
          t('geography.excel.parent_required', 'A %{type} needs a parent %{parentType} in parentCode. Only the top level (%{top}) can be left without one.', {
            type: row.boundaryType,
            parentType: expectedParent,
            top: top.join(', '),
          }),
        );
      }
      continue;
    }
    const parent = byCode.get(row.parentCode);
    if (!parent) {
      found.push(t('geography.excel.parent_missing', 'Parent "%{code}" not found', { code: row.parentCode }));
      continue;
    }
    if (!checkLevels || !isLevel(row.boundaryType)) continue;
    if (!expectedParent) {
      found.push(
        t('geography.excel.top_has_parent', '%{type} is the top level, so it can’t have a parent. Leave its parentCode empty.', {
          type: row.boundaryType,
        }),
      );
    } else if (isLevel(parent.boundaryType) && parent.boundaryType !== expectedParent) {
      found.push(
        t('geography.excel.parent_wrong_level', 'A %{type}’s parent must be a %{expected}, but "%{parent}" is a %{parentType}.', {
          type: row.boundaryType,
          expected: expectedParent,
          parent: row.parentCode,
          parentType: parent.boundaryType,
        }),
      );
    }
  }

  // A row under a refused row can't be saved either: its parent wouldn't be there.
  // Repeated until nothing changes, so a refusal reaches the whole subtree.
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      const found = errors.get(row)!;
      if (found.length > 0 || !row.parentCode) continue;
      const parent = byCode.get(row.parentCode);
      if (parent && parent !== row && errors.get(parent)!.length > 0) {
        found.push(
          t('geography.excel.parent_has_error', 'Its parent "%{code}" has an error, so it can’t be added until that row is fixed.', {
            code: row.parentCode,
          }),
        );
        changed = true;
      }
    }
  }

  const valid: BoundaryExcelRow[] = [];
  const invalid: CheckedRows['invalid'] = [];
  for (const row of rows) {
    const found = errors.get(row)!;
    if (found.length === 0) {
      valid.push(row);
      continue;
    }
    const error = found.join('; ');
    invalid.push({
      boundary: row,
      error: row.row ? t('geography.excel.row_error', 'Row %{row}: %{error}', { row: row.row, error }) : error,
    });
  }
  return { valid, invalid };
}
