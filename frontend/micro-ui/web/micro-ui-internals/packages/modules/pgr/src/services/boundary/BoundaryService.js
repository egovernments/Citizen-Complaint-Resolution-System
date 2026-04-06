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
  const boundaryType = window?.globalConfigs?.getConfig("BOUNDARY_TYPE") || "Locality";


    // Get user info from localStorage (KC adapter stores as "Citizen.user-info")
  const citizenInfo = window.localStorage.getItem("Citizen.user-info") || window.localStorage.getItem("user-info");

  if (citizenInfo) {
    try {
      const user = JSON.parse(citizenInfo);
      if (user.type === "CITIZEN") {
        tenantId = Digit.SessionStorage.get("CITIZEN.COMMON.HOME.CITY")?.code
          || window.localStorage.getItem("Citizen.tenant-id")
          || tenantId;
      }
    } catch (e) {}
  }

  // Ensure city-level tenant (boundaries are seeded at city level)
  if (tenantId && !tenantId.includes(".")) {
    tenantId = tenantId + ".citya";
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
        boundaryType: boundaryType,
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