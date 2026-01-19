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
import React, { useEffect, useState, useMemo } from "react";
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
  const [selectedCity, setSelectedCity] = useState(null);
  const [localitiesOptions, setLocalitiesOptions] = useState([]);
  const hierarchyType = window?.globalConfigs?.getConfig("HIERARCHY_TYPE") || "ADMIN";
  const boundaryType = window?.globalConfigs?.getConfig("BOUNDARY_TYPE") || "Locality";



  const user = Digit.UserService.getUser();

  const allCities = Digit.Hooks.pgr.useTenants();

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




  // Step 1: move this out of useMemo
  useEffect(() => {
    const fetchBoundaryData = async () => {
      try {
        const response = await Digit.CustomService.getResponse({
          url: `/boundary-service/boundary-relationships/_search`,
          useCache: false,
          method: "POST",
          userService: false,
          params: {
            tenantId: selectedCity,
            hierarchyType,
            boundaryType,
            includeChildren: true,
          }
        });

        setLocalitiesOptions(response?.TenantBoundary?.[0]?.boundary || []);
      } catch (error) {
        console.error("Error fetching boundary data:", error);
        setLocalitiesOptions([]); // Fallback
      }
    };

    if (selectedCity) fetchBoundaryData();
  }, [selectedCity]); // ← this only runs when selectedCity changes

  // Use Custom MDMS hook for fetching Hierarchy Schema
  const { isLoading: isHierarchyLoading, data: hierarchyData } = Digit.Hooks.useCustomMDMS(
    tenantId,
    "CMS-BOUNDARY",
    [{ name: "HierarchySchema" }],
    {
      select: (data) => data?.["CMS-BOUNDARY"]?.HierarchySchema?.[0],
      retry: false,
      enable: true,
    }
  );

  useEffect(() => {
    if (hierarchyData) {
      console.log("MDMS Response:", hierarchyData);
    }
  }, [hierarchyData]);

  const processLocalities = (boundaryList = []) => {
    if (!Array.isArray(boundaryList)) return [];

    return boundaryList.map(item => ({
      ...item,                    // Preserve all original fields
      name: item.code,            // Add name as code
      i18nKey: item.code          // Add i18nKey as code
    }));
  };

  useEffect(() => {
    const fetchBoundaryData = async () => {
      try {
        const response = await Digit.CustomService.getResponse({
          url: `/boundary-service/boundary-relationships/_search`,
          useCache: false,
          method: "POST",
          userService: false,
          params: {
            tenantId: selectedCity,
            hierarchyType: hierarchyType,
            boundaryType: boundaryType,
            includeChildren: true,
          }
        });
        // Add a small delay before setting the state
        setTimeout(() => {
          const formatedData = processLocalities(response.TenantBoundary[0].boundary);
          setLocalitiesOptions(formatedData);
        }, 300); // 300ms delay
      } catch (error) {
        console.error("Error fetching boundary data:", error);
      }
    };

    if (selectedCity) fetchBoundaryData();
  }, [selectedCity]); // ✅ this is correct


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
            key: "SelectCity",
            value: [allCities ? allCities : []],
          },
          {
            key: "SelectLocality",
            value: [localitiesOptions ? localitiesOptions : []],
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
          if (field.key === "boundaryComponent" && hierarchyData?.moduleName === "CMS") {
            return {
              ...field,
              populators: {
                ...field.populators,
                levelConfig: {
                  ...field.populators.levelConfig,
                  lowestLevel: hierarchyData.lowestHierarchy || window?.globalConfigs?.getConfig("PGR_BOUNDARY_LOWEST_LEVEL") || "Ward",
                  highestLevel: hierarchyData.highestHierarchy || window?.globalConfigs?.getConfig("PGR_BOUNDARY_HIGHEST_LEVEL") || "City",
                },
                hierarchyType: hierarchyData.hierarchy || window?.globalConfigs?.getConfig("HIERARCHY_TYPE") || "ADMIN",
              },
            };
          }
          return field;
        }),
      };
    });

    return { ...baseConfig, form: updatedForm };
  }, [createComplaintConfig, serviceDefs, t, disabledFields, subType, selectedCity, localitiesOptions, hierarchyData]);









  const prevSubTypeRef = React.useRef([]);
  const prevCityRef = React.useRef(null);

  const onFormValueChange = (setValue, formData, formState, reset, setError, clearErrors) => {

    const selectedComplaintType = formData?.SelectComplaintType;
    const newSubTypes = getSubTypesByDepartment(selectedComplaintType, serviceDefs);
    // const newCity = formData.SelectCity?.code;

    // Compare previous and new subtype list
    const prevCodes = prevSubTypeRef.current.map(s => s.code).sort().join(",");
    const newCodes = newSubTypes.map(s => s.code).sort().join(",");

    if (prevCodes !== newCodes) {
      prevSubTypeRef.current = newSubTypes;
      setSubType(newSubTypes);
    }



    // --- New logic for localities ---
    const newCityCode = formData.SelectCity?.code;
    if (newCityCode && prevCityRef.current !== newCityCode) {
      prevCityRef.current = newCityCode;

      setSelectedCity(newCityCode);

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




  const onFormSubmit = (_data) => {
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
          sendDataToResponsePage(
            "CS_COMMON_COMPLAINT_SUBMITTED",
            "CS_COMMON_TRACK_COMPLAINT_TEXT",
            "CS_PGR_COMPLAINT_NUMBER",
            responseData?.ServiceWrappers?.[0]?.service?.serviceRequestId
          );
          clearSessionFormData();
        }
        clearSessionFormData();
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
        isDisabled={false}
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
