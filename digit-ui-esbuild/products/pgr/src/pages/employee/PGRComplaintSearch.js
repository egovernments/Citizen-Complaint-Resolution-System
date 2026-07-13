import React, { useMemo, useState, useEffect } from "react";
import { InboxSearchComposer, Loader } from "@egovernments/digit-ui-components";
import { useTranslation } from "react-i18next";
import _ from "lodash";
import PGRComplaintSearchConfig from "../../configs/PGRComplaintSearchConfig";
import { useLocation } from "react-router-dom";

/**
 * PGRComplaintSearch — employee "Search Citizen Complaint" screen (/employee/pgr/search).
 *
 * Sibling of PGRInbox (the /inbox-v2 screen). Same InboxSearchComposer + config
 * injection; the only difference is the config it loads (PGRComplaintSearchConfig)
 * and a `pgr-complaint-search` wrapper class so its styling can diverge from the
 * inbox without touching it. Results are driven purely by the applied filters
 * (Department / Complaint Type / Assigned / Província / Status).
 */
const PGRComplaintSearch = () => {
  const { t } = useTranslation();

  const tenantId = Digit.ULBService.getCurrentTenantId();

  // Holds the inbox page configuration (filter/search UI structure).
  const [pageConfig, setPageConfig] = useState(null);

  // Detect route changes to trigger config reset (see the reference-stability
  // note in PGRInbox.js re: CCRS#558).
  const location = useLocation();

  // Mobile-number validation rules (prefix, pattern, min/max) from MDMS.
  const { validationRules, isLoading: isValidationLoading, getMinMaxValues } = Digit.Hooks.pgr.useMobileValidation(tenantId);

  // Static config (no MDMS-hosted override for this screen).
  let configs = PGRComplaintSearchConfig();

  // Inject mobile validation rules into the search config's mobileNumber field.
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

  // Service definitions (complaint types) for the current tenant. Also primes
  // the SessionStorage "serviceDefs" cache the Department dropdown reads.
  const serviceDefs = Digit.Hooks.pgr.useServiceDefs(tenantId, "PGR");

  // Preprocess config with translations.
  const updatedConfig = useMemo(
    () => Digit.Utils.preProcessMDMSConfigInboxSearch(t, pageConfig, "sections.filter.uiConfig.fields", {}),
    [pageConfig]
  );

  // Reset/refresh config on route change.
  useEffect(() => {
    setPageConfig(_.cloneDeep(configs));
  }, [location]);

  if (isValidationLoading || !pageConfig || serviceDefs?.length === 0) {
    return <Loader />;
  }

  const headingKey = "PGR_SEARCH_COMPLAINT";
  const heading = (() => {
    const v = t(headingKey);
    return v === headingKey ? "Search Citizen Complaint" : v;
  })();

  return (
    <div className="v2-pgr-inbox v2-scope pgr-complaint-search">
      <header className="v2-employee-page-header">
        <h1>{heading}</h1>
      </header>
      <div className="digit-inbox-search-wrapper">
        <InboxSearchComposer configs={updatedConfig} />
      </div>
    </div>
  );
};

export default PGRComplaintSearch;
