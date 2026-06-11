/**
 * Pure value logic for per-escalation-level SLA arrays ([L0, L1, …]),
 * shared by LevelSlaEditor (draft parsing + validation) and the matrix
 * "Levels" column (compact summaries). Kept free of React/UI imports so
 * it stays trivially unit-testable.
 *
 * Two modes exist (see LevelSlaEditor):
 *   - holes allowed (CategorySLA rows): a blank input is null = "use the
 *     state cell at this level"
 *   - policy mode (EscalationPolicy.defaultSlaHoursByLevel): blanks are
 *     rejected — the MDMS schema types items as number, nulls fail at save
 */

export type LevelValues = (number | null)[];

/** Upper bound for any level SLA — one year of hours. */
export const MAX_LEVEL_SLA_HOURS = 8760;

/** Inline error for an out-of-range / non-numeric hours input. */
export const LEVEL_SLA_RANGE_ERROR = 'must be more than 0 and at most 8760 hours';

/** Inline error for a blank input when holes are not allowed (policy mode). */
export const LEVEL_SLA_REQUIRED_ERROR = 'enter hours, or remove this level';

/**
 * Parse one row's raw input. '' → null (a hole); a finite number in
 * (0, 8760] → that number; anything else → undefined (invalid).
 */
export function parseLevelInput(raw: string): number | null | undefined {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return undefined;
  return n > 0 && n <= MAX_LEVEL_SLA_HOURS ? n : undefined;
}

/** Per-row inline error messages for a draft (null = row is valid). */
export function validateLevelInputs(inputs: string[], allowHoles: boolean): (string | null)[] {
  return inputs.map((raw) => {
    const parsed = parseLevelInput(raw);
    if (parsed === undefined) return LEVEL_SLA_RANGE_ERROR;
    if (parsed === null && !allowHoles) return LEVEL_SLA_REQUIRED_ERROR;
    return null;
  });
}

/**
 * Convert a draft to values; invalid rows become null. Only meaningful for
 * saving once validateLevelInputs reports no errors.
 */
export function levelInputsToValues(inputs: string[]): LevelValues {
  return inputs.map((raw) => parseLevelInput(raw) ?? null);
}

/** Seed editor inputs from stored values (holes render as blanks). */
export function levelValuesToInputs(values: LevelValues | null | undefined): string[] {
  return (values ?? []).map((v) => (v === null || v === undefined ? '' : String(v)));
}

/**
 * Trim trailing holes and collapse an effectively-empty array to undefined,
 * so callers can omit the field entirely (MDMS treats a missing key and a
 * trailing-null key identically at resolve time — out-of-bounds and null
 * entries both fall through).
 */
export function normalizeLevelValues(values: LevelValues | null | undefined): LevelValues | undefined {
  if (!values) return undefined;
  let end = values.length;
  while (end > 0 && (values[end - 1] === null || values[end - 1] === undefined)) end--;
  if (end === 0) return undefined;
  return values.slice(0, end).map((v) => (v === undefined ? null : v));
}

/**
 * True when the array carries no usable value: unset, empty, or no entry
 * the scheduler would honour (positive number). Matches the "rows with
 * ≥1 entry > 0" counting the Escalation Settings cascade chips use.
 */
export function isLevelValuesEmpty(values: LevelValues | null | undefined): boolean {
  if (!values) return true;
  return !values.some((v) => typeof v === 'number' && v > 0);
}

/**
 * Compact matrix-cell summary: "L0 120 · L1 — · L2 24" (holes render as
 * "—"); returns "—" when the array carries no usable value.
 */
export function formatLevelSummary(values: LevelValues | null | undefined): string {
  if (isLevelValuesEmpty(values)) return '—';
  return (values ?? [])
    .map((v, i) => `L${i} ${typeof v === 'number' && v > 0 ? v : '—'}`)
    .join(' · ');
}

/** Editor row label — L0 is the first assignment, not the first escalation. */
export function levelLabel(index: number): string {
  return index === 0 ? 'L0 (first assignment)' : `L${index}`;
}
