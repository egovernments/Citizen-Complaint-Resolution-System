/**
 * The boundary hierarchy PGR works in, per tenant.
 *
 * A tenant names its own hierarchy in CMS-BOUNDARY.HierarchySchema (the "CMS"
 * row): the configurator's Geography step writes it when a workspace creates
 * its hierarchy, and mdms-v2 resolves a city up to its state's row. Without a
 * row (legacy deployments) the deploy-time globalConfigs keys apply, exactly
 * as before: HIERARCHY_TYPE (default ADMIN), PGR_BOUNDARY_HIGHEST_LEVEL and
 * PGR_BOUNDARY_LOWEST_LEVEL.
 *
 * A workspace that has not done Geography yet has no row and no ADMIN tree, so
 * callers get an empty tree and degrade; an MDMS failure also falls back.
 */
const globalConfig = (key) => window?.globalConfigs?.getConfig?.(key) || null;

export const legacyHierarchy = () => ({
  hierarchyType: globalConfig("HIERARCHY_TYPE") || "ADMIN",
  highestLevel: globalConfig("PGR_BOUNDARY_HIGHEST_LEVEL"),
  lowestLevel: globalConfig("PGR_BOUNDARY_LOWEST_LEVEL"),
  fromTenant: false,
});

/** The tenant's hierarchy from its HierarchySchema rows, else the legacy globalConfigs one. */
export const hierarchyFromSchema = (rows) => {
  const row = (Array.isArray(rows) ? rows : []).find((r) => r?.moduleName === "CMS" && r?.hierarchy);
  if (!row) return legacyHierarchy();
  return {
    hierarchyType: row.hierarchy,
    highestLevel: row.highestHierarchy || null,
    lowestLevel: row.lowestHierarchy || null,
    fromTenant: true,
  };
};

const resolved = new Map();

/** Resolves once per tenant per page load; never rejects. */
export const getTenantHierarchy = (tenantId) => {
  if (!tenantId) return Promise.resolve(legacyHierarchy());
  if (!resolved.has(tenantId)) {
    const lookup = Promise.resolve()
      .then(() =>
        Digit.MDMSService.call(tenantId, {
          moduleDetails: [{ moduleName: "CMS-BOUNDARY", masterDetails: [{ name: "HierarchySchema" }] }],
        })
      )
      .then((response) => hierarchyFromSchema(response?.MdmsRes?.["CMS-BOUNDARY"]?.HierarchySchema))
      .catch((error) => {
        console.warn("PGR: CMS-BOUNDARY.HierarchySchema lookup failed; using globalConfigs", tenantId, error);
        resolved.delete(tenantId); // retry on the next call rather than pinning the fallback
        return legacyHierarchy();
      });
    resolved.set(tenantId, lookup);
  }
  return resolved.get(tenantId);
};

export default getTenantHierarchy;
