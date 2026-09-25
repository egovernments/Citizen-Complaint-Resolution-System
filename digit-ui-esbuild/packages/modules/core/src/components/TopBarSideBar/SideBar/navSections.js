/**
 * Module sections in the employee sidebar (Complaints, and whatever a module
 * registers after it).
 *
 * The access-control tree gives the sidebar its top-level rows (Home,
 * Dashboard). A section is different: a labelled group whose rows are the
 * module's own entry points, supplied by the module as
 * `{ key, label, items: [{ key, label, navigationUrl, icon }] }`.
 *
 * Kept free of React and of `Digit` so it can be tested on its own.
 */

const ICON_SIZE = "1.5rem";

const normalizeUrl = (url = "") => String(url).replace(/\/+$/, "");

/** The employee landing route, with or without a trailing slash. */
const isEmployeeHome = (item) => /\/employee$/.test(normalizeUrl(item?.navigationUrl));

const toSectionItem = (section) => ({
  type: "section",
  key: section.key,
  label: section.label,
  children: section.items.map((row) => ({
    key: row.key,
    label: row.label,
    navigationUrl: row.navigationUrl,
    icon: { icon: row.icon, width: ICON_SIZE, height: ICON_SIZE },
  })),
});

/**
 * Insert sections directly after Home, or first when there is no Home row.
 *
 * A tenant whose access-control data already carries one of these routes as
 * its own row would otherwise list it twice, so any access-control leaf whose
 * URL a section also offers is dropped in favour of the section's.
 */
export const insertModuleSections = (items = [], sections = []) => {
  const usable = sections.filter((s) => s && Array.isArray(s.items) && s.items.length > 0);
  if (usable.length === 0) return items;

  const sectionUrls = new Set(usable.flatMap((s) => s.items.map((row) => normalizeUrl(row.navigationUrl))));
  const withoutDuplicates = (list) =>
    list
      .map((item) =>
        item?.children ? { ...item, children: withoutDuplicates(item.children) } : item
      )
      .filter((item) => {
        if (item?.children) return item.children.length > 0;
        return !sectionUrls.has(normalizeUrl(item?.navigationUrl));
      });

  const base = withoutDuplicates(items);
  const homeIndex = base.findIndex(isEmployeeHome);
  const at = homeIndex >= 0 ? homeIndex + 1 : 0;
  return [...base.slice(0, at), ...usable.map(toSectionItem), ...base.slice(at)];
};
