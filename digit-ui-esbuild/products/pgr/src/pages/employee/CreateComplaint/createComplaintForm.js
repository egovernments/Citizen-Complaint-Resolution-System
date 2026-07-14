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

  // Does this tenant have a configurable complaint hierarchy (with nodes)?
  // If so, the flat Type/Sub-Type dropdowns are replaced by the cascading
  // PGRComplaintHierarchyComponent; otherwise the legacy flat flow runs as-is.
  const { data: hasHierarchy } = Digit.Hooks.useCustomMDMS(
    tenantId,
    "RAINMAKER-PGR",
    [{ name: "ComplaintHierarchyDefinition" }, { name: "ComplaintHierarchy" }],
    {
      cacheTime: Infinity,
      select: (raw) => {
        const defs = (raw?.["RAINMAKER-PGR"]?.ComplaintHierarchyDefinition || []).filter(
          (d) => d?.active !== false
        );
        const rows = raw?.["RAINMAKER-PGR"]?.ComplaintHierarchy || [];
        return defs.some((d) => rows.some((n) => n?.hierarchyType === d?.hierarchyType));
      },
    },
    { schemaCode: "PGR_HIER_PRESENT" }
  );

  // CCSD-1990: complainant-name pattern from the shared validation master
  // (common-masters.MobileNumberValidation.nameRegex) — same channel the
  // mobile pattern rides elsewhere. The static pattern in
  // CreateComplaintConfig stays as the FALLBACK when the master doesn't
  // carry the field (all pre-existing environments).
  const { data: nameRegexFromMdms } = Digit.Hooks.useCustomMDMS(
    tenantId,
    "common-masters",
    [{ name: "MobileNumberValidation" }],
    {
      cacheTime: Infinity,
      select: (raw) => {
        const list = raw?.["common-masters"]?.MobileNumberValidation || [];
        const record =
          list.find((x) => x.default === true && x.isActive !== false) ||
          list.find((x) => x.isActive !== false) ||
          null;
        return record?.nameRegex;
      },
    },
    { schemaCode: "MOBILE_VALIDATION_NAME_REGEX" }
  );

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

  // Admin-style roles aren't tied to a single department, so they should always
  // see the full Type/Sub-Type list rather than be scoped to one (or none).
  const PRIVILEGED_ROLES = ["SUPERUSER", "PGR_ADMIN", "PGR-ADMIN"];
  const isPrivileged = (user?.info?.roles || []).some((r) => PRIVILEGED_ROLES.includes(r?.code));

  // Department gating is a *refinement*, never a hard block: only scope the
  // Type/Sub-Type dropdowns to the employee's department(s) when doing so still
  // leaves something to pick. If the user has no department, a privileged role,
  // or a department that matches no ServiceDef (HRMS dept codes can diverge from
  // the ServiceDefs `department`), gating is disabled and every type is shown —
  // otherwise the dropdowns went blank even though MDMS has the data (issue #810).
  const departmentGate = useMemo(() => {
    const scoped = (serviceDefs || []).filter((d) => loggedInUserDepartments.includes(d.department));
    const enabled = !isPrivileged && loggedInUserDepartments.length > 0 && scoped.length > 0;
    return { enabled, scoped };
  }, [serviceDefs, loggedInUserDepartments, isPrivileged]);

  useEffect(() => {
    if (toast?.show) {
      const timer = setTimeout(() => {
        setToast({ show: false, label: "", type: "" });
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [toast?.show]);

  // Validate phone number based on config (length + regex pattern)
  const validatePhoneNumber = (value, config) => {
    const { minLength, maxLength, pattern } = config?.populators?.validation || {};
    const stringValue = String(value || "");

    if (minLength && stringValue.length < minLength) return false;
    if (maxLength && stringValue.length > maxLength) return false;
    if (pattern) {
      const re = pattern instanceof RegExp ? pattern : new RegExp(pattern);
      if (!re.test(stringValue)) return false;
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

    // Update disable flags dynamically; when a complaint hierarchy exists,
    // replace the flat Type dropdown with the cascading hierarchy component and
    // drop the flat Sub-Type dropdown (the component writes both fields).
    const updatedForm = baseConfig?.form?.map(section => {
      return {
        ...section,
        body: section.body.flatMap(field => {
          const fname = field.populators?.name || field.key;
          if (hasHierarchy && fname === "SelectComplaintType") {
            return [{
              ...field,
              type: "component",
              component: "PGRComplaintHierarchyComponent",
              key: "SelectComplaintType",
              isMandatory: true,
              populators: { ...field.populators, name: "SelectComplaintType" },
            }];
          }
          if (hasHierarchy && fname === "SelectSubComplaintType") {
            return []; // component handles sub-type + writes this field
          }
          if (
            field.populators?.name === "ComplainantName" ||
            field.populators?.name === "ComplainantContactNumber"
          ) {
            // Name pattern: MDMS master value wins when present + valid; the
            // config's static pattern remains the fallback.
            let mdmsPattern;
            if (field.populators?.name === "ComplainantName" && nameRegexFromMdms) {
              try {
                mdmsPattern = new RegExp(nameRegexFromMdms);
              } catch (e) {
                console.error("Invalid nameRegex in MobileNumberValidation master:", e);
              }
            }
            return [{
              ...field,
              disable: disabledFields[field.populators.name],
              ...(mdmsPattern
                ? {
                    populators: {
                      ...field.populators,
                      validation: { ...field.populators.validation, pattern: mdmsPattern },
                    },
                  }
                : {}),
            }];
          }
          return [field];
        }),
      };
    });

    return { ...baseConfig, form: updatedForm };
  }, [createComplaintConfig, serviceDefs, t, disabledFields, subType, loggedInUserDepartments, hasHierarchy, departmentGate, nameRegexFromMdms]);









  const prevSubTypeRef = React.useRef([]);
  // null = no error shown; "invalid" = error currently shown.
  // Used to guard setError/clearErrors so they only fire when the state
  // actually changes — preventing the infinite render loop that trigger() causes
  // (trigger → errors change → re-render → watch() new ref → useEffect fires → loop).
  const mobileErrorRef = useRef(null);

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

    // Real-time mobile validation: show/hide CardLabelError as the user types.
    // Uses setError/clearErrors guarded by a ref instead of trigger(), which
    // caused an infinite loop (trigger changed errors state → re-render →
    // watch() produced a new reference → useEffect fired → trigger again).
    const mobile = formData?.ComplainantContactNumber;
    const mobileField = updatedConfig?.form
      ?.flatMap(s => s.body || [])
      ?.find(f => f.populators?.name === "ComplainantContactNumber");
    const mobilePattern = mobileField?.populators?.validation?.pattern;
    if (mobile && mobilePattern) {
      const re = mobilePattern instanceof RegExp ? mobilePattern : new RegExp(String(mobilePattern));
      const isValid = re.test(mobile);
      if (!isValid && mobileErrorRef.current !== "invalid") {
        setError?.("ComplainantContactNumber", { type: "pattern", message: mobileField?.populators?.error || "CORE_COMMON_MOBILE_ERROR" });
        mobileErrorRef.current = "invalid";
      } else if (isValid && mobileErrorRef.current === "invalid") {
        clearErrors?.("ComplainantContactNumber");
        mobileErrorRef.current = null;
      }
    } else if (!mobile && mobileErrorRef.current !== null) {
      clearErrors?.("ComplainantContactNumber");
      mobileErrorRef.current = null;
    }

    // The flat Type→Sub-Type cascade only applies to the legacy dropdowns.
    // When the hierarchy component is active it owns both fields, so skip this
    // (running it would treat the leaf ServiceDef as a menuPath base and clear
    // SelectSubComplaintType).
    if (!hasHierarchy) {
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
