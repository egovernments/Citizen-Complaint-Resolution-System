/**
 * Client-side mirror of the backend SLA resolution
 * (EscalationScheduler.resolveSlaHours + cellToMillis + levelCellToMillis),
 * kept in hours instead of milliseconds.
 *
 * Precedence (first source with a value wins):
 *   1. CategorySLA per-level cell   — first matching ACTIVE row's
 *      slaHoursByLevel[level], positive numbers only
 *   2. CategorySLA per-state cell   — same row's slaHoursByState[stateKey]
 *   3. EscalationPolicy level default — defaultSlaHoursByLevel[level]
 *   4. StateSLA default             — stateDefaults[stateKey]
 *   5. v0 EscalationConfig          — terminal fallback, never a miss;
 *      its value lives server-side (overrides + static config), so the
 *      preview reports the source with hours=null
 *
 * Exact-mirror notes (each verified against EscalationScheduler.java):
 *   - The row loop locks onto the FIRST active row matching the
 *     (path, category, subcategoryL1) tuple that carries a
 *     slaHoursByState object: level miss + state miss on that row BREAKS
 *     (later matching rows are never consulted). A matching row WITHOUT a
 *     slaHoursByState object is skipped (`continue`), not locked.
 *   - Range cells collapse via Math.max(r0, r1) — reversed pairs like
 *     [120, 24] resolve to 120.
 *   - Null / zero / negative / out-of-bounds level entries fall through.
 *   - StateSLA defaults win on ANY non-null number (the backend does not
 *     positivity-check this layer), so an explicit 0 means "0 hours".
 *   - The escalation level comes from additionalDetail.escalationLevel
 *     (default 0). Category tuple extraction is from additionalDetail
 *     ONLY — the backend's ServiceDefs fallback (Strategy B) is NOT
 *     mirrored client-side; the server's slaSource response field is the
 *     truth signal when the two disagree.
 */
import type { CategorySlaRecord, CellValue, StateDefaults } from './types';

/**
 * Winning-source identifiers — byte-for-byte the PGRConstants.SLA_SOURCE_*
 * values the server returns in EscalationOutcome.slaSource, so UI code can
 * compare the client preview against the server verdict directly.
 */
export const SLA_SOURCE = {
  categoryLevel: 'CRS.CategorySLA.level',
  categoryState: 'CRS.CategorySLA',
  policyLevel: 'CRS.EscalationPolicy.level',
  stateDefault: 'CRS.StateSLA',
  legacy: 'v0.EscalationConfig',
} as const;

export type SlaSource = (typeof SLA_SOURCE)[keyof typeof SLA_SOURCE];

/** Cascade order, for rendering resolution-path lists. */
export const SLA_SOURCE_ORDER: SlaSource[] = [
  SLA_SOURCE.categoryLevel,
  SLA_SOURCE.categoryState,
  SLA_SOURCE.policyLevel,
  SLA_SOURCE.stateDefault,
  SLA_SOURCE.legacy,
];

export interface SlaPreviewComplaint {
  /** Current workflow state (applicationStatus), e.g. PENDINGATLME. */
  workflowState?: string | null;
  /** additionalDetail.escalationLevel; anything non-numeric counts as 0. */
  escalationLevel?: number | null;
  path?: string | null;
  category?: string | null;
  subcategoryL1?: string | null;
}

export interface SlaPreviewConfig {
  /** CategorySLA rows in load order (MatrixRow[] satisfies this). */
  rows: CategorySlaRecord[];
  /** CRS.StateSLA singleton values; null/absent = not configured. */
  stateDefaults?: StateDefaults | null;
  /** CRS.EscalationPolicy record data; null/absent = not configured. */
  policy?: { defaultSlaHoursByLevel?: number[] } | null;
  /**
   * CRS.WorkflowStateMapping `mappings` object; null/absent/empty means no
   * workflow state resolves to a column key, so both per-state sources are
   * skipped — exactly the backend's behaviour with an unseeded mapping.
   */
  stateMapping?: Record<string, string> | null;
}

