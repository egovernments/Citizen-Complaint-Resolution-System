import React from "react";
import { Link } from "react-router-dom";
import useDashboardT from "../i18n/useDashboardT";

/**
 * Breadcrumb trail for the EMBEDDED dashboard (mounted inside the DigitUI
 * employee chrome by products/dashboard/Module.js).
 *
 * Why this exists: the embedded dashboard is a leaf route with no in-page way
 * back — the only exit was the left rail's Home item, which is easy to miss on
 * the collapsed 3rem rail and disappears entirely for roles whose access-control
 * grants don't include it. Every other employee screen (see the PGR module's
 * BreadCrumbs usage in products/pgr/src/pages/employee/index.js) carries a
 * "Home / <page>" trail, so this restores the platform convention rather than
 * inventing a bespoke back button.
 *
 * Standalone mode is unaffected: DashboardLayout only renders this when
 * `embedded`, so <Link> is never mounted outside the host's Router.
 *
 * Labels resolve through the dashboard's own t(), which deliberately echoes the
 * KEY when a message is unseeded so gaps surface in QA. A breadcrumb showing
 * "DASHBOARD_BREADCRUMB_CURRENT" would be worse than useless on a live env, so
 * every label goes through `label()`, which falls back to English until the
 * key is seeded — the same exists()-guarded pattern DashboardHeader uses for
 * DASHBOARD_HEADER_TITLE.
 */
const DashboardBreadcrumb = () => {
  // Calling the hook (rather than importing translate directly) subscribes this
  // component to locale changes and late bundle arrivals, so the crumbs
  // re-render when the user switches language.
  const { t, exists } = useDashboardT();

  // First seeded key wins; English is the last resort so the trail is always
  // readable. ACTION_TEST_HOME is the platform's existing "Home" label — the
  // one the PGR breadcrumbs and the sidebar Home item already use — so a tenant
  // that has localized its nav gets a consistent word for free.
  const label = (keys, english) => {
    const key = keys.find((k) => exists(k));
    return key ? t(key, english) : english;
  };

  // contextPath is the deploy-time mount point ("digit-ui"); mirror the
  // defensive read used elsewhere in the app rather than hardcoding it.
  const homePath = `/${window?.contextPath}/employee`;

  return (
    <nav
      className="dashboard-breadcrumb"
      aria-label={label(["DASHBOARD_BREADCRUMB_ARIA_LABEL"], "Breadcrumb")}
    >
      <ol className="dashboard-breadcrumb-list">
        <li className="dashboard-breadcrumb-item">
          <Link to={homePath} className="dashboard-breadcrumb-link">
            {label(["DASHBOARD_BREADCRUMB_HOME", "ACTION_TEST_HOME"], "Home")}
          </Link>
          <span className="dashboard-breadcrumb-separator" aria-hidden="true">
            /
          </span>
        </li>
        <li className="dashboard-breadcrumb-item">
          <span className="dashboard-breadcrumb-current" aria-current="page">
            {label(["DASHBOARD_BREADCRUMB_CURRENT"], "Dashboard")}
          </span>
        </li>
      </ol>
    </nav>
  );
};

export default DashboardBreadcrumb;
