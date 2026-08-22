import React from "react";

// Link target when the deployment has not configured DIGIT_HOME_URL.
const DEFAULT_HOME_URL = "https://egov.org.in/digit/";

const getConfig = (key) => window?.globalConfigs?.getConfig?.(key);

// "Powered by DIGIT" attribution, matching the citizen/employee DIGIT shells.
// The dashboard bypasses that shell — App.js routes /employee/dashboard straight
// to AdminDashboard — so it has to render its own.
//
// The logo comes from globalConfigs only, with no baked-in URL, so a deployment
// can rebrand or drop the attribution without a code change. When DIGIT_FOOTER
// is unset we render nothing rather than a broken image, which is the same guard
// the employee shell uses (packages/modules/core/src/pages/employee/index.js).
const DashboardFooter = () => {
  const logoUrl = getConfig("DIGIT_FOOTER");
  if (!logoUrl) return null;

  return (
    <footer className="dashboard-footer tw-flex tw-flex-shrink-0 tw-items-center tw-justify-center tw-border-t tw-border-border tw-bg-surface tw-py-2">
      <a
        href={getConfig("DIGIT_HOME_URL") || DEFAULT_HOME_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="tw-inline-flex tw-items-center"
      >
        <img className="dashboard-footer-img" alt="Powered by DIGIT" src={logoUrl} />
      </a>
    </footer>
  );
};

export default DashboardFooter;
