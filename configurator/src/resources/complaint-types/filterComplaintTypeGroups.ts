import type { ComplaintTypeGroup } from './groupComplaintTypes';

/**
 * Filter grouped complaint types by a search query. Matches a group's display
 * label OR any sub-type's name / serviceName / serviceCode (case-insensitive).
 * When a group matches via its label, all its sub-types are kept; when it
 * matches only via sub-types, only the matching sub-types are kept and the
 * group's count/activeCount are recomputed to reflect the visible rows.
 * An empty/whitespace query returns the original array unchanged (same ref).
 */
export function filterComplaintTypeGroups(
  groups: ComplaintTypeGroup[],
  query: string,
): ComplaintTypeGroup[] {
  const q = query.trim().toLowerCase();
  if (!q) return groups;

  const result: ComplaintTypeGroup[] = [];
  for (const g of groups) {
    if (g.label.toLowerCase().includes(q)) {
      result.push(g);
      continue;
    }
    const matchingSubs = g.subTypes.filter(
      (s) =>
        (s.name ?? '').toLowerCase().includes(q) ||
        (s.serviceName ?? '').toLowerCase().includes(q) ||
        s.serviceCode.toLowerCase().includes(q),
    );
    if (matchingSubs.length > 0) {
      result.push({
        ...g,
        subTypes: matchingSubs,
        count: matchingSubs.length,
        activeCount: matchingSubs.filter((s) => s.active === true).length,
      });
    }
  }
  return result;
}
