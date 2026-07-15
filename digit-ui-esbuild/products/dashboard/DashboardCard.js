import { EmployeeModuleCard } from "@egovernments/digit-ui-react-components";
import React from "react";
import { useTranslation } from "react-i18next";
import { DASHBOARD_ROLES } from "./roles";

const DashboardCard = () => {
  const { t } = useTranslation();

  // Same tenant-agnostic check as the DashboardModule route guard (roles live
  // at the state root tenant), so the card and the route always agree.
  if (!Digit.UserService.hasAccess(DASHBOARD_ROLES)) {
    return null;
  }

  const link = `/${window?.contextPath}/employee/dashboard`;

  const propsForModuleCard = {
    Icon: "Dashboard",
    moduleName: t("DASHBOARD_CARD_HEADER"),
    kpis: [],
    links: [
      {
        label: t("DASHBOARD_CARD_HEADER"),
        link: link,
      },
    ],
    className: "microplan-employee-module-card",
  };

  return <EmployeeModuleCard {...propsForModuleCard} />;
};

export default DashboardCard;