/** One row of the resolution-path annotation. */
export interface SlaSourcePreview {
  source: SlaSource;
  /**
   * Hours this source would contribute at the complaint's level/state —
   * null when it holds no value here. Always null for the legacy source
   * (its value lives server-side).
   */
  hours: number | null;
  /** Original cell, when the source is a CategorySLA state cell (ranges). */
  rawValue?: CellValue;
  /**
   * True when the source structurally cannot apply: per-state sources with
   * no resolved state key, per-category sources with no category tuple.
   */
  blocked?: boolean;
}

export interface ResolvedSlaPreview {
  /** Winning source — same string the server reports as slaSource. */
  source: SlaSource;
  /** Winner's hours; null when the legacy fallback wins. */
  hours: number | null;
  /** Raw winning cell when a CategorySLA state cell won (ranges render as ranges). */
  rawValue?: CellValue;
  /** Resolved SLA-column key, or null when the state isn't mapped. */
  stateKey: string | null;
  /** Escalation level the resolution ran at. */
  level: number;
  /** The row the loop locked onto (or returned from); null when none matched. */
  matchedRow: CategorySlaRecord | null;
  /** Backend's unmappedCategory flag: no (path, category, subcategoryL1) tuple. */
  unmappedCategory: boolean;
  /** Backend's stateMappingMissing flag: legacy answered AND the state had no key. */
  stateMappingMissing: boolean;
  /** Per-source annotations in cascade order (4 CRS sources + legacy). */
  sources: SlaSourcePreview[];
}

/**
 * Mirror of EscalationScheduler.cellToMillis, in hours. Numbers must be
 * positive; [a, b] ranges collapse to Math.max(a, b) and that max must be
 * positive; everything else is null (fall through).
 */
export function cellToHours(cell: unknown): number | null {
  if (typeof cell === 'number') {
    return cell > 0 ? cell : null;
  }
  if (Array.isArray(cell) && cell.length === 2 && typeof cell[0] === 'number' && typeof cell[1] === 'number') {
    const hi = Math.max(cell[0], cell[1]);
    return hi > 0 ? hi : null;
  }
  return null;
}

/**
 * Mirror of EscalationScheduler.levelCellToMillis, in hours: out-of-bounds
 * index, null entry, non-number or non-positive ⇒ null (fall through).
 */
export function levelCellToHours(byLevel: unknown, level: number): number | null {
  if (!Array.isArray(byLevel)) return null;
  if (level < 0 || level >= byLevel.length) return null;
  const cell = byLevel[level];
  if (typeof cell !== 'number') return null;
  return cell > 0 ? cell : null;
}

