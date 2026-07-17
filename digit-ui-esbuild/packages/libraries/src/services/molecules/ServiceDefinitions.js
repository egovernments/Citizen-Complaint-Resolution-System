import { MdmsService } from "../elements/MDMS";
import { Storage } from "../atoms/Utils/Storage";

export const GetServiceDefinitions = {
  get: async (tenantId) => {
    // Adapter: ServiceDefs is gone — fetch the ComplaintHierarchy tree and let
    // the "serviceDefs" transform keep only leaf rows mapped to the legacy
    // ServiceDefs shape (serviceCode/menuPath=parentCode/menuPathName=parent name).
    const criteria = {
      type: "serviceDefs",
      details: {
        tenantId: tenantId,
        moduleDetails: [
          {
            moduleName: "RAINMAKER-PGR",
            masterDetails: [
              {
                name: "ComplaintHierarchy",
              },
            ],
          },
        ],
      },
    };

    const serviceDefs = await MdmsService.getDataByCriteria(tenantId, criteria, "PGR");
    Storage.set("serviceDefinitions", serviceDefs);
    return serviceDefs;
  },
  getMenu: async (stateCode, t) => {
    var Menu = [];
    const response = await GetServiceDefinitions.get(stateCode);
    await Promise.all(
      response.map((def) => {
        if (!Menu.find((e) => e.key === def.menuPath)) {
          if (def.menuPath === "") {
            Menu.push({ name: t("CS_COMPLAINT_TYPE_OTHERS"), key: def.menuPath });
          } else {
            // Key-based (COMPLAINT_HIERARCHY.<code>) with parent-name fallback.
            const k = "COMPLAINT_HIERARCHY." + String(def.menuPath).toUpperCase();
            const v = t(k);
            Menu.push({ name: v && v !== k ? v : def.menuPathName || def.menuPath, key: def.menuPath });
          }
        }
      })
    );
    return Menu;
  },

  getSubMenu: async (tenantId, selectedType, t) => {
    const fetchServiceDefs = await GetServiceDefinitions.get(tenantId);
    return fetchServiceDefs
      .filter((def) => def.menuPath === selectedType.key)
      .map((id) => {
        // Key-based (COMPLAINT_HIERARCHY.<code>) with leaf-name fallback.
        const k = "COMPLAINT_HIERARCHY." + String(id.serviceCode).toUpperCase();
        const v = t(k);
        return { key: id.serviceCode, name: v && v !== k ? v : id.name || id.serviceCode };
      });
  },
};
