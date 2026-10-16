/**
 * EmployeeApp - Main Routing Component for PGR Employee Module
 * 
 * Purpose:
 * This component handles all route-level rendering for PGR employee-facing features like:
 * - Creating a complaint
 * - Viewing complaint inbox
 * - Viewing complaint details
 * - Handling success/failure response screens
 * 
 * Functionalities:
 * - Dynamically loads feature components using Digit's ComponentRegistryService
 * - Sets up breadcrumbs based on current route
 * - Renders private routes with layout wrapper (AppContainer)
 */

import { AppContainer, PrivateRoute } from "@egovernments/digit-ui-react-components";
import React from "react";
import { useTranslation } from "react-i18next";
import { Redirect, Switch } from "react-router-dom";
import { useLocation } from "react-router-dom";
import CountyFirst from "./CreateComplaint/CountyFirst"; // ours (#1857)
import { getPGREmployeeLinks } from "../../utils/employeeLinks"; // ours (#1857)

// ours#615: the create-complaint route follows its menu entry. Only an employee whose access actions offer
// /employee/pgr/create-complaint (the "File a Complaint" entry, ACCESSCONTROL role-actions) gets the form; anyone
// else is sent home instead of seeing a form whose submit the API refuses.
const offersCreateComplaint = (actions) =>
  (actions || []).some((a) => /\/employee\/pgr\/create-complaint\/?$/.test(a?.navigationURL || ""));

// ours (#1857): the route follows the MENU entry it is reached from - the PGR module's own "File a Complaint" link
// (utils/employeeLinks, role CSR) - as well as the access actions: at a state whose role-actions carry no employee
// create-complaint row (digit-3's ke), the menu offered File a Complaint and this guard sent its click back home.
// Whoever the menu does not offer it (an LME, a SUPERUSER alone) is still sent home (#615).
const menuOffersCreate = (t) => getPGREmployeeLinks(t).some((link) => link.key === "create");

const CreateComplaintGuard = ({ component: Component }) => {
  const { t } = useTranslation();
  const { isLoading, data } = Digit.Hooks.useAccessControl();
  if (isLoading) return null;
  // ours (#1857): at a county-layout state the form is the chosen county's (CountyFirst)
  return offersCreateComplaint(data?.actions) || menuOffersCreate(t)
    ? <CountyFirst component={Component} />
    : <Redirect to={`/${window?.contextPath}/employee`} />;
};

const EmployeeApp = ({ path, stateCode, userType, tenants }) => {
  const { t } = useTranslation(); // Hook for translations
  const location = useLocation(); // Used to determine the current pathname for conditional rendering

  // Dynamically fetch PGR module screens from the registry
  const PGRCreateComplaint = Digit?.ComponentRegistryService?.getComponent("PGRCreateComplaint");
  const PGRComplaintDetails = Digit?.ComponentRegistryService?.getComponent("PGRComplaintDetails");
  const PGRSearchInbox = Digit?.ComponentRegistryService?.getComponent("PGRSearchInbox");
  const PGRResponse = Digit?.ComponentRegistryService?.getComponent("PGRResponse");
  const BreadCrumbs = Digit?.ComponentRegistryService?.getComponent("PGRBreadCrumbs");

  return (
    <Switch>
      {/* AppContainer provides a consistent layout and styling */}
      <AppContainer className="ground-container">

        {/* Render dynamic breadcrumbs based on route path */}
        <React.Fragment>
          <BreadCrumbs
            location={location}
            crumbs={[
              {
                content: t("ACTION_TEST_HOME"), // Home label
                internalLink: `/${window?.contextPath}/employee`, // Link to employee home
                show: true,
              },
              {
                internalLink: `/${window?.contextPath}/employee/pgr/create-complaint`,
                content: t("CS_COMMON_FILE_A_COMPLAINT"),
                show: location.pathname.includes("create-complaint"),
              },
              {
                internalLink: `/${window?.contextPath}/employee/pgr/inbox-v2`,
                content: t("PGR_INBOX"),
                show: location.pathname.includes("inbox"),
              },
              {
                internalLink: `/${window?.contextPath}/employee/pgr/complaint-details`,
                content: t("CS_COMPLAINT_DETAILS_COMPLAINT_DETAILS"),
                show: location.pathname.includes("complaint-details"),
              }
            ]}
          />
        </React.Fragment>

        {/* Route for Create Complaint Form */}
        <PrivateRoute
          path={`${path}/create-complaint`}
          component={() => <CreateComplaintGuard component={PGRCreateComplaint} />}
        />

        {/* Routes for Complaint submission success/failure response */}
        <PrivateRoute
          path={`${path}/complaint-success`}
          component={() => <PGRResponse />}
        />
        <PrivateRoute
          path={`${path}/complaint-failed`}
          component={() => <PGRResponse />}
        />

        {/* Route for Complaint Details view by complaint ID */}
        <PrivateRoute
          path={`${path}/complaint-details/:id`}
          component={() => <PGRComplaintDetails />}
        />

        {/* Route for Complaint Search Inbox */}
        <PrivateRoute
          path={`${path}/inbox-v2`}
          component={() => <PGRSearchInbox />}
        />

      </AppContainer>
    </Switch>
  );
};

export default EmployeeApp;
