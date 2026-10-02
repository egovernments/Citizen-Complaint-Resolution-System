import { complaintLabel } from "./complaintLabel";

/**
 * The categories the tenant's complaint types fall under, for the inbox
 * filter: one per parent (`menuPath`), labelled the way the rest of the app
 * labels a complaint-hierarchy node, with every subcategory code filed under
 * it so a category on its own can search them all. Sorted by label. A type
 * with no parent is left to the subcategory list.
 */
export function complaintCategories(defs, t) {
  const byCode = new Map();
  for (const def of Array.isArray(defs) ? defs : []) {
    const code = def?.menuPath;
    if (!code || !def?.serviceCode) continue;
    if (!byCode.has(code)) {
      byCode.set(code, { code, label: complaintLabel(t, code, def.menuPathName), serviceCodes: [] });
    }
    const entry = byCode.get(code);
    if (!entry.serviceCodes.includes(def.serviceCode)) entry.serviceCodes.push(def.serviceCode);
  }
  return [...byCode.values()].sort((a, b) => String(a.label).localeCompare(String(b.label)));
}

/**
 * The serviceCodes an inbox filter selection searches: the subcategory when
 * one is picked, otherwise every subcategory in the picked category, and
 * nothing (no constraint) when neither is.
 */
export function serviceCodesForFilter(subcategory, category) {
  if (subcategory?.serviceCode) return [subcategory.serviceCode];
  if (Array.isArray(category?.serviceCodes) && category.serviceCodes.length > 0) return [...category.serviceCodes];
  return [];
}
