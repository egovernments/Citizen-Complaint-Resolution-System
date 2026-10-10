/**
 * egov-user's `dob`: the search returns epoch millis or a date string, and _updatenovalidate takes "dd/MM/yyyy".
 * The form's <input type="date"> works in "yyyy-MM-dd".
 */
const pad = (n: number) => String(n).padStart(2, '0');

/** Any `dob` the user search returns -> "yyyy-MM-dd" for the date input ('' when unset or unreadable). */
export function dobToInput(raw: unknown): string {
  if (raw === null || raw === undefined || raw === '') return '';
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const d = new Date(raw);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  if (typeof raw !== 'string') return '';
  const s = raw.trim();
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return `${m[3]}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`;
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  if (/^\d{6,}$/.test(s)) return dobToInput(Number(s));
  return '';
}

/** The date input's "yyyy-MM-dd" -> egov-user's "dd/MM/yyyy" (null when cleared). */
export function inputToDob(value: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
}
