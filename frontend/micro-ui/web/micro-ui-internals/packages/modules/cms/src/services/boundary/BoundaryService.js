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


    // Get user info from localStorage
  const citizenInfo = window.localStorage.getItem("user-info");

  if (citizenInfo) {
    const user = JSON.parse(citizenInfo);
    const userType = user.type;

    if (userType === "CITIZEN") {
      tenantId = Digit.SessionStorage.get("CITIZEN.COMMON.HOME.CITY")?.code || tenantId;
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