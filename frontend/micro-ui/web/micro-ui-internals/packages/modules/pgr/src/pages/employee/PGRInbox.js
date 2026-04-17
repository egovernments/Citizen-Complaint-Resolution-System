import React, { useMemo, useState, useEffect } from "react";
import { InboxSearchComposer, HeaderComponent, Toast, Loader } from "@egovernments/digit-ui-components";
import { useTranslation } from "react-i18next";
import PGRSearchInboxConfig from "../../configs/PGRSearchInboxConfig";
import { useLocation } from "react-router-dom";
import _ from "lodash";


const PGRSearchInbox = () => {
  const { t } = useTranslation();
  // Detect if the user is on a mobile device
  const isMobile = window.Digit.Utils.browser.isMobile();

  // Get current ULB tenant ID
  const tenantId = Digit.ULBService.getCurrentTenantId();

  const [pageConfig, setPageConfig] = useState(null);



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
  const configs = useMemo(() => {
    return mdmsData || PGRSearchInboxConfig();
  }, [mdmsData]);

  // Fetch the list of service definitions (e.g., complaint types) for current tenant
  const serviceDefs = Digit.Hooks.pgr.useServiceDefs(tenantId, "PGR");
  /**
   * Reset or refresh config when the route changes
   */
  useEffect(() => {
    if (configs) {
      setPageConfig(_.cloneDeep(configs));
    }
  }, [location.pathname, configs]);

  /**
   * Preprocess config: inject service codes, mobile validation, and apply translations
   */
  const updatedConfig = useMemo(() => {
    if (!pageConfig || !serviceDefs || serviceDefs.length === 0) return null;

    // Step 1: Inject service codes into filter dropdown
    let processedConfig = Digit.Utils.preProcessMDMSConfigInboxSearch(
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
    );

    // Step 2: Inject mobile validation rules into search section
    if (processedConfig && validationRules && processedConfig.sections?.search?.uiConfig?.fields) {
      const { min, max } = getMinMaxValues();
      processedConfig = {
        ...processedConfig,
        sections: {
          ...processedConfig.sections,
          search: {
            ...processedConfig.sections.search,
            uiConfig: {
              ...processedConfig.sections.search.uiConfig,
              fields: processedConfig.sections.search.uiConfig.fields.map((field) => {
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
    }  // close: if (processedConfig && validationRules ...)

    return processedConfig;
  }, [pageConfig, serviceDefs, validationRules, t]);

  /**
    * Show loader until necessary data is available
    */
  if (isLoading || isValidationLoading || !pageConfig || !updatedConfig || serviceDefs?.length === 0) {
    return <Loader />;
  }

  console.log("*** Log ===> 1", configs);
  console.log("*** Log ===> 11", updatedConfig);

  return (
    <div style={{ marginBottom: "80px" }}>
      <div
        style={
          isMobile
            ? { marginLeft: "-12px", fontFamily: "calibri", color: "#FF0000" }
            : { marginLeft: "15px", fontFamily: "calibri", color: "#FF0000" }
        }
      >
        {
          <HeaderComponent
            className="digit-inbox-search-composer-header"
            styles={{ marginBottom: "1.5rem" }}
          >
            {t("PGR_SEARCH_RESULTS_HEADING")}
          </HeaderComponent>
        }
      </div>

      {/* Complaint search and filter interface */}
      <div className="digit-inbox-search-wrapper">
        <InboxSearchComposer configs={updatedConfig} />
      </div>
    </div>
  );
};

export default PGRSearchInbox;
