import React, { useMemo, useState, useEffect } from "react";
import { InboxSearchComposer, HeaderComponent, Toast, Loader } from "@egovernments/digit-ui-components";
import { useTranslation } from "react-i18next";
import _ from "lodash";
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

  // Fetch mobile validation config from MDMS
  const { validationRules, isLoading: isValidationLoading, getMinMaxValues } = Digit.Hooks.pgr.useMobileValidation(tenantId);

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

  // Fallback to static config if MDMS is not available
  let configs = mdmsData || PGRSearchInboxConfig();

  // Inject mobile validation rules from MDMS into the search config
  if (configs && validationRules && configs.sections?.search?.uiConfig?.fields) {
    const { min, max } = getMinMaxValues();
    configs = {
      ...configs,
      sections: {
        ...configs.sections,
        search: {
          ...configs.sections.search,
          uiConfig: {
            ...configs.sections.search.uiConfig,
            fields: configs.sections.search.uiConfig.fields.map((field) => {
              if (field.label === "CS_COMMON_MOBILE_NO" && field.populators?.name === "mobileNumber") {
                return {
                  ...field,
                  populators: {
                    ...field.populators,
                    prefix: validationRules.prefix,
                    validation: {
                      minlength: validationRules.minLength,
                      maxlength: validationRules.maxLength,
                      min: min,
                      max: max,
                      pattern: validationRules.pattern,
                    },
                    error: validationRules.errorMessage || field.populators.error,
                  },
                };
              }
              return field;
            }),
          },
        },
      },
    };
  }

  // Fetch the list of service definitions (e.g., complaint types) for current tenant
  const serviceDefs = Digit.Hooks.pgr.useServiceDefs(tenantId, "PGR");

  /**
   * Preprocess config using translation and inject complaint types into the serviceCode dropdown
   */
  var updatedConfig = useMemo(
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
  if (isLoading || isValidationLoading || !pageConfig || serviceDefs?.length === 0) {
    return <Loader />;
  }

  // i18n fallback for the page header.
  //
  // Notes for future me:
  // The previous version of this file reassigned `updatedConfig`
  // *outside* the `useMemo` above with a fresh spread of
  // `{ ...updatedConfig, sections: {…} }` on every render to inject
  // mobile validation rules a second time (the same injection
  // already happens up-front against `configs`, which then feeds
  // `pageConfig` via `setPageConfig(_.cloneDeep(configs))`). That
  // second pass produced a brand-new `updatedConfig` object reference
  // on every render, so the `configs` prop passed to
  // `<InboxSearchComposer />` was never reference-stable. The
  // composer's cleanup effect with a `[configs]` dep (see the
  // companion fix in `packages/digit-ui-components/src/hoc/InboxSearchComposer.js`)
  // then fired on every render, wiping the user's search form and
  // re-fetching the unfiltered inbox the moment they hit Search —
  // CCRS#558's "inbox refreshes back to the full list" symptom.
  // The first injection is sufficient; remove the duplicate.
  const headingKey = "PGR_SEARCH_RESULTS_HEADING";
  const heading = (() => {
    const v = t(headingKey);
    return v === headingKey ? "Complaints" : v;
  })();

  return (
    <div className="v2-pgr-inbox v2-scope">
      <header className="v2-employee-page-header">
        <h1>{heading}</h1>
      </header>
      {/* Complaint search and filter interface */}
      <div className="digit-inbox-search-wrapper">
        <InboxSearchComposer configs={updatedConfig} />
      </div>
    </div>
  );
};

export default PGRSearchInbox;