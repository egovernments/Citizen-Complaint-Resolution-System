import type { BoundaryExcelRow } from '@/api/types';

/** A boundary already in the hierarchy: its parent (none at the top) and its en_IN name, if it has one. */
export interface ExistingBoundary {
  code: string;
  parent?: string;
  name?: string;
}

export interface BoundaryConflict {
  code: string;
  row?: number;
  current: { name?: string; parent?: string };
  sheet: { name: string; parent?: string };
}

/**
 * Sort a sheet's rows against the hierarchy they go into (#2456). boundary-service answers
 * "already exists" for a code it has, which counts as created, and the upload then writes the
 * sheet's name for it. So a code already there under another name or parent would be renamed,
 * or keep its old parent, without a word: those rows are conflicts, and the sheet is refused.
 * A row matching what is there (a re-listed parent, or a retry) is left alone.
 */
export function compareWithExisting(rows: BoundaryExcelRow[], existing: ExistingBoundary[]) {
  const byCode = new Map(existing.map((boundary) => [boundary.code, boundary]));
  const toCreate: BoundaryExcelRow[] = [];
  const alreadyThere: BoundaryExcelRow[] = [];
  const conflicts: BoundaryConflict[] = [];
  for (const row of rows) {
    const found = byCode.get(row.code);
    if (!found) {
      toCreate.push(row);
      continue;
    }
    const parent = row.parentCode || undefined;
    const name = row.name.trim();
    // A boundary with no en_IN name has no name to change.
    const sameName = !found.name?.trim() || found.name.trim() === name;
    if ((found.parent || undefined) === parent && sameName) {
      alreadyThere.push(row);
    } else {
      conflicts.push({
        code: row.code,
        row: row.row,
        current: { name: found.name?.trim() || undefined, parent: found.parent || undefined },
        sheet: { name, parent },
      });
    }
  }
  return { toCreate, alreadyThere, conflicts };
}
