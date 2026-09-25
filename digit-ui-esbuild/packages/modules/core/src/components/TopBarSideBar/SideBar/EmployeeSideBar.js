import React from "react";
import { useHistory } from "react-router-dom";
import MediaQuery from "react-responsive";
import { useEmployeeNavItems, navigateToEmployeeUrl } from "./employeeNavItems";
import { AppSideNav } from "./AppSideNav";

/**
 * A pinned sidebar is a display preference, not user data: it survives a
 * reload but nothing downstream reads it, so one key per browser is the right
 * scope. (Contrast the dashboard layout, which is keyed by tenant+user
 * because two personas sharing a machine would otherwise overwrite each
 * other's saved arrangement.) A shared counter machine sharing this costs one
 * click to undo.
 */
const PINNED_STORAGE_KEY = "ccrs.employee.sidebar-pinned";

const EmployeeSideBar = ({ t, crestUrl, crestAlt }) => {
  const { items } = useEmployeeNavItems();
  const history = useHistory();
  const isMultiRootTenant = Digit.Utils.getMultiRootTenant();
  const tenantId = Digit.ULBService.getStateId();

  const onItemSelect = (item) => {
    if (item?.navigationUrl) {
      navigateToEmployeeUrl(history, item?.navigationUrl, { isMultiRootTenant, tenantId });
    }
  };

  // No early return while the nav items load. A spinner in place of the rail
  // meant the crest, the toggle and the rail's width all arrived late; the
  // rail renders at once and its rows fill in.
  return (
    <MediaQuery minWidth={768}>
      <AppSideNav
        t={t}
        items={items}
        storageKey={PINNED_STORAGE_KEY}
        crestUrl={crestUrl}
        crestAlt={crestAlt}
        onItemSelect={onItemSelect}
      />
    </MediaQuery>
  );
};

export default EmployeeSideBar;
