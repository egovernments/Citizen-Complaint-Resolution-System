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

  // Logged-in employee's department — needed to gate the Sub-Type dropdown
  // so an employee can only file sub-types of their own department. The user
  // token doesn't carry the department, so look it up from HRMS by the
  // current user's uuid (same source AssigneeComponent uses).
  const hrmsContext = window?.globalConfigs?.getConfig?.("HRMS_CONTEXT_PATH") || "egov-hrms";
  const { data: currentEmployeeData } = Digit.Hooks.useCustomAPIHook({
    url: `/${hrmsContext}/employees/_search`,
    params: { tenantId, uuids: user?.info?.uuid },
    config: { enabled: !!user?.info?.uuid },
  });
  // All departments the logged-in employee is actively assigned to. A user
  // can hold multiple assignments (e.g. a department head / high-level user),
  // so collect every active assignment's department — not just the first.
  // This drives the department gating for the Type + Sub-Type dropdowns, with
  // no dependency on role names (which can be customised/renamed).
  const loggedInUserDepartments = useMemo(() => {
    const employees = currentEmployeeData?.Employees || [];
    const set = new Set();
    employees.forEach((e) =>
      (e?.assignments || [])
        .filter((a) => a?.isCurrentAssignment !== false && a?.department)
        .forEach((a) => set.add(a.department))
    );
    return [...set];
  }, [currentEmployeeData]);

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
    // Dedupe by menuPath + department (not menuPath alone). The same menuPath
    // can exist under more than one department; for a multi-department user
    // both must stay selectable, so keep one Type option per
    // (menuPath, department). For single-department users this collapses to
    // the same result as menuPath-only dedupe.
    const seen = new Set();
    const uniqueItems = [];
    for (const item of data || []) {
      const key = `${item.menuPath}__${item.department}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueItems.push(item);
      }
    }

    // Disambiguate only when the SAME menuPath spans multiple departments in
    // the (already department-scoped) option set — otherwise a multi-dept user
    // would see identical labels. Single-department users never trip this, so
    // their labels stay plain.
    const deptCountByMenuPath = uniqueItems.reduce((acc, it) => {
      acc[it.menuPath] = (acc[it.menuPath] || 0) + 1;
      return acc;
    }, {});

    return uniqueItems.map((it) =>
      deptCountByMenuPath[it.menuPath] > 1
        ? { ...it, menuPathName: `${it.menuPathName} - ${t(`DEPARTMENT_${it.department}`)}` }
        : it
    );
  }

  function getSubTypesByDepartment(baseItem, allItems) {

    if (!baseItem || !baseItem.department || !Array.isArray(allItems)) {
      console.warn("Invalid baseItem or allItems");
      return [];
    }

    // Strict gate by the logged-in employee's department(s): only show
    // sub-types when the user is assigned to the selected Type's department.
    // Supports multiple departments. If the user isn't assigned to it (or the
    // assignment hasn't loaded), show nothing — never forward a department the
    // user isn't assigned to.
    if (!loggedInUserDepartments.includes(baseItem.department)) {
      return [];
    }

    // Sub-types = services under the SELECTED Type — match both menuPath and
    // department, not department alone (department-only would leak services
    // from other menuPaths in the same department into this Type's sub-list).
    return allItems.filter(
      (item) =>
        item.department === baseItem.department &&
        item.menuPath === baseItem.menuPath
    );
  }




  // Boundary cascade is now driven by <PGRBoundaryComponent>, which
  // reads the tree via `usePGRInitialization` at module mount and
  // renders the full County → Sub-County → Ward chain on its own.
  // Previously this file kept two duplicate `boundary-relationships`
  // fetches tied to a hardcoded City + Locality pair (closes
  // egovernments/CCRS#438 + #447 items 6-7).


  const updatedConfig = useMemo(() => {

    // Scope the Complaint Type options strictly to the logged-in employee's
    // assigned department(s) — a user only sees Types they can act on (e.g. an
    // "ambiental" user doesn't see the "Water"/DEPT_36 Type). If the user has
    // no assignment (or it hasn't loaded yet), the list is empty: we never
    // forward Types for a department the user isn't assigned to.
    const departmentScopedDefs = (serviceDefs || []).filter((d) =>
      loggedInUserDepartments.includes(d.department)
    );

    const baseConfig = Digit.Utils.preProcessMDMSConfig(
      t,
      createComplaintConfig,
      {
        updateDependent: [
          {
            key: "SelectComplaintType",
            value: [getUniqueMenuPaths(departmentScopedDefs) ? getUniqueMenuPaths(departmentScopedDefs) : []],
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
  }, [createComplaintConfig, serviceDefs, t, disabledFields, subType, loggedInUserDepartments]);









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
    // PGRBoundaryComponent now tags the picked node with `isLeaf`
    // (true only when boundaryType matches the deepest hierarchy
    // level). Trust the tag when present — the children-based check
    // wasn't reliable because BoundaryDropdown.data.find() didn't
    // preserve `.children` on the picked node, so County-level picks
    // were silently passing as leaves (egovernments/CCRS#478). Fall
    // back to the children heuristic for older session-cached values.
    if (typeof boundary.isLeaf === "boolean") return boundary.isLeaf === true;
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
    // Postal pattern check — Kenya is 5 digits. Optional field; only
    // enforce format when filled. The config-level `validation.pattern`
    // on a `type:"number"` field doesn't reliably fire, so do it
    // explicitly here. Closes egovernments/CCRS#478 — postal validation
    // message, CSR path.
    if (_data?.postalCode != null && String(_data.postalCode).trim().length > 0) {
      const pc = String(_data.postalCode).trim();
      // Postal-code shape is per-country. Read from globalConfigs
      // `CORE_POSTAL_CONFIGS` so each tenant can pin their own pattern
      // (Kenya 5 digits, India 6, UK alnum, US 5/5+4, …). Falls back to
      // the legacy hard default when the host hasn't configured it.
      const postalCfg = window?.globalConfigs?.getConfig?.("CORE_POSTAL_CONFIGS") || {};
      const postalPattern = postalCfg.postalCodePattern || "^[0-9]{5}$";
      const postalErrorKey = postalCfg.postalCodeErrorMessage || "CS_COMPLAINT_POSTALCODE_INVALID_ERROR";
      if (!new RegExp(postalPattern).test(pc)) {
        setToast({
          show: true,
          label: t(postalErrorKey),
          type: "error",
        });
        return;
      }
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
