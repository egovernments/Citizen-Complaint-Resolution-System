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
export const isEmployeeHome = (item) => /\/employee$/.test(normalizeUrl(item?.navigationUrl));

/** The citizen landing route. */
export const isCitizenHome = (item) => /\/citizen\/all-services$/.test(normalizeUrl(item?.navigationUrl));

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
 * `isHome` says which row is Home; each app's landing route differs.
 *
 * A tenant whose access-control data already carries one of these routes as
 * its own row would otherwise list it twice, so any access-control leaf whose
 * URL a section also offers is dropped in favour of the section's.
 */
export const insertModuleSections = (items = [], sections = [], isHome = isEmployeeHome) => {
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
  const homeIndex = base.findIndex(isHome);
  const at = homeIndex >= 0 ? homeIndex + 1 : 0;
  return [...base.slice(0, at), ...usable.map(toSectionItem), ...base.slice(at)];
};

/**
 * Citizen rows configured in MDMS. Each ACCESSCONTROL-ACTIONS-TEST group whose
 * first row is marked `sidebar: "<contextPath>-links"` puts its module's home,
 * or an external page, in the sidebar, as the old citizen sidebar listed them.
 * A module that registers its own section is skipped: the section already
 * offers its pages, and its landing page would be a second way to them.
 * `contextPath` is the MDMS app id (`digit-ui`), not a tenant route base;
 * `rebaseUrl` moves an app URL onto the tenant route.
 */
export const mdmsLinkRows = (linkData, { contextPath, labelFor, hasOwnSection = () => false, rebaseUrl = (url) => url } = {}) =>
  Object.keys(linkData || {})
    .sort((a, b) => b.localeCompare(a))
    .flatMap((code) => {
      const entry = linkData[code]?.[0];
      if (!entry?.sidebarURL || entry.sidebar !== `${contextPath}-links` || hasOwnSection(code)) return [];
      const external = /^https?:\/\//i.test(entry.sidebarURL);
      return [
        {
          key: `mdms-${code}`,
          label: labelFor ? labelFor(code) : code,
          navigationUrl: external ? entry.sidebarURL : rebaseUrl(entry.sidebarURL),
          icon: { icon: entry.leftIcon || (external ? "OpenInNew" : "Apps"), width: ICON_SIZE, height: ICON_SIZE },
        },
      ];
    });

/**
 * A multi-root deployment carries the tenant in every app route
 * (`/<ctx>/<tenant>/employee/...`, `/<ctx>/<tenant>/citizen/...`), and the
 * sidebar's rows are built without it. It goes in here, as the old citizen
 * drawer and `processLinkData` put it in. A URL that already has it, or that
 * is not an app route, comes back unchanged.
 */
export const withTenantSegment = (url, contextPath, tenantId) => {
  if (typeof url !== "string" || !contextPath || !tenantId) return url;
  for (const app of ["employee", "citizen"]) {
    const bare = `/${contextPath}/${app}`;
    if (url === bare || url.startsWith(`${bare}/`) || url.startsWith(`${bare}?`)) {
      return `/${contextPath}/${tenantId}/${app}${url.slice(bare.length)}`;
    }
  }
  return url;
};

/**
 * Whether the tenant has published its public dashboard from the Configurator:
 * `publicDashboardEnabled` on `dss.DashboardConfig`, picked the way
 * pgr-services and the Configurator pick it (the record whose id is "default",
 * else the first). Only an explicit true counts, as it does in pgr-services,
 * which refuses the page's data otherwise.
 */
export const publicDashboardEnabled = (records) => {
  const list = Array.isArray(records) ? records.filter(Boolean) : [];
  const record = list.find((entry) => String(entry?.id ?? "").trim() === "default") || list[0];
  return record?.publicDashboardEnabled === true;
};
