// Pure readers for the service's environment knobs, so they can be unit-tested
// without booting Nest.

/** CORS_ORIGINS: unset or '*' → any origin; otherwise a comma-separated allow-list. */
export function corsOrigins(raw: string | undefined): string | string[] {
  const list = (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (list.length === 0 || list.includes('*')) return '*';
  return list;
}

/** A non-negative integer env var. Blank → fallback; anything else invalid is a startup error. */
export function intFromEnv(
  name: string,
  raw: string | undefined,
  fallback: number,
): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`${name} must be a non-negative integer, got '${raw}'`);
  }
  return n;
}
