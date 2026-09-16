import React from "react";
import { CitizenSideBar } from "./CitizenSideBar";
import EmployeeSideBar from "./EmployeeSideBar";
import { useEmployeeNavItems } from "./employeeNavItems";

// The employee mobile drawer needs the same nav tree the desktop SideNav
// renders. Fetching it in a wrapper keeps the hook out of CitizenSideBar,
// which also serves citizens and must not mount the access-control query.
const EmployeeMobileSideBar = (props) => {
  const { items } = useEmployeeNavItems();
  return <CitizenSideBar {...props} employeeNavItems={items} />;
};

const SideBar = ({ t, CITIZEN, isSidebarOpen, toggleSidebar, handleLogout, mobileView, userDetails, modules, linkData, islinkDataLoading,userProfile}) => {
  if (CITIZEN)
    return (
      <CitizenSideBar
        isOpen={isSidebarOpen}
        isMobile={true}
        toggleSidebar={toggleSidebar}
        onLogout={handleLogout}
        linkData={linkData}
        islinkDataLoading={islinkDataLoading}
        userProfile={userProfile}
        isEmployee={false}
      />
    );
    else {
      return !isSidebarOpen && userDetails?.access_token ? (
        <div className="digit-employeeSidebar">
          <EmployeeSideBar {...{ mobileView, userDetails, modules }} />
        </div>
      ) : (
        <div className="digit-citizenSidebar">
          <EmployeeMobileSideBar
            isOpen={isSidebarOpen}
            isMobile={true}
            toggleSidebar={toggleSidebar}
            onLogout={handleLogout}
            isEmployee={true}
            userProfile={userProfile}
          />
        </div>
      );
    }
};

export default SideBar;
