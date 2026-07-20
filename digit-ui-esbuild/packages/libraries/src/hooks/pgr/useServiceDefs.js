import { useTranslation } from "react-i18next";

const { useState, useEffect } = require("react");

const useServiceDefs = (tenantId, moduleCode) => {
  const [localMenu, setLocalMenu] = useState([]);
  const SessionStorage = Digit.SessionStorage;
  let { t } = useTranslation();

  useEffect(() => {
    (async () => {
      // getServiceDefs now sources leaves from RAINMAKER-PGR.ComplaintHierarchy
      // and adapts them to the legacy ServiceDefs shape (incl. menuPath/
      // menuPathName derived from the parent node). The "serviceDefs"
      // SessionStorage cache key must be cleared on deploy to drop stale rows.
      const serviceDefs = await Digit.MDMSService.getServiceDefs(tenantId, moduleCode);
      SessionStorage.set("serviceDefs", serviceDefs);

      // Key-based label (COMPLAINT_HIERARCHY.<code>) with node-name fallback.
      const serviceDefsWithKeys = serviceDefs.map((def) => {
        const k = "COMPLAINT_HIERARCHY." + String(def.serviceCode).toUpperCase();
        const v = t(k);
        return { ...def, i18nKey: v && v !== k ? v : def.name || def.serviceCode };
      });
      setLocalMenu(serviceDefsWithKeys);
    })();
  }, [t, tenantId, moduleCode]);

  return localMenu;
};

export default useServiceDefs;
