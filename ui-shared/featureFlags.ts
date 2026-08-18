/** Parse opt-in build flags consistently across every Vite SPA. */
export function isEnabledFlag(value: unknown): boolean {
  return typeof value === 'string' && ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}
