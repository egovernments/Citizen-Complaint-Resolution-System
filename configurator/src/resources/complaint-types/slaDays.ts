/** ours (cfgreview F18, #1564): complaint category SLAs in days; MDMS keeps slaHours (pgr-services reads hours). */
const num = (v: unknown): number | null => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

/** hours -> the days shown in the form ('' when unset), at most 2 decimals. */
export function slaDaysFormat(hours: unknown): number | '' {
  const h = num(hours);
  return h === null ? '' : Math.round((h / 24) * 100) / 100;
}

/** days typed in the form -> whole hours stored (null when cleared). */
export function slaDaysParse(days: unknown): number | null {
  const d = num(days);
  return d === null ? null : Math.round(d * 24);
}

/** hours -> "14 days" / "1 day" / "1.5 days" / "--". */
export function slaDaysText(hours: unknown): string {
  const d = slaDaysFormat(hours);
  return d === '' ? '--' : `${d} ${d === 1 ? 'day' : 'days'}`;
}
