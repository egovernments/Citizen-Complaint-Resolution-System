import { useTranslation } from "react-i18next";
import { adaptComplaintHierarchyToServiceDefs } from "../../utils";

const { useState, useEffect } = require("react");

/**
 * useServiceDefs — data-access adapter for legacy PGR complaint-type consumers.
 *
 * The MDMS master `RAINMAKER-PGR.ServiceDefs` is gone; complaint types now live as
 * LEAF rows in the single `RAINMAKER-PGR.ComplaintHierarchy` adjacency list. Rather
 * than touching every component, we adapt here: fetch ComplaintHierarchy, keep only
 * leaf rows, and map each to the legacy ServiceDefs shape (serviceCode, name,
 * menuPath = parentCode, menuPathName = parent node's name, ...). The returned array
 * keeps the exact field names + `i18nKey` that downstream code already relies on, so
 * Filter.js / createComplaintForm.js continue to work unchanged.
 */
const useServiceDefs = (tenantId, moduleCode) => {
  const [localMenu, setLocalMenu] = useState([]);
  const SessionStorage = Digit.SessionStorage;
  let { t } = useTranslation();

  useEffect(() => {
    (async () => {
      // Fetch the adjacency list (interior nodes + leaves) for this module.
      const response = await Digit.MDMSService.getMultipleTypesWithFilter(tenantId, `RAINMAKER-${moduleCode}`, [{ name: "ComplaintHierarchy" }]);
      const hierarchyRows = response?.[`RAINMAKER-${moduleCode}`]?.ComplaintHierarchy || [];

      // Keep only leaves and map them to the legacy ServiceDefs shape.
      const serviceDefs = adaptComplaintHierarchyToServiceDefs(hierarchyRows);
      SessionStorage.set("serviceDefs", serviceDefs);

      const serviceDefsWithKeys = serviceDefs.map((def) => ({ ...def, i18nKey: t("SERVICEDEFS_" + def.serviceCode.toUpperCase()) }));
      setLocalMenu(serviceDefsWithKeys);
    })();
  }, [t, tenantId, moduleCode]);

  return localMenu;
};

export default useServiceDefs;
