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
import MobileNumberWithPrefix from "../../../components/MobileNumberWithPrefix";

const CreateComplaint = () => {
  const { t } = useTranslation();

  // Scroll-to-top guard for this screen.
  // On short laptop viewports the page nudges down ~50–100px when the form mounts.
  // Cause: a component inside @egovernments/digit-ui-components (a Dropdown /
  // stepper / option list) calls `element.scrollIntoView({ block: "center" })`
  // on mount when its element is outside the viewport. On a tall form that
  // element sits below the fold, so the call scrolls the page downward.
  // Earlier attempts with multiple `window.scrollTo(0, 0)` couldn't compete
  // with a smooth scrollIntoView() that fires after our re-pin timeout.
  //
  // Fix: neutralize Element.prototype.scrollIntoView for the first ~800ms
  // after mount so the offending library call becomes a no-op. Also pin
  // scroll position to the top on first paint. User-initiated focus and
  // scrollIntoView still work normally after that window — and it's restored
  // on unmount so we don't affect other screens.
  useEffect(() => {
    const prevRestoration = window.history?.scrollRestoration;
    if ("scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual";
    }
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function () {};
    window.scrollTo(0, 0);
    const raf = requestAnimationFrame(() => window.scrollTo(0, 0));
    const restoreTimer = setTimeout(() => {
      Element.prototype.scrollIntoView = originalScrollIntoView;
    }, 800);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(restoreTimer);
      Element.prototype.scrollIntoView = originalScrollIntoView;
      if ("scrollRestoration" in window.history && prevRestoration) {
        window.history.scrollRestoration = prevRestoration;
      }
    };
  }, []);

  // Get current ULB tenant ID
  const tenantId = Digit.ULBService.getCurrentTenantId();
  // Manage form session state using sessionStorage under key "COMPLAINT_CREATE"
  const CreateComplaintSession = Digit.Hooks.useSessionStorage("COMPLAINT_CREATE", {});
  const [sessionFormData, setSessionFormData, clearSessionFormData] = CreateComplaintSession;

  // Mobile validation loading check
  const { isLoading: isValidationLoading } = Digit.Hooks.pgr.useMobileValidation(tenantId);

  // Fetch MDMS config for Create Complaint screen (RAINMAKER-PGR.CreateComplaintConfig)
  const { data: mdmsData, isLoading } = Digit.Hooks.useCommonMDMS(
    Digit.ULBService.getStateId(),
    "RAINMAKER-PGR",
    ["CreateComplaintConfig"],
    {
      select: (data) => data?.["RAINMAKER-PGR"]?.CreateComplaintConfig?.[0],
      retry: false,
      enable: true,
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

  // Replace mobile number field with MobileNumberWithPrefix component
  if (configs) {
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
                  type: "component",
                  component: MobileNumberWithPrefix,
                  key: field.populators?.name || "ComplainantContactNumber",
                  populators: {
                    ...field.populators,
                    validation: { required: true },
                    error: "",
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
