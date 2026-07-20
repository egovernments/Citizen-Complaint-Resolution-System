import React from "react";
import { Redirect, Route, Switch, useLocation, useRouteMatch } from "react-router-dom";

import ChangePassword from "../pages/employee/ChangePassword/index";
import ForgotPassword from "../pages/employee/ForgotPassword/index";
import { AppHome } from "./Home";
// import UserProfile from "./userProfile";

const getTenants = (codes, tenants) => {
  return tenants.filter((tenant) => codes?.map?.((item) => item.code).includes(tenant.code));
};

export const AppModules = ({ stateCode, userType, modules, appTenants, additionalComponent }) => {
  const ComponentProvider = Digit.Contexts.ComponentProvider;
  const { path } = useRouteMatch();
  const location = useLocation();

  const user = Digit.UserService.getUser();

  if (!user || !user?.access_token || !user?.info) {
    return <Redirect to={{ pathname: `/${window?.contextPath}/employee/user/login`, state: { from: location.pathname + location.search } }} />;
  }

  const appRoutes = modules?.map(({ code, tenants }, index) => {
    const Module = Digit.ComponentRegistryService.getComponent(`${code}Module`);
    return Module ? (
      <Route key={index} path={`${path}/${code.toLowerCase()}`}>
        <Module stateCode={stateCode} moduleCode={code} userType={userType} tenants={getTenants(tenants, appTenants)} />
      </Route>
    ) : (
      <Route key={index} path={`${path}/${code.toLowerCase()}`}>
        <Redirect
          to={`/${window?.contextPath}/employee/user/error?type=notfound&module=${code}` }
        />
      </Route>
    );
  });
  // Always-on fallback for the supervisor dashboard: appRoutes above are built
  // from initData.modules (MDMS tenant.citymodule ∩ enabledModules), so without
  // the "Dashboard" citymodule row the route would fall through to AppHome.
  // When the row IS present the appRoutes entry matches first in the Switch,
  // so this never double-mounts. Role-gating lives inside DashboardModule.
  const DashboardFallbackModule = Digit.ComponentRegistryService.getComponent("DashboardModule");

  const isSuperUserWithMultipleRootTenant = Digit.UserService.hasAccess("SUPERUSER") && Digit.Utils.getMultiRootTenant();
   const hideClass =
    location.pathname.includes(`${path}/productDetailsPage/`);

  return (
    <div className={isSuperUserWithMultipleRootTenant ? "" : "ground-container digit-home-ground"}>
      <Switch>
        {appRoutes}
        {DashboardFallbackModule && (
          <Route path={`${path}/dashboard`}>
            <DashboardFallbackModule stateCode={stateCode} moduleCode="Dashboard" userType={userType} tenants={appTenants} />
          </Route>
        )}
        <Route path={`${path}/login`}>
          <Redirect to={{ pathname: `/${window?.contextPath}/employee/user/login`, state: { from: location.pathname + location.search } }} />
        </Route>
        <Route path={`${path}/forgot-password`}>
          <ForgotPassword />
        </Route>
        <Route path={`${path}/change-password`}>
          <ChangePassword />
        </Route>
        <Route>
          <AppHome userType={userType} modules={modules} additionalComponent={additionalComponent} />
        </Route>
        {/* <Route path={`${path}/user-profile`}> <UserProfile /></Route> */}
      </Switch>
    </div>
  );
};
