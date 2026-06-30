/**
 * Humanise a raw dimension code (service/ward/department/dotted key) into a short
 * display label. Extracted verbatim from the retired kpiQueries module — the only
 * export of that file the inverted dashboard still used.
 */
export function formatDimensionLabel(code) {
  const humanized = String(code).replace(/([a-z])([A-Z])/g, "$1 $2");
  const wardMatch = humanized.match(/ward[_\s-]?(\d+)/i);
  if (wardMatch) return `Ward ${wardMatch[1]}`;

  const dot = humanized.lastIndexOf(".");
  if (dot >= 0) {
    return humanized
      .slice(dot + 1)
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  const parts = humanized.split("_").filter(Boolean);
  if (parts.length > 2) {
    return parts
      .slice(-2)
      .join(" ")
      .replace(/_/g, " ");
  }

  return humanized.replace(/_/g, " ");
}
