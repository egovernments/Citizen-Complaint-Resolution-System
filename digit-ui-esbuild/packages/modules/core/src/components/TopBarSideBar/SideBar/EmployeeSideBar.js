import React from "react";
import { SideNav, Loader } from "@egovernments/digit-ui-components";
import { useHistory } from "react-router-dom";
import MediaQuery from "react-responsive";
import { useEmployeeNavItems, navigateToEmployeeUrl } from "./employeeNavItems";

const EmployeeSideBar = () => {
  const { isLoading, items } = useEmployeeNavItems();
  const isMultiRootTenant = Digit.Utils.getMultiRootTenant();
  const history = useHistory();
  const tenantId = Digit.ULBService.getStateId();

  const onItemSelect = ({ item }) => {
    if (item?.navigationUrl) {
      navigateToEmployeeUrl(history, item?.navigationUrl, { isMultiRootTenant, tenantId });
    }
  };

  if (isLoading) {
    return <Loader />;
  }

  return (
    <MediaQuery minWidth={768}>
      <SideNav
        items={items}
        hideAccessbilityTools={true}
        // #2038: drop the search affordance. SideNav defaults enableSearch to
        // true, which on a CCRS deployment buys a magnifier over a two-item
        // nav. The component already ships the collapsed `searchDisabled`
        // layout for this case, so nothing else has to move.
        enableSearch={false}
        onSelect={({ item, index, parentIndex }) => onItemSelect({ item, index, parentIndex })}
        theme={"dark"}
        variant={"primary"}
        transitionDuration={""}
        className=""
        styles={{}}
        expandedWidth=""
        collapsedWidth=""
        onBottomItemClick={() => {}}
      />
    </MediaQuery>
  );
};

export default EmployeeSideBar;
