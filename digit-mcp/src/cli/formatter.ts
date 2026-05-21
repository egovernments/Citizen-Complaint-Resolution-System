/**
 * Output formatter for CLI results.
 *
 * Three modes:
 * - json:  Raw JSON (default when piped)
 * - table: Formatted key-value or tabular output (default on TTY)
 * - plain: Minimal output for scripting
 */

export type OutputFormat = 'json' | 'table' | 'plain';

/** Whether color output should be used (respects NO_COLOR, TERM=dumb, --no-color). */
export function shouldColor(): boolean {
  if (process.env.NO_COLOR !== undefined) return false;
  if (process.env.TERM === 'dumb') return false;
  if (process.argv.includes('--no-color')) return false;
  // Check stdout first, fall back to stderr (npx tsx may not set stdout.isTTY)
  return !!(process.stdout.isTTY || process.stderr.isTTY);
}

/** Detect default output format based on TTY. */
export function defaultFormat(): OutputFormat {
  return (process.stdout.isTTY || process.stderr.isTTY) ? 'table' : 'json';
}

/** Format and print a tool handler's JSON result string. */
export function formatOutput(jsonStr: string, format: OutputFormat): string {
  let data: unknown;
  try {
    data = JSON.parse(jsonStr);
  } catch {
    // Not JSON — return raw
    return jsonStr;
  }

  switch (format) {
    case 'json':
      return JSON.stringify(data, null, 2);
    case 'plain':
      return formatPlain(data);
    case 'table':
      return formatTable(data);
  }
}

/** Plain mode: extract the most useful single value. */
function formatPlain(data: unknown): string {
  if (data === null || data === undefined) return '';
  if (typeof data !== 'object') return String(data);

  const obj = data as Record<string, unknown>;

  // Error case
  if (obj.success === false && obj.error) {
    return `ERROR: ${obj.error}`;
  }

  // If there's a primary data array, count it
  const arrayKey = findArrayKey(obj);
  if (arrayKey) {
    const arr = obj[arrayKey] as unknown[];
    return `${arr.length} ${arrayKey}`;
  }

  // Single value responses
  if (obj.success === true && Object.keys(obj).length === 2) {
    const valueKey = Object.keys(obj).find((k) => k !== 'success');
    if (valueKey) return String(obj[valueKey]);
  }

  return JSON.stringify(data);
}

/** Table mode: format as bordered key-value pairs or tabular data. */
function formatTable(data: unknown): string {
  if (data === null || data === undefined) return '';
  if (typeof data !== 'object') return String(data);

  const obj = data as Record<string, unknown>;

  // Error case — red
  if (obj.success === false) {
    const lines = [`${c(RED, 'Error:')} ${obj.error || 'Unknown error'}`];
    if (obj.hint) lines.push(`${c(YELLOW, 'Hint:')} ${obj.hint}`);
    if (obj.suggestions) lines.push(`${c(YELLOW, 'Suggestions:')} ${(obj.suggestions as string[]).join(', ')}`);
    return lines.join('\n');
  }

  // Find the primary data array for tabular display
  const arrayKey = findArrayKey(obj);
  if (arrayKey) {
    const arr = obj[arrayKey] as Record<string, unknown>[];
    if (arr.length === 0) return `No ${arrayKey} found.`;
    return formatArrayAsTable(arr, arrayKey);
  }

  // Key-value display for single-object responses
  return formatKeyValue(obj);
}

/** Find the first array-valued key in a response object (skip metadata). */
function findArrayKey(obj: Record<string, unknown>): string | undefined {
  const skip = new Set(['success', 'error', 'hint', 'suggestions', 'truncated', 'total', 'limit', 'offset', 'page_count']);
  for (const [key, value] of Object.entries(obj)) {
    if (skip.has(key)) continue;
    if (Array.isArray(value)) return key;
  }
  return undefined;
}

