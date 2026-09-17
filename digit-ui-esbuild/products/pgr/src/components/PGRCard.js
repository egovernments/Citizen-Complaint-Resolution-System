import { EmployeeModuleCard, SVG } from "@egovernments/digit-ui-react-components";
import React, { useEffect } from "react";
import { useTranslation } from "react-i18next";

const ROLES = {
  PGR: ["GRO", "PGR_LME", "CSR"],
};

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
  const userInfo = Digit.UserService.getUser();
  const userRoles = userInfo?.info?.roles?.map((roleData) => roleData?.code);
  const generateLink = (labelKey, pathSuffix, roles = ROLES.PGR) => {
    return {
      label: t(labelKey),
      link: `/${window?.contextPath}/employee/pgr/${pathSuffix}`,
      roles: roles,
    };
  };

  if (!Digit.Utils.didEmployeeHasAtleastOneRole(Object.values(ROLES).flatMap((e) => e))) {
    return null;
  }

  let links = [
    generateLink("ACTION_TEST_CREATE_COMPLAINT", "create-complaint", ["CSR"]),
    generateLink("ACTION_TEST_SEARCH_COMPLAINT", "inbox-v2"),
  ];
  const hasRequiredRoles = (link) => { 
    if (!link?.roles?.length) return true;
    return Digit.Utils.didEmployeeHasAtleastOneRole(link.roles);
  };
  links = links.filter(hasRequiredRoles);

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
