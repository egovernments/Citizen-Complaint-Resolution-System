import React, { useEffect, useState } from "react";

const useComplaintSubType = (complaintType, t) => {
  const [subTypeMenu, setSubTypeMenu] = useState([]);

  useEffect(() => {
    (async () => {
      if (complaintType) {
        // Read from the operational tenant (city) so configurator-authored
        // complaint types are visible. The previous ternary inverted this
        // for MULTI_ROOT_TENANT and read the state tier, where new types
        // never land. `getCurrentTenantId()` already falls through to the
        // state-level id in single-root mode, so Bomet is unaffected.
        const tenantId = Digit.ULBService.getCurrentTenantId();
        const menu = await Digit.GetServiceDefinitions.getSubMenu(tenantId, complaintType, t);
        setSubTypeMenu(menu);
      }
    })();
  }, [complaintType,t]);

  return subTypeMenu;
};

export default useComplaintSubType;
