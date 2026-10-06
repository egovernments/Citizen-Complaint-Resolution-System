import { EmployeeModuleCard, SVG } from "@egovernments/digit-ui-react-components";
import React, { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { getPGREmployeeLinks } from "../utils/employeeLinks";

const PGRCard = () => {

  // Reset session storage
  // useEffect(() => {
  //   Digit.SessionStorage.del("paymentInbox");
  //   Digit.SessionStorage.del("selectedValues");
  //   Digit.SessionStorage.del("selectedLevel");
  //   Digit.SessionStorage.del("selectedProject");
  //   Digit.SessionStorage.del("selectedBoundaryCode");
  //   Digit.SessionStorage.del("boundary");
  // }, []);

  const { t } = useTranslation();
  // Shared with the sidebar's Complaints section, so both offer the same rows
  // to the same roles. Empty means the user holds none of the PGR roles.
  const links = getPGREmployeeLinks(t).map(({ label, link, roles }) => ({ label, link, roles }));
  if (links.length === 0) {
    return null;
  }

  const propsForModuleCard = {
    // "UpdateExpense" is a line-art document-and-pencil built for an expense
    // screen, which sat next to the Dashboard card's filled grid and read as a
    // different icon set (#2038). Announcement is the filled speech-bubble the
    // reference image uses for complaints, and is already what this tenant's
    // own MDMS "Complaints" card row asks for.
    Icon: "Announcement",
    moduleName: t("PGR"),
    kpis: [],
    links: links,
    className: "microplan-employee-module-card",
  };
  return <EmployeeModuleCard {...propsForModuleCard} />;
};

export default PGRCard;
