import { MdmsService } from "../elements/MDMS";
import { Storage } from "../atoms/Utils/Storage";

export const GetServiceDefinitions = {
  get: async (tenantId) => {
    const criteria = {
      type: "serviceDefs",
      details: {
        tenantId: tenantId,
        moduleDetails: [
          {
            moduleName: "RAINMAKER-PGR",
            masterDetails: [
              {
                name: "ServiceDefs",
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
          def.menuPath === ""
            ? Menu.push({
                name: "SERVICEDEFS.OTHERS",
                key: def.menuPath,
              })
            : Menu.push({
                name: "SERVICEDEFS." + def.menuPath.toUpperCase(),
                key: def.menuPath,
              });
        }
      })
    );
    return Menu;
  },

  getSubMenu: async (tenantId, selectedType, t) => {
    const fetchServiceDefs = await GetServiceDefinitions.get(tenantId);
    return fetchServiceDefs
      .filter((def) => def.menuPath === selectedType.key)
      .map((id) => ({
        key: id.serviceCode,
        name: "SERVICEDEFS." + id.serviceCode.toUpperCase(),
      }));
  },
};
