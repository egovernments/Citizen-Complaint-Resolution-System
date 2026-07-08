import { ServiceRequest } from "../atoms/Utils/Request";

/*
 * Boundary adapter — deployment-parity #1.
 *
 * The legacy /egov-location/location/v11/boundarys/_search API is not served on
 * the Kubernetes stack (only the compose stack fakes it, via a Kong Lua adapter).
 * We call the modern /boundary-service/boundary-relationships/_search directly
 * and reshape its response back into the legacy TenantBoundary shape, so every
 * downstream consumer (LocalityService, useLocalities, the pgr redux actions,
 * the init Store) keeps working unchanged on both stacks.
 *
 * The reshape mirrors the compose Kong adapter exactly: wrap the hierarchyType
 * string into { code, name }; recursively add name/localname/label to each
 * boundary node and normalize missing/empty children to []. Like the Kong
 * adapter, the legacy boundaryType filter (Locality/Ward) is dropped — the full
 * hierarchy tree is returned and consumers walk it as they already do.
 */

const BOUNDARY_RELATIONSHIP_SEARCH = "/boundary-service/boundary-relationships/_search";

const enrichBoundaryNodes = (nodes) => {
  for (const node of nodes) {
    if (!node.name) node.name = node.code;
    if (!node.localname) node.localname = node.code;
    if (!node.label) node.label = node.boundaryType || "";
    if (!Array.isArray(node.children) || node.children.length === 0) {
      node.children = [];
    } else {
      enrichBoundaryNodes(node.children);
    }
  }
};

const reshapeToTenantBoundary = (response, hierarchyType) => {
  const tenantBoundaries = response?.TenantBoundary || [];
  for (const tb of tenantBoundaries) {
    if (typeof tb.hierarchyType === "string") {
      tb.hierarchyType = { code: tb.hierarchyType, name: tb.hierarchyType };
    } else if (tb.hierarchyType == null) {
      tb.hierarchyType = { code: hierarchyType, name: hierarchyType };
    }
    if (!Array.isArray(tb.boundary) || tb.boundary.length === 0) {
      tb.boundary = [];
    } else {
      enrichBoundaryNodes(tb.boundary);
    }
  }
  return response;
};

const fetchTenantBoundary = async (tenantId, hierarchyType) => {
  const response = await ServiceRequest({
    serviceName: "boundaryRelationshipSearch",
    url: BOUNDARY_RELATIONSHIP_SEARCH,
    params: { tenantId, hierarchyType, includeChildren: true },
    useCache: true,
  });
  return reshapeToTenantBoundary(response, hierarchyType);
};

export const LocationService = {
  getLocalities: (tenantId) => fetchTenantBoundary(tenantId, "ADMIN"),
  getRevenueLocalities: (tenantId) => fetchTenantBoundary(tenantId, "REVENUE"),
  getWards: (tenantId) => fetchTenantBoundary(tenantId, "ADMIN"),
};