export function resolveSlaPreview(
  complaint: SlaPreviewComplaint,
  config: SlaPreviewConfig,
): ResolvedSlaPreview {
  const level =
    typeof complaint.escalationLevel === 'number' && Number.isFinite(complaint.escalationLevel)
      ? Math.trunc(complaint.escalationLevel)
      : 0;

  // mapWorkflowStateToKey: null state or null/empty mapping → null.
  const stateKey =
    complaint.workflowState && config.stateMapping
      ? config.stateMapping[complaint.workflowState] ?? null
      : null;

  // extractCategoryTuple (additionalDetail half only — no ServiceDefs).
  // Null-check, not truthiness: the backend forms a tuple from empty strings
  // too (extractCategoryTuple only guards against null).
  const tuple =
    complaint.path != null && complaint.category != null && complaint.subcategoryL1 != null
      ? { path: complaint.path, category: complaint.category, subcategoryL1: complaint.subcategoryL1 }
      : null;

  let unmappedCategory = false;
  let matchedRow: CategorySlaRecord | null = null;
  let winner: SlaSource | null = null;
  let winnerHours: number | null = null;
  let winnerRaw: CellValue | undefined;

  // 1+2) CategorySLA — the per-level cell wins over the per-state cell on
  // the same row; the loop mirrors the backend's continue/break exactly.
  if (tuple !== null) {
    for (const row of config.rows) {
      if (row.isActive === false) continue;
      if (row.path !== tuple.path) continue;
      if (row.category !== tuple.category) continue;
      if (row.subcategoryL1 !== tuple.subcategoryL1) continue;
      const levelHours = levelCellToHours(row.slaHoursByLevel, level);
      if (levelHours !== null) {
        matchedRow = row;
        winner = SLA_SOURCE.categoryLevel;
        winnerHours = levelHours;
        break;
      }
      const by: unknown = row.slaHoursByState;
      // Backend: `if (!(by instanceof Map)) continue;` — a matching row
      // without a state-cell object is skipped, NOT locked.
      if (by === null || typeof by !== 'object' || Array.isArray(by)) continue;
      const cell = stateKey === null ? null : (by as Record<string, CellValue>)[stateKey];
      const cellHours = cellToHours(cell);
      matchedRow = row;
      if (cellHours !== null) {
        winner = SLA_SOURCE.categoryState;
        winnerHours = cellHours;
        winnerRaw = cell as CellValue;
      }
      break; // matched row, hit or not — later rows are never consulted
    }
  } else {
    unmappedCategory = true;
  }

  // 3) EscalationPolicy per-level default
  const policyHours = levelCellToHours(config.policy?.defaultSlaHoursByLevel, level);
  if (winner === null && policyHours !== null) {
    winner = SLA_SOURCE.policyLevel;
    winnerHours = policyHours;
  }

  // 4) StateSLA default — any non-null number wins, no positivity check
  // (mirrors the backend's `defHrs != null` guard).
  const stateDefaultRaw =
    stateKey !== null && config.stateDefaults
      ? (config.stateDefaults as unknown as Record<string, number | null | undefined>)[stateKey]
      : null;
  const stateDefaultHours = typeof stateDefaultRaw === 'number' ? stateDefaultRaw : null;
  if (winner === null && stateDefaultHours !== null) {
    winner = SLA_SOURCE.stateDefault;
    winnerHours = stateDefaultHours;
  }

  // 5) v0 EscalationConfig — terminal fallback, never a miss. The
  // stateMappingMissing flag is only raised when legacy answers (matching
  // the backend, which computes it at this layer only).
  const stateMappingMissing = winner === null && stateKey === null;
  if (winner === null) {
    winner = SLA_SOURCE.legacy;
    winnerHours = null;
  }

  // --- Per-source annotations (from the locked row, post-walk) ---
  const matchedStateRaw =
    matchedRow && stateKey !== null && matchedRow.slaHoursByState && typeof matchedRow.slaHoursByState === 'object'
      ? (matchedRow.slaHoursByState as Record<string, CellValue>)[stateKey]
      : undefined;
  const sources: SlaSourcePreview[] = [
    {
      source: SLA_SOURCE.categoryLevel,
      hours: matchedRow ? levelCellToHours(matchedRow.slaHoursByLevel, level) : null,
      blocked: tuple === null ? true : undefined,
    },
    {
      source: SLA_SOURCE.categoryState,
      hours: cellToHours(matchedStateRaw),
      rawValue: matchedStateRaw ?? undefined,
      blocked: tuple === null || stateKey === null ? true : undefined,
    },
    {
      source: SLA_SOURCE.policyLevel,
      hours: policyHours,
    },
    {
      source: SLA_SOURCE.stateDefault,
      hours: stateDefaultHours,
      blocked: stateKey === null ? true : undefined,
    },
    {
      source: SLA_SOURCE.legacy,
      hours: null,
    },
  ];

  return {
    source: winner,
    hours: winnerHours,
    rawValue: winnerRaw,
    stateKey,
    level,
    matchedRow,
    unmappedCategory,
    stateMappingMissing,
    sources,
  };
}
