import { useTranslation } from "react-i18next";

const { useState, useEffect } = require("react");

const useServiceDefs = (tenantId, moduleCode) => {
  const [localMenu, setLocalMenu] = useState([]);
  const SessionStorage = Digit.SessionStorage;
  const { t } = useTranslation();

  useEffect(() => {
    (async () => {
      const serviceDefs = await Digit.MDMSService.getServiceDefs(tenantId, moduleCode);
      SessionStorage.set("serviceDefs", serviceDefs);

      // `menuPathName` mirrors the key convention already used by the
      // citizen FormExplorer (`SERVICEDEFS.<MENUPATH_UPPER>`) and is
      // what the employee Create Complaint form's `SelectComplaintType`
      // dropdown reads via `optionsKey`. We pre-translate here so the
      // Dropdown renders human text (CCRS#437) — citizen FormExplorer
      // does the same. Without `t()`, the dropdown shows the raw key.
      const serviceDefsWithKeys = serviceDefs.map((def) => ({
        ...def,
        i18nKey: "SERVICEDEFS." + def.serviceCode.toUpperCase() + `.${def.department}`,
        code: `${def.serviceCode}.${def.department}`,
        menuPathName: def.menuPath ? t(`SERVICEDEFS.${def.menuPath.toUpperCase()}`) : undefined,
      }));
      setLocalMenu(serviceDefsWithKeys);
    })();
  }, [tenantId, moduleCode, t]);

  return localMenu;
};

export default useServiceDefs;