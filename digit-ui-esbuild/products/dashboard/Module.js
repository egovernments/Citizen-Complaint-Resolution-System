import React from "react";
import { Redirect } from "react-router-dom";
import AdminDashboard from "./src/AdminDashboard";
import DashboardCard from "./DashboardCard";
import { DASHBOARD_ROLES } from "./roles";

export { DASHBOARD_ROLES };

// Mounted by core AppModules at /{contextPath}/employee/dashboard INSIDE the
// employee chrome (topbar + sidebar). AppModules already guarantees a logged-in
// session, so the only guard needed here is the role check — tenant-agnostic
// (see roles.js) — before rendering the dashboard in embedded mode (which
// suppresses its standalone shell: internal sidebar, login gate, 100dvh layout).
const DashboardModule = () => {
  if (!Digit.UserService.hasAccess(DASHBOARD_ROLES)) {
    return <Redirect to={`/${window?.contextPath}/employee`} />;
  }
  return <AdminDashboard embedded />;
};

const componentsToRegister = {
  DashboardModule,
  DashboardCard,
};

export const initDashboardComponents = () => {
  Object.entries(componentsToRegister).forEach(([key, value]) => {
    Digit.ComponentRegistryService.setComponent(key, value);
  });
};
