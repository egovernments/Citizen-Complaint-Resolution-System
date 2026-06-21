/**
 * Turn a raw menuPath into a human-readable Type label when no localization
 * exists. Drops dotted prefixes (e.g. DIGIT's onboarding default
 * `complaints.categories.<code>`) and splits camelCase / snake_case /
 * kebab-case codes into Title-cased words:
 * `complaints.categories.GarbageNotCollected` → "Garbage Not Collected".
 */
export function humanizeMenuPath(menuPath: string): string {
  if (!menuPath) return '';
  // Keep only the last dotted segment — drops the "complaints.categories."
  // style prefix that carries no display value.
  const lastSegment = menuPath.split('.').pop() ?? menuPath;
  const spaced = lastSegment
    .replace(/[_-]+/g, ' ') // snake_case / kebab-case → spaces
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2') // camelCase boundary
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2') // ACRONYMWord boundary
    .trim();
  if (!spaced) return '';
  return spaced
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}
