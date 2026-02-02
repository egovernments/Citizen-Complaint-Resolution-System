import { useTranslation } from "react-i18next";

const { useState, useEffect } = require("react");

const useServiceDefs = (tenantId, moduleCode) => {
  const [localMenu, setLocalMenu] = useState([]);
  const SessionStorage = Digit.SessionStorage;

  useEffect(() => {
    (async () => {
      const serviceDefs = await Digit.MDMSService.getServiceDefs(tenantId, moduleCode);
      SessionStorage.set("serviceDefs", serviceDefs);

      const serviceDefsWithKeys = serviceDefs.map((def) => ({ ...def, i18nKey: "SERVICEDEFS_" + def.serviceCode.toUpperCase() + `_${def.department}`, code: `${def.serviceCode}_${def.department}` }));
      setLocalMenu(serviceDefsWithKeys);
    })();
  }, [tenantId, moduleCode]);

  return localMenu;
};

export default useServiceDefs;