/**
 * The display "code" for a Type that has no localized label yet: the last
 * dotted segment of its menuPath, verbatim (no prettifying). DIGIT's onboarding
 * default menuPath is `complaints.categories.<serviceCode>`, so this yields the
 * bare code (e.g. `GarbageNotCollected`); a flat menuPath like `SANITATION` is
 * returned unchanged. The list renders this in monospace so it reads as an
 * unnamed code rather than a real display name.
 */
export function menuPathCode(menuPath: string): string {
  if (!menuPath) return '';
  return menuPath.split('.').pop() ?? menuPath;
}
