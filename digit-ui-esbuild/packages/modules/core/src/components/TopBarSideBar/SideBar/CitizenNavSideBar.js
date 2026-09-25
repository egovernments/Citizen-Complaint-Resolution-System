import React from "react";
import { useHistory } from "react-router-dom";
import MediaQuery from "react-responsive";
import { navigateToEmployeeUrl } from "./employeeNavItems";
import { useCitizenNavItems } from "./citizenNavItems";
import { AppSideNav } from "./AppSideNav";
import { crestAltFor } from "./SidebarBrand";

/** Kept apart from the employee key: the two apps are different people's. */
const PINNED_STORAGE_KEY = "ccrs.citizen.sidebar-pinned";

/**
 * The citizen's desktop rail: the employee rail with citizen rows. It replaced
 * a fixed 260px v2 sidebar that could not collapse and carried the profile
 * block, which now sits in the top bar's account menu (#2038 review).
 */
const CitizenNavSideBar = ({ t, crestUrl }) => {
  const { items } = useCitizenNavItems();
  const history = useHistory();

  const onItemSelect = (item) => {
    if (item?.navigationUrl) {
      navigateToEmployeeUrl(history, item.navigationUrl, {
        isMultiRootTenant: Digit.Utils.getMultiRootTenant(),
        tenantId: Digit.ULBService.getStateId(),
      });
    }
  };

  return (
    <MediaQuery minWidth={768}>
      <AppSideNav
        t={t}
        items={items}
        storageKey={PINNED_STORAGE_KEY}
        crestUrl={crestUrl}
        crestAlt={crestAltFor(t)}
        onItemSelect={onItemSelect}
      />
    </MediaQuery>
  );
};

export default CitizenNavSideBar;
