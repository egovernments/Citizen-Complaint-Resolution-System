import { EmployeeModuleCard } from "@egovernments/digit-ui-react-components";
import React from "react";
import { useTranslation } from "react-i18next";
import { useDashboardAccess } from "./roles";

const DashboardCard = () => {
  const { t } = useTranslation();

  // Same MDMS-resolved, tenant-agnostic check as the DashboardModule route
  // guard (shared useDashboardAccess hook — one react-query cache entry), so
  // the card and the route always agree. Render nothing while it resolves so
  // the card doesn't flash in or out.
  const { allowed, loading } = useDashboardAccess();
  if (loading || !allowed) {
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
