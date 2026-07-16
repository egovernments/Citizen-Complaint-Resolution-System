import React from "react";
import { Redirect } from "react-router-dom";
import { Loader } from "@egovernments/digit-ui-react-components";
import AdminDashboard from "./src/AdminDashboard";
import DashboardCard from "./DashboardCard";
import { DASHBOARD_ROLES } from "./roles";

export { DASHBOARD_ROLES };

// Mounted by core AppModules at /{contextPath}/employee/dashboard INSIDE the
// employee chrome (topbar + sidebar). AppModules already guarantees a logged-in
// session, so the only guard needed here is the role check — tenant-agnostic
// (see roles.js) — before rendering the dashboard in embedded mode (which
// suppresses its standalone shell: internal sidebar, login gate, 100dvh layout).
const DashboardModule = ({ stateCode }) => {
  // Lazy-load this module's localization bundles into the host i18next
  // (same pattern as PGRModule): rainmaker-dashboard for the dashboard's own
  // chrome/labels, rainmaker-pgr for complaint-type + workflow-status names,
  // rainmaker-boundary-<hierarchy> for ward names on the map and filters.
  const hierarchyType = window?.globalConfigs?.getConfig("HIERARCHY_TYPE") || "ADMIN";
  const { isLoading } = Digit.Services.useStore({
    stateCode,
    moduleCode: ["dashboard", "pgr", `boundary-${hierarchyType?.toString().toLowerCase()}`],
    language: Digit.StoreData.getCurrentLanguage(),
    modulePrefix: "rainmaker",
  });
  if (!Digit.UserService.hasAccess(DASHBOARD_ROLES)) {
    return <Redirect to={`/${window?.contextPath}/employee`} />;
  }
  if (isLoading) {
    return <Loader />;
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
