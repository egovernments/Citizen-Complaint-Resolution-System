import { LocalizationService } from "./Localization/service";

const ADMIN_CODE = ({ tenantId, hierarchyType }) => {
  if(Digit.Utils.getMultiRootTenant()){
    return hierarchyType.code;
  }else{
  return tenantId.replace(".", "_").toUpperCase() + "_" + hierarchyType.code;
  }
};

const getI18nKeys = (localitiesWithLocalizationKeys) => {
  return localitiesWithLocalizationKeys.map((locality) => ({
    code: locality.code,
    message: locality.name,
  }));
};

/** Recursively collect leaf boundaries (those with no children). */
const collectLeaves = (nodes) => {
  const leaves = [];
  const walk = (node) => {
    if (!node.children || node.children.length === 0) {
      leaves.push(node);
    } else {
      node.children.forEach(walk);
    }
  };
  nodes.forEach(walk);
  return leaves;
};

const getLocalities = (tenantBoundry) => {
  const adminCode = ADMIN_CODE(tenantBoundry);
  const boundaries = tenantBoundry.boundary || [];
  // If the top-level items have children, extract leaf nodes (handles nested hierarchies).
  // If they don't, use them directly (flat hierarchy — backward compatible).
  const hasChildren = boundaries.some((b) => b.children && b.children.length > 0);
  const items = hasChildren ? collectLeaves(boundaries) : boundaries;
  // Deduplicate by code (nested trees may contain duplicate entries)
  const seen = new Set();
  const unique = items.filter((b) => {
    if (seen.has(b.code)) return false;
    seen.add(b.code);
    return true;
  });
  return unique.map((boundaryObj) => ({
    ...boundaryObj,
    i18nkey: adminCode + "_" + boundaryObj.code,
  }));
};

export const LocalityService = {
  get: (tenantBoundry) => getLocalities(tenantBoundry),
};
