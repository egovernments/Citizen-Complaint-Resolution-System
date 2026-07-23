// Theme-var indirection (CCSD-2060): resolves to the tenant's MDMS theme at
// paint time; the hex is only the themeless fallback. var() resolves in both
// CSS style props and SVG presentation attributes (verified on Chromium).
export const COLOR_FILL = "var(--color-primary-main, #c84c0e)";
