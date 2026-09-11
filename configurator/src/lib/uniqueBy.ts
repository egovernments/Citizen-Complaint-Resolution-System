/**
 * Keep the first item for each distinct key, dropping later collisions.
 *
 * Dropdowns are the reason this exists. A Radix `Select` renders one
 * `<SelectItem value={…}>` per choice, and two items sharing a `value` are not
 * merely a cosmetic repeat: BOTH render as checked when either is picked, and
 * `<SelectValue>` prints the label of every match, so a trigger showing the
 * selected hierarchy reads "ADMINADMINADMINADMIN…". React also warns on the
 * duplicated list key. Same story for the hand-rolled `role="listbox"`
 * comboboxes (Roles, Departments): a repeated option is unpickable-past-the-
 * first and looks like corrupt master data to the operator. See CCRS #1923.
 *
 * The duplicates are real, not defensive: DIGIT does not enforce uniqueness of a
 * boundary `hierarchyType` or `code` across tenants, and the data provider
 * aggregates the state tenant's records with every city tenant's. On bomet
 * (`ke`) that is 7 hierarchies named ADMIN and 3 named KE-ADMIN.
 *
 * Keep-first, never last: aggregating fetchers list the session tenant's records
 * before the sub-tenants', so the surviving option is the one the operator's own
 * tenant defines.
 *
 * Only ever collapse on the value the control SUBMITS (the option value / code),
 * never on the display label — two genuinely different codes are allowed to
 * share a name, and dropping one of those would hide a real choice.
 */
export function uniqueBy<T>(items: readonly T[] | null | undefined, key: (item: T) => string): T[] {
  if (!items) return [];
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const k = key(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}
