import { EmployeeModuleCard, SVG } from "@egovernments/digit-ui-react-components";
import React, { useEffect } from "react";
import { useTranslation } from "react-i18next";

// Every role that is an ACTOR in the PGR BusinessService must be listed here,
// otherwise `didEmployeeHasAtleastOneRole` below returns false and the whole
// module card — including the "Search Complaint" link — is hidden, leaving that
// role with no way into the module at all (issue #1956: a SUPERVISOR could not
// reach an escalated complaint because SUPERVISOR was missing from this list).
// SUPERVISOR owns the PENDINGATSUPERVISOR state (RESOLVEBYSUPERVISOR), so it
// belongs with the other PGR actors. Keep this in sync with the workflow's role
// set when a new state/actor is added.
const ROLES = {
  PGR: ["GRO", "PGR_LME", "CSR", "SUPERVISOR"],
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
    Icon: "UpdateExpense",
    moduleName: t("PGR"),
    kpis: [],
    links: links,
    className: "microplan-employee-module-card",
  };
  return <EmployeeModuleCard {...propsForModuleCard} />;
};

export default PGRCard;
