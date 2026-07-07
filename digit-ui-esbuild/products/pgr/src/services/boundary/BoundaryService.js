import i18next from "i18next";
const getBoundaryTypeOrder = (tenantBoundary) => {
  const order = [];
  const seenTypes = new Set();

  // Recursive function to traverse the hierarchy
  const traverse = (node, currentOrder) => {
    if (!seenTypes.has(node.boundaryType)) {
      order.push({ code: node.boundaryType, order: currentOrder });
      seenTypes.add(node.boundaryType);
    }
    if (node.children && node.children.length > 0) {
      node.children.forEach((child) => traverse(child, currentOrder + 1));
    }
  };

  // Process the root boundaries
  tenantBoundary.forEach((boundary) => traverse(boundary, 1));

  return order;
};

const fetchBoundaries = async ({ tenantId }) => {
  const hierarchyType = window?.globalConfigs?.getConfig("HIERARCHY_TYPE") || "ADMIN";
  // Intentionally no `boundaryType` filter — see PGRInitialization.js for
  // the rationale. We need the full tree here so BoundaryComponent can
  // walk `.children` and render each level of the cascade.


    // Get user info from localStorage
  const citizenInfo = window.localStorage.getItem("user-info");

  if (citizenInfo) {
    const user = JSON.parse(citizenInfo);
    const userType = user.type;

    if (userType === "CITIZEN") {
      // The caller passes the tenant RESOLVED from the complaint's "related to"
      // selection (e.g. mz.ige / mz.igsae) — that is where the boundary tree is
      // onboarded. Only fall back to the citizen's home city when no tenant was
      // passed. The old unconditional override sent every lookup to the citizen's
      // home tenant (the state root on multi-authority envs), which has no tree
      // → 400 HIERARCHY_DEFINITION_DOES_NOT_EXIST → the location cascade never
      // rendered even though the city-level data exists.
      tenantId = tenantId || Digit.SessionStorage.get("CITIZEN.COMMON.HOME.CITY")?.code;
    }
  } else {
    console.log("No CITIZEN user info found in localStorage.");
  }


  // Boundary labels are seeded WITH the tree at the CITY tenant, while the app
  // bootstrap loads localization at the STATE tenant only — so load the label
  // module for the SAME tenant the tree comes from and feed i18next directly.
  // (LocalizationService.getLocale dedupes by module NAME, and the state's —
  // possibly empty — copy of this module is already registered, so it would
  // skip the refetch.) Best-effort: a failure only means raw codes render.
  const loadBoundaryLabels = async () => {
    try {
      const locale =
        Digit.StoreData?.getCurrentLanguage?.() || i18next.language || "en_IN";
      const res = await Digit.CustomService.getResponse({
        url: "/localization/messages/v1/_search",
        useCache: true,
        method: "POST",
        userService: false,
        params: { tenantId, locale, module: `rainmaker-boundary-${hierarchyType}` },
      });
      const msgs = res?.messages || [];
      if (msgs.length) {
        const bundle = {};
        msgs.forEach((m) => { bundle[m.code] = m.message; });
        i18next.addResources(locale, "translations", bundle);
      }
    } catch (e) {
      console.warn("boundary label localization load failed", e);
    }
  };

  try {
    const [fetchBoundaryData] = await Promise.all([
      Digit.CustomService.getResponse({
        url: `/boundary-service/boundary-relationships/_search`,
        useCache: false,
        method: "POST",
        userService: false,
        params: {
          tenantId: tenantId,
          hierarchyType: hierarchyType,
          includeChildren: true,
        },
      }),
      loadBoundaryLabels(),
    ]);

    if (!fetchBoundaryData) {
      throw new Error("Couldn't fetch boundary data");
    }

    // Level-heading labels (e.g. DIVISAO_ADMINISTRATIVA_PROVINCIA) are also
    // seeded at the tree's tenant — fetch exactly those codes (derived from the
    // boundaryTypes present in the tree) and feed i18next. Best-effort.
    try {
      const types = new Set();
      const walk = (n) => {
        if (n?.boundaryType) types.add(n.boundaryType);
        (n?.children || []).forEach(walk);
      };
      (fetchBoundaryData?.TenantBoundary || []).forEach((tb) => (tb?.boundary || []).forEach(walk));
      const strip = (x) =>
        String(x).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
      const codes = [...types].map((tp) => strip(`${hierarchyType}_${tp}`)).join(",");
      if (codes) {
        const locale = Digit.StoreData?.getCurrentLanguage?.() || i18next.language || "en_IN";
        const res = await Digit.CustomService.getResponse({
          url: "/localization/messages/v1/_search",
          useCache: true,
          method: "POST",
          userService: false,
          params: { tenantId, locale, codes },
        });
        const msgs = res?.messages || [];
        if (msgs.length) {
          const bundle = {};
          msgs.forEach((m) => { bundle[m.code] = m.message; });
          i18next.addResources(locale, "translations", bundle);
        }
      }
    } catch (e) {
      console.warn("boundary level-label localization load failed", e);
    }

    return fetchBoundaryData?.TenantBoundary;
  } catch (error) {
    if (error?.response?.data?.Errors) {
      throw new Error(error.response.data.Errors[0].message);
    }
    throw new Error("An unknown error occurred");
  }
};


export default fetchBoundaries;