/** Format an array of objects as an aligned table. */
function formatArrayAsTable(arr: Record<string, unknown>[], label: string): string {
  if (arr.length === 0) return `No ${label}.`;

  // Pick columns: use keys from first item, prefer short scalar values
  const allKeys = Object.keys(arr[0]);
  const columns = allKeys.filter((k) => {
    const sample = arr[0][k];
    return sample === null || sample === undefined || typeof sample !== 'object';
  }).slice(0, 8); // max 8 columns

  if (columns.length === 0) {
    // All values are objects — fall back to JSON
    return JSON.stringify(arr, null, 2);
  }

  // Build rows (raw text for width calculation)
  const headers = columns.map((col) => col.toUpperCase());
  const dataRows: string[][] = [];
  for (const item of arr) {
    dataRows.push(columns.map((col) => formatCell(item[col])));
  }

  // Calculate column widths from raw text (before color codes)
  const allRows = [headers, ...dataRows];
  const widths = columns.map((_, i) =>
    Math.min(40, Math.max(...allRows.map((r) => r[i].length)))
  );

  // Render with color
  const lines: string[] = [];

  // Header row — bold
  const headerCells = headers.map((h, i) => c(BOLD, h.padEnd(widths[i])));
  lines.push(headerCells.join('  '));
  lines.push(c(DIM, widths.map((w) => '─'.repeat(w)).join('──')));

  // Data rows — color-code status-like values
  for (const row of dataRows) {
    const cells = row.map((cell, i) => {
      const padded = cell.padEnd(widths[i]);
      return colorizeValue(padded, columns[i]);
    });
    lines.push(cells.join('  '));
  }

  const countLine = arr.length > 1 ? `\n${c(DIM, `${arr.length} ${label}`)}` : '';
  return lines.join('\n') + countLine;
}

/** Format a key-value object for display. */
function formatKeyValue(obj: Record<string, unknown>): string {
  const lines: string[] = [];
  const skip = new Set(['success']);

  for (const [key, value] of Object.entries(obj)) {
    if (skip.has(key)) continue;
    if (value === null || value === undefined) continue;

    if (typeof value === 'object' && !Array.isArray(value)) {
      // Nested object — inline JSON
      lines.push(`${c(BOLD, key + ':')}`)
      lines.push(indent(JSON.stringify(value, null, 2), '  '));
    } else if (Array.isArray(value)) {
      lines.push(`${c(BOLD, key + ':')} ${value.length} items`);
    } else {
      lines.push(`${c(BOLD, key + ':')} ${value}`);
    }
  }
  return lines.join('\n');
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value.length > 40 ? value.slice(0, 37) + '...' : value;
  return String(value);
}

function indent(text: string, prefix: string): string {
  return text.split('\n').map((line) => prefix + line).join('\n');
}

/** Wrap text in ANSI escape codes, respecting NO_COLOR. */
function c(code: string, text: string): string {
  if (!shouldColor()) return text;
  return `${code}${text}\x1b[0m`;
}

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';

/** Color-code values based on column name and content. */
function colorizeValue(padded: string, column: string): string {
  const val = padded.trim();
  const col = column.toLowerCase();

  // Status columns — green for resolved/active, red for rejected, yellow for pending
  if (col === 'status' || col === 'applicationstatus') {
    if (val.startsWith('RESOLVED') || val.startsWith('CLOSEDAFTER') || val === 'active' || val === 'true') return c(GREEN, padded);
    if (val.startsWith('REJECTED') || val === 'inactive' || val === 'false') return c(RED, padded);
    if (val.startsWith('PENDING')) return c(YELLOW, padded);
  }

  // Boolean-like columns
  if (val === 'true' || val === 'OK') return c(GREEN, padded);
  if (val === 'false' || val === 'CRITICAL') return c(RED, padded);
  if (val === 'WARN') return c(YELLOW, padded);

  // ID columns — cyan for readability
  if ((col.endsWith('id') || col.endsWith('code')) && val.length > 8) return c(CYAN, padded);

  return padded;
}
