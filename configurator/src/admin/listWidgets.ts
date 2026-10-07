// Pure projections behind the descriptor `listWidget` kinds (see
// schemaDescriptors/types.ts). React-free so the shaping rules — which are the
// part that can actually be wrong — are unit-testable without rendering a table.
//
// Everything here takes `unknown`: these values come off an MDMS record, which
// the generic list never validates against the schema. A row whose `actors` is
// a string, or whose `placeholders` entries have no `name`, must render as a
// quiet nothing rather than throw inside a table cell.

/** How many tokens `tokenSummary` prints before it gives up and says "…". */
export const TOKEN_PREVIEW_LIMIT = 3;

function arrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}

/** `["SMS","EMAIL"]` -> `['SMS', 'EMAIL']`. Blanks and non-scalars are dropped. */
export function badgeValues(value: unknown): string[] {
  return arrayOf(value)
    .map((v) => (v != null && typeof v === 'object' ? '' : text(v)))
    .filter(Boolean);
}

/** `[{name, label}]` -> the `name`s. Used for the event catalogue's `actors`. */
export function namedBadgeValues(value: unknown): string[] {
  return arrayOf(value)
    .map((v) => (v && typeof v === 'object' ? text((v as Record<string, unknown>).name) : text(v)))
    .filter(Boolean);
}

export interface TokenSummary {
  /** How many tokens the row declares. 0 means the cell should render nothing. */
  count: number;
  /** The first few, brace-wrapped: `['{id}', '{complaint_type}']`. */
  preview: string[];
  /** True when `preview` is shorter than `count`, so the cell prints a trailing "…". */
  truncated: boolean;
  /** Every token, brace-wrapped and space-joined — the cell's `title` tooltip. */
  full: string;
}

/**
 * Compact the placeholder vocabulary of an event-catalogue row.
 *
 * The full array is ~1,700 characters of JSON for a PGR event; printed verbatim
 * it is what made the Events list ~857px per row. The count is the number an
 * operator is actually scanning for, and the first few names say WHICH
 * vocabulary it is; the rest stays one hover (or one click into Show) away.
 */
export function tokenSummary(value: unknown, limit: number = TOKEN_PREVIEW_LIMIT): TokenSummary {
  const names = namedBadgeValues(value);
  const braced = names.map((n) => `{${n}}`);
  return {
    count: braced.length,
    preview: braced.slice(0, Math.max(0, limit)),
    truncated: braced.length > Math.max(0, limit),
    full: braced.join(' '),
  };
}
