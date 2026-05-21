/**
 * CreateComplaintForm - Form screen for employee to submit a PGR complaint
 *
 * Purpose:
 * Renders the form for entering complaint details and submitting them.
 *
 * Functionalities:
 * - Uses FormComposerV2 to dynamically render the complaint form based on config
 * - Validates form inputs (e.g. complainant name)
 * - Handles form submission, constructs payload, and sends data to create complaint API
 * - Shows toast notifications for success or failure
 * - Navigates to complaint response screen after submission
 */

import { FormComposerV2, Toast } from "@egovernments/digit-ui-components";
import React, { useEffect, useState, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useHistory } from "react-router-dom";
import { formPayloadToCreateComplaint } from "../../../utils";

const CreateComplaintForm = ({
  createComplaintConfig,      // Form configuration for Create Complaint screen
  sessionFormData,            // Cached form data from session (used for persistence)
  setSessionFormData,         // Setter for session form data
  clearSessionFormData,       // Clears form session data
  tenantId,                   // Current tenant ID
  preProcessData              // Any preprocessing logic for form config or data
}) => {
  const { t } = useTranslation();
  const history = useHistory();

  const [toast, setToast] = useState({ show: false, label: "", type: "" }); // Toast UI state
  const [type, setType] = useState({});
  const [subType, setSubType] = useState([]);

  const user = Digit.UserService.getUser();

  // Hook for creating a complaint
  const { mutate: CreateComplaintMutation } = Digit.Hooks.pgr.useCreateComplaint(tenantId);

  // Fetch the list of service definitions (e.g., complaint types) for current tenant
  const serviceDefs = Digit.Hooks.pgr.useServiceDefs(tenantId, "PGR");



  useEffect(() => {
    if (toast?.show) {
      const timer = setTimeout(() => {
        setToast({ show: false, label: "", type: "" });
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [toast?.show]);

  // Validate phone number based on config
  const validatePhoneNumber = (value, config) => {
    const { minLength, maxLength, min, max } = config?.populators?.validation || {};
    const stringValue = String(value || "");

    if (
      (minLength && stringValue.length < minLength) ||
      (maxLength && stringValue.length > maxLength) ||
      (min && Number(value) < min) ||
      (max && Number(value) > max)
    ) {
      return false;
    }
    return true;
  };

  // Determine which fields should be disabled based on complaintUser code
  const disabledFields = useMemo(() => {
    const complaintUserCode = sessionFormData?.complaintUser?.code;
    if (complaintUserCode === "MYSELF") {
      return {
        ComplainantName: true,
        ComplainantContactNumber: true,
      };
    }
    return {
      ComplainantName: false,
      ComplainantContactNumber: false,
    };
  }, [sessionFormData?.complaintUser?.code]);


  function getUniqueMenuPaths(data) {
    const seenMenuPaths = new Set();
    const uniqueItems = [];

    for (const item of data) {
      if (!seenMenuPaths.has(item.menuPath)) {
        seenMenuPaths.add(item.menuPath);
        uniqueItems.push(item);
      }
    }

    return uniqueItems;
  }

  function getSubTypesByDepartment(baseItem, allItems) {

    if (!baseItem || !baseItem.department || !Array.isArray(allItems)) {
      console.warn("Invalid baseItem or allItems");
      return [];
    }

    return allItems.filter(item => item.department === baseItem.department);
  }




  // Boundary cascade is now driven by <PGRBoundaryComponent>, which
  // reads the tree via `usePGRInitialization` at module mount and
  // renders the full County → Sub-County → Ward chain on its own.
  // Previously this file kept two duplicate `boundary-relationships`
  // fetches tied to a hardcoded City + Locality pair (closes
  // egovernments/CCRS#438 + #447 items 6-7).


  const updatedConfig = useMemo(() => {

    const baseConfig = Digit.Utils.preProcessMDMSConfig(
      t,
      createComplaintConfig,
      {
        updateDependent: [
          {
            key: "SelectComplaintType",
            value: [getUniqueMenuPaths(serviceDefs) ? getUniqueMenuPaths(serviceDefs) : []],
          },
          {
            key: "SelectSubComplaintType",
            value: [subType ? subType : []],
          },
          {
            key: "ComplaintDate",
            value: [new Date().toISOString().split("T")[0]],
          },
        ],
      }
    );

    // Update disable flags dynamically
    const updatedForm = baseConfig?.form?.map(section => {
      return {
        ...section,
        body: section.body.map(field => {
          if (
            field.populators?.name === "ComplainantName" ||
            field.populators?.name === "ComplainantContactNumber"
          ) {
            return {
              ...field,
              disable: disabledFields[field.populators.name],
            };
          }
          return field;
        }),
      };
    });

    return { ...baseConfig, form: updatedForm };
  }, [createComplaintConfig, serviceDefs, t, disabledFields, subType]);









  const prevSubTypeRef = React.useRef([]);

  // Track whether every isMandatory field in the live config has a
  // non-empty value, so we can gate the SUBMIT button. FormComposerV2
  // doesn't auto-disable submit on its own — earlier the button was
  // active even on a completely blank form.
  const [submitDisabled, setSubmitDisabled] = useState(true);
  const requiredFieldKeys = useMemo(() => {
    const keys = [];
    (updatedConfig?.form ?? []).forEach((section) => {
      (section?.body ?? []).forEach((field) => {
        if (field?.isMandatory && field?.populators?.name) {
          keys.push(field.populators.name);
        }
      });
    });
    return keys;
  }, [updatedConfig]);

  const recomputeSubmitDisabled = (formData) => {
    const allFilled = requiredFieldKeys.every((k) => {
      const v = formData?.[k];
      if (v === undefined || v === null) return false;
      if (typeof v === "string") return v.trim().length > 0;
      if (typeof v === "object") {
        // Selects emit `{ code, name, ... }`; treat empty object as unset.
        return Object.keys(v).length > 0;
      }
      return !!v;
    });
    setSubmitDisabled(!allFilled);
  };

  const onFormValueChange = (setValue, formData, formState, reset, setError, clearErrors) => {
    // Capture the react-hook-form reset() handle so onSuccess can blank
    // the form after submit. FormComposerV2 doesn't expose reset via
    // props, but it does pass it through onFormValueChange on every
    // keystroke, so stashing it here is safe.
    if (reset && formResetRef.current !== reset) {
      formResetRef.current = reset;
    }
    recomputeSubmitDisabled(formData);

    const selectedComplaintType = formData?.SelectComplaintType;
    const newSubTypes = getSubTypesByDepartment(selectedComplaintType, serviceDefs);

    // Compare previous and new subtype list
    const prevCodes = prevSubTypeRef.current.map(s => s.code).sort().join(",");
    const newCodes = newSubTypes.map(s => s.code).sort().join(",");

    if (prevCodes !== newCodes) {
      prevSubTypeRef.current = newSubTypes;
      setSubType(newSubTypes);
      // Mirror citizen FormExplorer fix (CCRS#437): reset the subtype
      // immediately so the prior selection cannot leak into the next
      // render under a different ComplaintType. Pass `undefined` so the
      // Dropdown falls back cleanly to its empty state.
      setValue("SelectSubComplaintType", undefined, { shouldDirty: true, shouldTouch: true, shouldValidate: false });
    }

    const selectedUser = formData?.complaintUser?.code;
    const prevSelectedUser = sessionFormData?.complaintUser?.code;



    // Only update if complaint user selection has changed
    if (selectedUser !== prevSelectedUser) {
      const updatedData = { ...formData };

      if (selectedUser === "MYSELF") {
        updatedData.ComplainantName = user?.info?.name || "";
        updatedData.ComplainantContactNumber = user?.info?.mobileNumber || "";
      } else if (selectedUser === "ANOTHER_USER") {
        updatedData.ComplainantName = "";
        updatedData.ComplainantContactNumber = "";
      }

      setValue("ComplainantName", updatedData.ComplainantName);
      setValue("ComplainantContactNumber", updatedData.ComplainantContactNumber);
      setSessionFormData(updatedData);
    }
  };


  const handleToastClose = () => {
    setToast({ show: false, label: "", type: "" });
  };

  /**
   * Handles form submission event
   */




  // The boundary cascade emits whichever level the operator stopped at
  // (County, Sub-County, or Ward). A complaint can only be routed if the
  // selection is a leaf — i.e. has no children — otherwise PGR has no
  // ward to assign against. Block the submit early with a clear toast
  // (closes egovernments/CCRS#478 — locality validation).
  const isBoundaryLeaf = (boundary) => {
    if (!boundary) return false;
    return !Array.isArray(boundary.children) || boundary.children.length === 0;
  };

  // Reset the FormComposerV2 form state after a successful submit so the
  // next complaint starts blank. clearSessionFormData() empties the
  // sessionStorage cache; resetForm() clears react-hook-form's in-memory
  // values (also closes egovernments/CCRS#478 — form-clear-on-success).
  const formResetRef = useRef(null);

  const onFormSubmit = (_data) => {
    if (!isBoundaryLeaf(_data?.SelectedBoundary)) {
      setToast({
        show: true,
        label: t("CS_COMPLAINT_BOUNDARY_LEAF_REQUIRED"),
        type: "error",
      });
      return;
    }
    const payload = formPayloadToCreateComplaint(_data, tenantId, user?.info);
    handleResponseForCreateComplaint(payload);
  };

  /**
   * Makes API call to create complaint and handles response
   */
  const handleResponseForCreateComplaint = async (payload) => {

    await CreateComplaintMutation(payload, {
      onError: async () => {
        setToast({ show: true, label: t("FAILED_TO_CREATE_COMPLAINT"), type: "error" });
      },
      onSuccess: async (responseData) => {
        if (responseData?.ResponseInfo?.Errors) {
          setToast({ show: true, label: t("FAILED_TO_CREATE_COMPLAINT"), type: "error" });
        } else {
          // Clear both the sessionStorage cache and the in-memory form
          // state before navigating, so that if the operator hits Back
          // (or the route is remounted) the form is empty rather than
          // restored to the just-submitted complaint's values.
          clearSessionFormData();
          if (typeof formResetRef.current === "function") {
            try { formResetRef.current({}); } catch (_) { /* noop */ }
          }
          sendDataToResponsePage(
            "CS_COMMON_COMPLAINT_SUBMITTED",
            "CS_COMMON_TRACK_COMPLAINT_TEXT",
            "CS_PGR_COMPLAINT_NUMBER",
            responseData?.ServiceWrappers?.[0]?.service?.serviceRequestId
          );
        }
      },
    });
  };

  /**
   * Navigates user to response page with status of complaint submission
   */
  const sendDataToResponsePage = (message, description, info, responseId) => {
    history.push({
      pathname: `/${window?.contextPath}/employee/pgr/complaint-success`, // Redirect path
      state: {
        message,
        description,
        info,
        responseId,
      }
    });
  };



  return (
    <React.Fragment>
      <FormComposerV2
        onSubmit={onFormSubmit}
        defaultValues={sessionFormData}
        heading={t("")}
        config={updatedConfig?.form}
        className="custom-form"
        onFormValueChange={onFormValueChange}
        isDisabled={submitDisabled}
        label={t("CS_COMMON_SUBMIT")}
      />

      {/* Toast Notification for success/failure messages */}
      {toast?.show && (
        <Toast
          type={toast?.type}
          label={toast?.label}
          isDleteBtn={true}
          onClose={handleToastClose}
        />
      )}
    </React.Fragment>
  );
};

export default CreateComplaintForm;
