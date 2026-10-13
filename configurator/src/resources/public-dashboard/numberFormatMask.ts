/**
 * dss.DashboardConfig.numberFormat: the supervisor dashboard's number DISPLAY mask, per locale
 * (products/dashboard/src/utils/numberFormat.js). Canonical form: { "<locale>": "<mask>", "default": "<mask>" };
 * a legacy string is one mask for every locale and is shown here as `default`.
 *
 * Mask rules mirror the dashboard's parser so what is previewed is what the dashboard renders: placeholders are
 * [#0]; the remaining characters are separators, the first grouping and the last decimal; a single separator is a
 * grouping separator only in the thousands position ("#,##0"); only these separators are allowed.
 */
const ALLOWED_SEPARATORS = new Set(['.', ',', ' ', ' ', ' ', "'", '_']);

export interface ParsedMask { group: string | null; decimal: string | null }

export function parseMask(mask: unknown): ParsedMask | null {
  if (typeof mask !== 'string' || !mask.trim() || !/[#0]/.test(mask)) return null;
  const seps = [...mask].filter((c) => c !== '#' && c !== '0');
  if (seps.some((c) => !ALLOWED_SEPARATORS.has(c))) return null;
  if (seps.length === 0) return { group: null, decimal: null };
  if (seps.length === 1) {
    const i = mask.indexOf(seps[0]);
    const after = mask.slice(i + 1).replace(/[^#0]/g, '').length;
    return after === 3 && i > 0 ? { group: seps[0], decimal: null } : { group: null, decimal: seps[0] };
  }
  const first = seps[0];
  const last = seps[seps.length - 1];
  if (seps.every((c) => c === first)) return { group: first, decimal: null };
  return { group: first, decimal: last };
}

/** 1234567.891 rendered with the mask's separators and two decimals (the preview only). */
export function previewMask(mask: string): string | null {
  const p = parseMask(mask);
  if (!p) return null;
  const [int, frac] = (1234567.891).toFixed(2).split('.');
  const grouped = p.group ? int.replace(/\B(?=(\d{3})+(?!\d))/g, p.group) : int;
  return `${grouped}${p.decimal ?? '.'}${frac}`;
}

export type Row = { locale: string; mask: string };

export function toRows(numberFormat: unknown): Row[] {
  if (typeof numberFormat === 'string' && numberFormat.trim()) return [{ locale: 'default', mask: numberFormat }];
  if (numberFormat && typeof numberFormat === 'object' && !Array.isArray(numberFormat)) {
    const rows = Object.entries(numberFormat as Record<string, unknown>)
      .filter(([, v]) => typeof v === 'string')
      .map(([locale, mask]) => ({ locale, mask: mask as string }));
    return rows.sort((a, b) => (a.locale === 'default' ? 1 : b.locale === 'default' ? -1 : a.locale.localeCompare(b.locale)));
  }
  return [];
}

export function rowsToNumberFormat(rows: Row[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rows) {
    const locale = r.locale.trim();
    if (locale && r.mask.trim()) out[locale] = r.mask.trim();
  }
  return out;
}
