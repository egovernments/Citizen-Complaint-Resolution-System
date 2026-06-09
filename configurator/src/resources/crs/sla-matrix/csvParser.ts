/**
 * Tiny RFC-4180-ish CSV parser used by the SLA matrix bulk-import modal.
 *
 * Why not papaparse? The configurator already ships `xlsx` for XLSX
 * support — adding a second parsing dep just for CSV felt excessive when
 * the import shape is fixed (10 columns, no nested quoting in practice).
 * The parser handles: quoted fields, doubled quotes inside quotes, commas
 * inside quoted fields, CR/LF line endings, trailing newlines.
 */

import type { CategorySlaRecord, CellValue, Path, SlaHoursByState, StateKey } from './types';
import { PATHS, STATE_KEYS, makeCategoryUid } from './types';
import * as XLSX from 'xlsx';

export interface ParsedRow {
  rowNumber: number; // 1-indexed, includes header row
  record?: CategorySlaRecord;
  errors: string[];
}

export interface ParseResult {
  rows: ParsedRow[];
  totalValid: number;
  totalInvalid: number;
}

const REQUIRED_COLS = ['path', 'category', 'subcategoryL1'];
const SLA_COL_KEYS: Record<string, StateKey> = {
  sla_new: 'new',
  sla_triage: 'triage',
  sla_forwarded: 'forwarded',
  sla_investigation: 'investigation',
  sla_awaiting: 'awaiting',
  sla_resolved: 'resolved',
};

/** Naive but correct CSV row splitter. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else if (ch === '"' && cur === '') {
      inQuotes = true;
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/**
 * Parses a single SLA cell from the spreadsheet:
 *   ""     → null
 *   "120"  → 120
 *   "24-120" → [24, 120]
 * Returns the parsed value plus an error message (or empty string).
 */
function parseCell(raw: string): { value: CellValue; error: string } {
  const v = raw.trim();
  if (v === '') return { value: null, error: '' };
  if (v.includes('-')) {
    const [lo, hi] = v.split('-').map((s) => Number(s.trim()));
    if (Number.isFinite(lo) && Number.isFinite(hi) && lo > 0 && hi > 0 && lo < hi && hi < 8760) {
      return { value: [lo, hi], error: '' };
    }
    return { value: null, error: `invalid range "${v}" (expected "min-max" with 0 < min < max < 8760)` };
  }
  const n = Number(v);
  if (Number.isFinite(n) && n > 0 && n < 8760) {
    return { value: n, error: '' };
  }
  return { value: null, error: `invalid number "${v}" (expected 0 < n < 8760)` };
}

function buildRecord(rowNumber: number, raw: Record<string, string>): ParsedRow {
  const errors: string[] = [];
  for (const col of REQUIRED_COLS) {
    if (!raw[col] || raw[col].trim() === '') {
      errors.push(`missing required column "${col}"`);
    }
  }
  const path = raw.path?.trim() as Path;
  if (raw.path && !PATHS.includes(path)) {
    errors.push(`invalid path "${raw.path}" (expected one of ${PATHS.join(', ')})`);
  }
  const slaHoursByState: SlaHoursByState = {};
  for (const [colName, stateKey] of Object.entries(SLA_COL_KEYS)) {
    const cellRaw = raw[colName] ?? '';
    const { value, error } = parseCell(cellRaw);
    if (error) errors.push(`${colName}: ${error}`);
    slaHoursByState[stateKey] = value;
  }
  if (errors.length) {
    return { rowNumber, errors };
  }
  // All cells null is a soft warning, not an error — the row still
  // expresses a (path/cat/sub) tuple that downstream operators may
  // want to fill later.
  return {
    rowNumber,
    errors: [],
    record: {
      path,
      category: raw.category.trim(),
      subcategoryL1: raw.subcategoryL1.trim(),
      slaHoursByState,
      isActive: true,
    },
  };
}

export function parseCsv(text: string): ParseResult {
  // Strip BOM, normalize line endings.
  const cleaned = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const lines = cleaned.split('\n').filter((l) => l.length > 0);
  if (lines.length === 0) {
    return { rows: [], totalValid: 0, totalInvalid: 0 };
  }
  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  const rows: ParsedRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    const raw: Record<string, string> = {};
    header.forEach((h, idx) => {
      raw[h] = cols[idx] ?? '';
    });
    rows.push(buildRecord(i + 1, raw));
  }
  return {
    rows,
    totalValid: rows.filter((r) => r.errors.length === 0).length,
    totalInvalid: rows.filter((r) => r.errors.length > 0).length,
  };
}

/**
 * Parses XLSX (first sheet) into the same shape as parseCsv. Uses the
 * `xlsx` dep already in package.json — no new dependency needed.
 */
export function parseXlsx(buffer: ArrayBuffer): ParseResult {
  const wb = XLSX.read(buffer, { type: 'array' });
  const firstSheet = wb.Sheets[wb.SheetNames[0]];
  // Convert to CSV first (handles the header detection + cell normalization
  // for us) then run through the same parser.
  const csv = XLSX.utils.sheet_to_csv(firstSheet);
  return parseCsv(csv);
}

/** Render the parsed rows back to a CSV string (used by Export CSV). */
export function recordsToCsv(records: CategorySlaRecord[]): string {
  const header = 'path,category,subcategoryL1,sla_new,sla_triage,sla_forwarded,sla_investigation,sla_awaiting,sla_resolved';
  const lines = records.map((r) => {
    const cells = STATE_KEYS.map((k) => {
      const v = r.slaHoursByState[k];
      if (v === null || v === undefined) return '';
      if (Array.isArray(v)) return `${v[0]}-${v[1]}`;
      return String(v);
    });
    const csvEscape = (s: string) => /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    return [csvEscape(r.path), csvEscape(r.category), csvEscape(r.subcategoryL1), ...cells].join(',');
  });
  return [header, ...lines].join('\n') + '\n';
}

/** Helper for downstream callers that need an MDMS uniqueIdentifier. */
export { makeCategoryUid };
