import { useTranslation } from "react-i18next";

const { useState, useEffect } = require("react");

const useServiceDefs = (tenantId, moduleCode) => {
  const [localMenu, setLocalMenu] = useState([]);
  const SessionStorage = Digit.SessionStorage;
  const { t } = useTranslation();

  useEffect(() => {
    (async () => {
      // getServiceDefs now sources leaves from RAINMAKER-PGR.ComplaintHierarchy
      // and adapts them to the legacy ServiceDefs shape (menuPath = parentCode,
      // menuPathName = parent node's name). NOTE: the "serviceDefs"
      // SessionStorage cache key below must be cleared on deploy so stale
      // legacy-shape rows don't linger.
      const serviceDefs = await Digit.MDMSService.getServiceDefs(tenantId, moduleCode);
      SessionStorage.set("serviceDefs", serviceDefs);

      // `menuPathName` is the dropdown's group label for the employee Create
      // Complaint form's `SelectComplaintType` (read via `optionsKey`). It now
      // comes from the parent ComplaintHierarchy node's `name` (set by the
      // adapter) rather than a SERVICEDEFS.<menuPath> i18n key.
      const serviceDefsWithKeys = serviceDefs.map((def) => {
        // Key-based label (COMPLAINT_HIERARCHY.<code>) with node-name fallback.
        const k = "COMPLAINT_HIERARCHY." + String(def.serviceCode).toUpperCase();
        const v = t(k);
        return {
          ...def,
          i18nKey: v && v !== k ? v : def.name || def.serviceCode,
          code: `${def.serviceCode}.${def.department}`,
          menuPathName: def.menuPathName,
        };
      });
      setLocalMenu(serviceDefsWithKeys);
    })();
  }, [tenantId, moduleCode, t]);

  return localMenu;
};

export default useServiceDefs;