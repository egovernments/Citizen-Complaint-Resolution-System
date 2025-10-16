/**
 * CreateComplaint - Container component for Create Complaint screen
 *
 * Purpose:
 * Loads configuration (MDMS or static fallback) for the complaint form,
 * manages session storage for preserving form data across navigation,
 * and renders the CreateComplaintForm component.
 *
 * Functionalities:
 * - Fetches dynamic form configuration from MDMS
 * - Falls back to static config if MDMS fetch is disabled or unavailable
 * - Manages form session state using Digit's useSessionStorage
 * - Renders the CreateComplaintForm with appropriate props
 */

import React, { useState, useMemo, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Loader } from "@egovernments/digit-ui-components";
import CreateComplaintForm from "./createComplaintForm";
import { CreateComplaintConfig } from "../../../configs/CreateComplaintConfig";
import { useLocation } from "react-router-dom";

const CreateComplaint = () => {
  const { t } = useTranslation();

  // Get current ULB tenant ID
  const tenantId = Digit.ULBService.getCurrentTenantId();
  // Manage form session state using sessionStorage under key "COMPLAINT_CREATE"
  const CreateComplaintSession = Digit.Hooks.useSessionStorage("COMPLAINT_CREATE", {});
  const [sessionFormData, setSessionFormData, clearSessionFormData] = CreateComplaintSession;

  // Fetch mobile validation config from MDMS
  const { validationRules, isLoading: isValidationLoading, getMinMaxValues } = Digit.Hooks.pgr.useMobileValidation(tenantId);

  // Fetch MDMS config for Create Complaint screen (RAINMAKER-PGR.CreateComplaintConfig)
  const { data: mdmsData, isLoading } = Digit.Hooks.useCommonMDMS(
    Digit.ULBService.getStateId(),
    "RAINMAKER-PGR",
    ["CreateComplaintConfig"],
    {
      select: (data) => data?.["RAINMAKER-PGR"]?.CreateComplaintConfig?.[0],
      retry: false,
      enable: false, // Disabled fetch by default – relies on fallback config
    }
  );

     // Fetch the list of service definitions (e.g., complaint types) for current tenant
    //  const serviceDefs = Digit.Hooks.pgr.useServiceDefs(tenantId, "PGR");

  // Use MDMS config if available, otherwise fallback to local static config
  let configs = mdmsData || CreateComplaintConfig?.CreateComplaintConfig?.[0];
  
   /**
    * Preprocess config using translation and inject complaint types into the serviceCode dropdown
    * and inject mobile validation from MDMS
    */

  // Inject mobile validation rules from MDMS into the config
  if (configs && validationRules) {
    const { min, max } = getMinMaxValues();
    configs = {
      ...configs,
      form: configs.form.map((section) => {
        if (section.head === "ES_CREATECOMPLAINT_PROVIDE_COMPLAINANT_DETAILS") {
          return {
            ...section,
            body: section.body.map((field) => {
              if (field.label === "COMPLAINTS_COMPLAINANT_CONTACT_NUMBER") {
                return {
                  ...field,
                  populators: {
                    ...field.populators,
                    componentInFront: validationRules.prefix,
                    validation: {
                      required: true,
                      minlength: validationRules.minLength,
                      maxlength: validationRules.maxLength,
                      min: min,
                      max: max,
                      pattern: validationRules.pattern,
                    },
                    error: validationRules.errorMessage || "CORE_COMMON_MOBILE_ERROR",
                  },
                };
              }
              return field;
            }),
          };
        }
        return section;
      }),
    };
  }


  // Show loader while fetching MDMS config
  if (isLoading || isValidationLoading || !configs) {
    return <Loader />;
  }

  return (
    <React.Fragment>
      <CreateComplaintForm
        t={t}
        createComplaintConfig={configs}
        sessionFormData={sessionFormData}
        setSessionFormData={setSessionFormData}
        clearSessionFormData={clearSessionFormData}
        tenantId={tenantId}
        preProcessData={{}} // Reserved for any future data transformation
      />
    </React.Fragment>
  );
};

export default CreateComplaint;
