// Client-side data-quality summary for Phase 2's level screen (#1994): per
// selected level, how many areas the source returned, how many will actually be
// created, and where the data stops.
//
// "Dangling" is measured exactly the way the boundaries will be built — by
// buildOsmBoundaries' geometric parenting between consecutive selected levels —
// not from the source's parent_id. On Overture, parent_id looks clean (only the
// country roots lack one) while the real build still drops places whose point
// falls in no parent polygon; a parent_id count would report all-clear.
import { buildOsmBoundaries, type OsmAdminLevel } from './osmBoundaries';

export interface LevelQuality {
  level: number;
  /** Areas the source returned at this level. */
  total: number;
  /** Areas that will be created. */
  kept: number;
  /** No usable (romanizable) name — skipped. */
  unnamed: number;
  /** Representative point falls in no area of the level above — skipped. */
  noParent: number;
  /** Kept areas of the level above; null for the top level. */
  parentsTotal: number | null;
  /** How many of those have at least one area at this level. The rest are where the data stops. */
  parentsCovered: number | null;
}

export interface BoundaryQuality {
  levels: LevelQuality[];
  totalAreas: number;
  kept: number;
  skipped: number;
}

/** Summary of the SELECTED levels, or null while they can't form a hierarchy
 *  (fewer than two, or a gap — the same shape rule the level screen enforces). */
export function summarizeBoundaryQuality(allLevels: OsmAdminLevel[]): BoundaryQuality | null {
  const sorted = [...allLevels].sort((a, b) => a.level - b.level);
  const idx = sorted.flatMap((l, i) => (l.selected ? [i] : []));
  if (idx.length < 2 || idx[idx.length - 1] - idx[0] !== idx.length - 1) return null;

  // Placeholder level names: the operator may not have named them yet, and the
  // build only needs them to be distinct.
  const selected = idx.map((i) => ({ ...sorted[i], mappedName: `L${sorted[i].level}` }));
  const { boundaries, skipped } = buildOsmBoundaries(selected, 'quality', 'QUALITY');

  const levels: LevelQuality[] = [];
  let aboveCodes: string[] | null = null;
  for (const lvl of selected) {
    const mine = boundaries.filter((b) => b.boundaryType === lvl.mappedName);
    const drops = skipped.filter((s) => s.osmLevel === lvl.level);
    const parentsWithChildren = new Set(mine.map((b) => b.parent));
    levels.push({
      level: lvl.level,
      total: lvl.features.length,
      kept: mine.length,
      unnamed: drops.filter((s) => s.reason !== 'no parent found').length,
      noParent: drops.filter((s) => s.reason === 'no parent found').length,
      parentsTotal: aboveCodes ? aboveCodes.length : null,
      parentsCovered: aboveCodes ? aboveCodes.filter((c) => parentsWithChildren.has(c)).length : null,
    });
    aboveCodes = mine.map((b) => b.code);
  }
  const totalAreas = levels.reduce((n, l) => n + l.total, 0);
  const kept = levels.reduce((n, l) => n + l.kept, 0);
  return { levels, totalAreas, kept, skipped: totalAreas - kept };
}
