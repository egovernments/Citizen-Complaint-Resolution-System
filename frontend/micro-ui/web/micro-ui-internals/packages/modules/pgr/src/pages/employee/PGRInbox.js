import React, { useMemo, useState, useEffect } from "react";
import { Header, InboxSearchComposer, Loader } from "@egovernments/digit-ui-react-components";
import { useTranslation } from "react-i18next";
import PGRSearchInboxConfig from "../../configs/PGRSearchInboxConfig";
import { useLocation } from "react-router-dom";

/**
 * PGRSearchInbox - Complaint Search Inbox Screen
 * 
 * Purpose:
 * This screen renders a search interface to view and filter PGR (Public Grievance Redressal) complaints.
 * 
 * Functional Areas:
 * - Initial Data Load: On screen load, the system fetches a list of complaint filters and configurations (from MDMS or fallback).
 * - Filter Section: Allows filtering by complaint type, assignee, status, and boundary.
 * - Search Section: Enables searching by complaint number, date, and phone.
 * - Link Section: Provides a way to navigate to complaint creation.
 * 
 * Components Used:
 * - InboxSearchComposer: A reusable inbox search builder UI.
 * - Loader: Shows a loader until configs and metadata are loaded.
 * - HeaderComponent: Displays the heading.
 * 
 * Data Dependencies:
 * - MDMS (RAINMAKER-PGR.SearchInboxConfig)
 * - Service Definitions from PGR module
 */

const PGRSearchInbox = () => {
  const { t } = useTranslation();

  // Detect if the user is on a mobile device
  const isMobile = window.Digit.Utils.browser.isMobile();

  // Get current ULB tenant ID
  const tenantId = Digit.ULBService.getCurrentTenantId();

  // Local state to hold the inbox page configuration (filter/search UI structure)
  const [pageConfig, setPageConfig] = useState(null);

  // Used to detect route/location changes to trigger config reset
  const location = useLocation();

  // Fetch MDMS config for inbox screen (RAINMAKER-PGR.SearchInboxConfig)
  const { data: mdmsData, isLoading } = Digit.Hooks.useCommonMDMS(
    Digit.ULBService.getStateId(),
    "RAINMAKER-PGR",
    ["SearchInboxConfig"],
    {
      select: (data) => {
        return data?.["RAINMAKER-PGR"]?.SearchInboxConfig?.[0];
      },
      retry: false,
      enable: false, // Disabled fetch by default, fallback to static config
    }
  );
console.log(mdmsData, "mdmsData")
  // Fallback to static config if MDMS is not available
  const configs = mdmsData || PGRSearchInboxConfig();

  // Fetch the list of service definitions (e.g., complaint types) for current tenant
  const serviceDefs = Digit.Hooks.pgr.useServiceDefs(tenantId, "PGR");

  /**
   * Preprocess config using translation and inject complaint types into the serviceCode dropdown
   */
  const updatedConfig = useMemo(
    () =>
      Digit.Utils.preProcessMDMSConfigInboxSearch(
        t,
        pageConfig,
        "sections.filter.uiConfig.fields",
        {
          updateDependent: [
            {
              key: "serviceCode",
              value: serviceDefs ? [...serviceDefs] : [],
            },
          ],
        }
      ),
    [pageConfig, serviceDefs]
  );

  /**
   * Reset or refresh config when the route changes
   */
  useEffect(() => {
    setPageConfig(_.cloneDeep(configs));
  }, [location]);

  /**
   * Show loader until necessary data is available
   */
  if (isLoading || !pageConfig || serviceDefs?.length === 0) {
    return <Loader />;
  }

  return (
    <React.Fragment>
      <Header styles={{ fontSize: "32px" }}>
        {t(updatedConfig?.label)}
        {data?.totalCount ? <span className="inbox-count">{data?.totalCount}</span> : null}
      </Header>
      <div className="inbox-search-wrapper">
        <InboxSearchComposer configs={updatedConfig}></InboxSearchComposer>
      </div>
    </React.Fragment>
  );
};

export default PGRSearchInbox;
