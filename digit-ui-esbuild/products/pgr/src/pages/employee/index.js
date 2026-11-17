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
import React, { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Redirect, Route, Switch } from "react-router-dom";
import { useLocation } from "react-router-dom";

/**
 * Any complaints address without a page of its own goes to the complaints
 * list (`to`), which the menu calls "Search Complaint". The commonest is
 * `/employee/pgr/inbox`, the inbox's address before it moved to `inbox-v2`:
 * it is still in bookmarks, old MDMS menu rows and guides, and it used to
 * open a blank page under the breadcrumb (#2808). The query string, the hash
 * and any history state are kept. The console says why, once per arrival:
 * from an effect, not from render.
 */
const ToComplaintsList = ({ to }) => {
  const location = useLocation();
  useEffect(() => {
    console.warn(`PGR: no complaints page at ${location.pathname}; opening the complaints list (${to}) instead.`);
  }, [location.pathname, to]);
  return <Redirect to={{ ...location, pathname: to }} />;
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

        {/* One page per address; an unknown one goes to the last route. Each
            page is passed as itself, not wrapped in a new function on every
            render, so a re-render here (a change of address, say) does not
            remount it and lose its state. */}
        <Switch>
          {/* Route for Create Complaint Form */}
          <PrivateRoute
            path={`${path}/create-complaint`}
            component={PGRCreateComplaint}
          />

          {/* Routes for Complaint submission success/failure response */}
          <PrivateRoute
            path={`${path}/complaint-success`}
            component={PGRResponse}
          />
          <PrivateRoute
            path={`${path}/complaint-failed`}
            component={PGRResponse}
          />

          {/* Route for Complaint Details view by complaint ID */}
          <PrivateRoute
            path={`${path}/complaint-details/:id`}
            component={PGRComplaintDetails}
          />

          {/* Route for Complaint Search Inbox */}
          <PrivateRoute
            path={`${path}/inbox-v2`}
            component={PGRSearchInbox}
          />

          {/* The old UI's addresses for a complaint and for a new one, still in
              bookmarks, old links and MDMS menu rows, open the pages that
              replaced them (#2808). */}
          <Redirect
            from={`${path}/complaint/details/:id`}
            to={{ ...location, pathname: `${path}/complaint-details/:id` }}
          />
          <Redirect from={`${path}/complaint/create`} to={{ ...location, pathname: `${path}/create-complaint` }} />

          {/* Old inbox address and anything else unknown (#2808). The list
              is under this app's own path, so the no-top-bar mount stays
              no-top-bar. */}
          <Route>
            <ToComplaintsList to={`${path}/inbox-v2`} />
          </Route>
        </Switch>

      </AppContainer>
    </Switch>
  );
};

export default EmployeeApp;
