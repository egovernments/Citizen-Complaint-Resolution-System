import { isIdentityBffAuth } from "@egovernments/digit-ui-libraries";
import React, { useState } from "react";
import TopBar from "./TopBar";
import { useHistory } from "react-router-dom";
import SideBar from "./SideBar";
import CitizenNavSideBar from "./SideBar/CitizenNavSideBar";
import LogoutDialog from "../Dialog/LogoutDialog";
const TopBarSideBar = ({
  t,
  stateInfo,
  userDetails,
  CITIZEN,
  cityDetails,
  mobileView,
  handleUserDropdownSelection,
  logoUrl,
  logoUrlWhite,
  showSidebar = true,
  // The citizen's desktop rail. The employee rail comes with SideBar; the
  // citizen one is asked for by the page, which knows which of its routes
  // (sign-in, language, location) have none.
  showRail = false,
  showLanguageChange,
  linkData,
  islinkDataLoading,
}) => {
  const [isSidebarOpen, toggleSidebar] = useState(false);
  const history = useHistory();
  // Working context (CCRS#1833) is fetched once here and handed to whichever
  // top bar renders, so a custom header consumes the same contract.
  const workingContextTenantId = cityDetails?.code || userDetails?.info?.tenantId;
  const { data: workingContext, isError: workingContextError } = Digit.Hooks.pgr.useEmployeeWorkingContext(
    workingContextTenantId,
    { enabled: !CITIZEN && !!workingContextTenantId && !!userDetails?.access_token }
  );
  const [showDialog, setShowDialog] = useState(false);
  const handleLogout = () => {
    toggleSidebar(false);
    setShowDialog(true);
  };
  const handleOnSubmit = async () => {
    await Digit.UserService.logout();
    setShowDialog(false);
  };
  const handleOnCancel = () => {
    setShowDialog(false);
  };

  const handleSidebar = () => {
    toggleSidebar(!isSidebarOpen);
  };
  const userProfile = () => {
    CITIZEN ? history.push(`/${window?.contextPath}/citizen/user/profile`) : history.push(`/${window?.contextPath}/employee/user/profile`);
  };
  const userOptions = [
    { name: t("EDIT_PROFILE"), icon: "Edit", func: userProfile },
    ...(isIdentityBffAuth() ? [{ name: t("CORE_IDENTITY_ACCOUNT", { defaultValue: "Account and security" }), icon: "Person",
      func: () => history.push(`/${window.contextPath}/${CITIZEN ? "citizen" : "employee"}/user/account`) }] : []),
    { name: t("CORE_COMMON_LOGOUT"), icon: "Logout", func: handleLogout },
  ];

  return (
    <React.Fragment>
      <TopBar
        t={t}
        stateInfo={stateInfo}
        toggleSidebar={handleSidebar}
        isSidebarOpen={isSidebarOpen}
        handleLogout={handleLogout}
        userDetails={userDetails}
        CITIZEN={CITIZEN}
        cityDetails={cityDetails}
        mobileView={mobileView}
        userOptions={userOptions}
        handleUserDropdownSelection={handleUserDropdownSelection}
        logoUrl={logoUrl}
        logoUrlWhite={logoUrlWhite}
        showLanguageChange={showLanguageChange}
        workingContext={workingContext}
        workingContextError={workingContextError}
        workingContextTenantId={workingContextTenantId}
      />
      {showDialog && <LogoutDialog onSelect={handleOnSubmit} onCancel={handleOnCancel} onDismiss={handleOnCancel}></LogoutDialog>}
      {CITIZEN && showRail ? <CitizenNavSideBar t={t} linkData={linkData} onLogout={handleLogout} /> : null}
      {!CITIZEN
        ? showSidebar && (
            <SideBar
              t={t}
              CITIZEN={CITIZEN}
              isSidebarOpen={isSidebarOpen}
              toggleSidebar={handleSidebar}
              handleLogout={handleLogout}
              mobileView={mobileView}
              userDetails={userDetails}
              linkData={linkData}
              userProfile={userProfile}
              islinkDataLoading={islinkDataLoading}
            />
          )
        : CITIZEN
        ? showSidebar && isSidebarOpen && (
            <SideBar
              t={t}
              CITIZEN={CITIZEN}
              isSidebarOpen={isSidebarOpen}
              toggleSidebar={handleSidebar}
              handleLogout={handleLogout}
              mobileView={mobileView}
              userDetails={userDetails}
              linkData={linkData}
              userProfile={userProfile}
              islinkDataLoading={islinkDataLoading}
            />
          )
        : null}
    </React.Fragment>
  );
};
export default TopBarSideBar;
