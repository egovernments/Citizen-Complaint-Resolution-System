/**
 * Field mask utility -- project only requested fields from objects.
 */

const DEFAULT_LIMIT = 50;

export function applyFieldMask<T extends Record<string, unknown>>(
  items: T[],
  fields?: string[],
  limit?: number
): { items: T[]; truncated: boolean } {
  const max = limit ?? DEFAULT_LIMIT;
  const truncated = items.length > max;
  const sliced = items.slice(0, max);

  if (!fields || fields.length === 0) {
    return { items: sliced, truncated };
  }

  const projected = sliced.map((item) => {
    const out: Record<string, unknown> = {};
    for (const field of fields) {
      if (field in item) {
        out[field] = item[field];
      }
    }
    return out as T;
  });

  return { items: projected, truncated };
}
