import React from "react";
import { CitizenSideBar } from "./CitizenSideBar";
import EmployeeSideBar from "./EmployeeSideBar";
import { useEmployeeNavItems } from "./employeeNavItems";

// The employee mobile drawer needs the same nav tree the desktop SideNav
// renders. Fetching it in a wrapper keeps the hook out of CitizenSideBar,
// which also serves citizens and must not mount the access-control query.
// SideNav takes `icon` as `{ icon, width, height }`; Hamburger passes
// `item.icon` straight to iconRender, which wants the name itself. Handing
// the object over rendered no glyph, so Home and Dashboard sat icon-less
// next to rows that had them. Flatten here rather than in the hook, which
// still has to feed SideNav its own shape.
const forHamburger = (items = []) =>
  items.map((item) => ({
    ...item,
    // Not `item?.icon?.icon ?? item?.icon`: extractLeftIcon returns null when a
    // group has no resolvable icon, and `??` would then fall through and hand
    // iconRender the wrapper object, which keys to "[object Object]" and warns.
    icon: typeof item?.icon === "object" && item?.icon !== null ? item.icon.icon : item?.icon,
    ...(item?.children ? { children: forHamburger(item.children) } : {}),
  }));

const EmployeeMobileSideBar = (props) => {
  const { items } = useEmployeeNavItems();
  return <CitizenSideBar {...props} employeeNavItems={forHamburger(items)} />;
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
