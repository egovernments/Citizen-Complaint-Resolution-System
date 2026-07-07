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


  try {
    const fetchBoundaryData = await Digit.CustomService.getResponse({
      url: `/boundary-service/boundary-relationships/_search`,
      useCache: false,
      method: "POST",
      userService: false,
      params: {
        tenantId: tenantId,
        hierarchyType: hierarchyType,
        includeChildren: true,
      },
    });

    if (!fetchBoundaryData) {
      throw new Error("Couldn't fetch boundary data");
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