/**
 * The employee's complaint entry points, in one place.
 *
 * The home page's module card and the sidebar's Complaints section both offer
 * these, and they must agree on who sees what: a GRO who cannot create a
 * complaint should not find a Create row in either. Building the list once,
 * with the role check applied here, is what keeps the two from drifting.
 */
export const PGR_EMPLOYEE_ROLES = ["GRO", "PGR_LME", "CSR"];

export const getPGREmployeeLinks = (t) => {
  if (!Digit.Utils.didEmployeeHasAtleastOneRole(PGR_EMPLOYEE_ROLES)) {
    return [];
  }
  const base = `/${window?.contextPath}/employee/pgr`;
  const links = [
    {
      key: "create",
      label: t("ACTION_TEST_CREATE_COMPLAINT"),
      link: `${base}/create-complaint`,
      roles: ["CSR"],
      icon: "NoteAdd",
    },
    {
      key: "search",
      label: t("ACTION_TEST_SEARCH_COMPLAINT"),
      link: `${base}/inbox-v2`,
      roles: PGR_EMPLOYEE_ROLES,
      icon: "Search",
    },
  ];
  return links.filter((link) => Digit.Utils.didEmployeeHasAtleastOneRole(link.roles));
};

/**
 * The sidebar's Complaints section. Registered as `PGRSidebarSection`, the
 * same `${code}…` convention the home page uses to find `PGRCard`, so the core
 * shell asks each enabled module for its section without importing any of them.
 */
export const getPGRSidebarSection = (t) => {
  const links = getPGREmployeeLinks(t);
  if (links.length === 0) return null;
  return {
    key: "pgr",
    label: t("CORE_SIDEBAR_SECTION_COMPLAINTS", "Complaints"),
    items: links.map(({ key, label, link, icon }) => ({ key, label, navigationUrl: link, icon })),
  };
};

/**
 * The citizen rail's Complaints section, registered as
 * `PGRCitizenSidebarSection`. Every citizen can file and follow complaints
 * (a signed-out visitor is sent to sign in first), so there is no role gate;
 * the labels are the ones the citizen home card already uses for the same
 * two links.
 */
export const getPGRCitizenSidebarSection = (t) => {
  const base = `/${window?.contextPath}/citizen/pgr`;
  return {
    key: "pgr",
    label: t("CORE_SIDEBAR_SECTION_COMPLAINTS", "Complaints"),
    items: [
      { key: "file", label: t("CS_COMMON_FILE_A_COMPLAINT"), navigationUrl: `${base}/create-complaint`, icon: "NoteAdd" },
      { key: "mine", label: t("CS_HOME_MY_COMPLAINTS"), navigationUrl: `${base}/complaints`, icon: "ListAlt" },
    ],
  };
};
