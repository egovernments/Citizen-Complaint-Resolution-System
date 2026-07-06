import React, { useMemo, useState, useEffect } from "react";
import { InboxSearchComposer, Loader } from "@egovernments/digit-ui-components";
import { useTranslation } from "react-i18next";
import _ from "lodash";
import PGRComplaintSearchConfig from "../../configs/PGRComplaintSearchConfig";
import { useLocation } from "react-router-dom";

/**
 * PGRComplaintSearch — "Search Citizen Complaint" screen.
 *
 * Same InboxSearchComposer machinery as PGRSearchInbox, but driven by
 * PGRComplaintSearchConfig: adds Department + Assignee filters, drops the
 * "Assigned to me/all" radio, and renders Status as a dropdown. Filter→API
 * mapping lives in UICustomizations.PGRComplaintSearchConfig.preProcess.
 */
const PGRComplaintSearch = () => {
  const { t } = useTranslation();
  const tenantId = Digit.ULBService.getCurrentTenantId();
  const [pageConfig, setPageConfig] = useState(null);
  const location = useLocation();

  const { validationRules, isLoading: isValidationLoading, getMinMaxValues } =
    Digit.Hooks.pgr.useMobileValidation(tenantId);

  let configs = PGRComplaintSearchConfig();

  // Inject tenant mobile-validation rules into the "Mobile No" search field (same as the inbox).
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
            fields: configs.sections.search.uiConfig.fields.map((field) =>
              field.label === "CS_COMMON_MOBILE_NO" && field.populators?.name === "mobileNumber"
                ? {
                    ...field,
                    populators: {
                      ...field.populators,
                      prefix: validationRules.prefix,
                      validation: {
                        minlength: validationRules.minLength,
                        maxlength: validationRules.maxLength,
                        min,
                        max,
                        pattern: validationRules.pattern,
                      },
                      error: validationRules.errorMessage || field.populators.error,
                    },
                  }
                : field
            ),
          },
        },
      },
    };
  }

  // Feed complaint types into the (hierarchy-driven) filter, mirroring the inbox.
  const serviceDefs = Digit.Hooks.pgr.useServiceDefs(tenantId, "PGR");

  const updatedConfig = useMemo(
    () =>
      Digit.Utils.preProcessMDMSConfigInboxSearch(t, pageConfig, "sections.filter.uiConfig.fields", {
        updateDependent: [{ key: "serviceCode", value: serviceDefs ? [...serviceDefs] : [] }],
      }),
    [pageConfig, serviceDefs]
  );

  useEffect(() => {
    setPageConfig(_.cloneDeep(configs));
  }, [location]);

  if (isValidationLoading || !pageConfig) return <Loader />;

  const headingKey = "PGR_SEARCH_COMPLAINT";
  const v = t(headingKey);
  const heading = v === headingKey ? "Search Citizen Complaint" : v;

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
