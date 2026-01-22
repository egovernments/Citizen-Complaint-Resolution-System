

import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, Header, Toast, FormComposerV2 } from "@egovernments/digit-ui-components";
import { useDispatch } from "react-redux";
import { createComplaint as citizenCreateComplaints } from "../../../redux/actions/index";

import { complaintsUploadimages } from "./steps-config/complaintsUploadimages";
import { createComplaint } from "../../citizen/Create/steps-config/CreateComplients";
import { complaintsLocation } from "../../citizen/Create/steps-config/ComplaintsLocation";
import { pinComplaintLocaton } from "../../citizen/Create/steps-config/pinComplaintLocaton";
import { additionalDetails } from "../../citizen/Create/steps-config/additionalDetails";
import { locationDetails } from "../../citizen/Create/steps-config/locationDetails";
import { useQueryClient } from "react-query";
import { useHistory, useRouteMatch, useParams } from "react-router-dom";

const configs = [
  createComplaint,
  pinComplaintLocaton,
  locationDetails,
  complaintsLocation,
  additionalDetails,
  complaintsUploadimages

];

const FormExplorer = () => {
  const [currentStep, setCurrentStep] = useState(0);
  const [formData, setFormData] = useState({});
  const [toast, setToast] = useState(null);
  const { t } = useTranslation();
  const { data: storeData, isLoading } = Digit.Hooks.useStore.getInitData();
  const { stateInfo } = storeData || {};
  const isLast = currentStep === configs.length - 1;
  const history = useHistory();
  const client = useQueryClient();
  const match = useRouteMatch();
  const dispatch = useDispatch();
  const tenantId = Digit.SessionStorage.get("CITIZEN.COMMON.HOME.CITY")?.code || Digit.ULBService.getCurrentTenantId()


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

  if (!isHierarchyLoading && hierarchyData) {
    const boundaryField = configs.find((config) => config.body.some((t) => t.key === "SelectAddress"));
    if (boundaryField) {
      const field = boundaryField.body.find((t) => t.key === "SelectAddress");
      if (field && field.populators && field.populators.levelConfig) {
        field.populators.levelConfig.lowestLevel = hierarchyData.lowestHierarchy || window?.globalConfigs?.getConfig("PGR_BOUNDARY_LOWEST_LEVEL") || "Ward";
        field.populators.levelConfig.highestLevel = hierarchyData.highestHierarchy || window?.globalConfigs?.getConfig("PGR_BOUNDARY_HIGHEST_LEVEL") || "City";
        field.populators.levelConfig.isSingleSelect = [
          hierarchyData.lowestHierarchy || window?.globalConfigs?.getConfig("PGR_BOUNDARY_LOWEST_LEVEL") || "Ward",
          hierarchyData.highestHierarchy || window?.globalConfigs?.getConfig("PGR_BOUNDARY_HIGHEST_LEVEL") || "City",
        ];
      }
    }
  }

  const { isLoading: isMDMSLoading, data: serviceDefs } = Digit.Hooks.useCustomMDMS(
    tenantId,
    "RAINMAKER-PGR",
    [{ name: "ServiceDefs" }],
    {
      cacheTime: Infinity,
      select: (data) => data?.["RAINMAKER-PGR"]?.ServiceDefs,
    },
    { schemaCode: "SERVICE_DEFS_MASTER_DATA" }
  );



  if (!isMDMSLoading && Array.isArray(serviceDefs)) {
    // Filter unique menuPath types
    const seen = new Set();
    const uniqueComplaintTypes = serviceDefs.filter(item => {
      const key = item.menuPath;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).map(item => ({ ...item, i18nKey: "SERVICEDEFS." + item.menuPath.toUpperCase().replace(/[ -]/g, "_") }));

    const complaintTypeField = configs[0].body.find(field => field.key === "SelectComplaintType");

    if (complaintTypeField && complaintTypeField.populators) {
      complaintTypeField.populators.options = uniqueComplaintTypes;
    }
  }



  function validateString(value) {
    return typeof value === "string" && value.trim().length > 0 ? value : "";
  }

  function validateGeoLocation(value) {
    if (
      value &&
      typeof value === "object" &&
      typeof value.latitude === "number" &&
      typeof value.longitude === "number"
    ) {
      return {
        latitude: value.latitude,
        longitude: value.longitude
      };
    }
    return {};
  }

  const getEffectiveServiceCode = (mainType, subType) => {
    if (
      subType &&
      subType.department === mainType.department &&
      subType.menuPath === mainType.menuPath &&
      subType.serviceCode !== mainType.serviceCode
    ) {
      return subType.serviceCode;
    }

    return mainType.serviceCode;
  };
  function mapFormDataToRequest(formData, tenantId, user, stateInfo) {
    const timestamp = Date.now();

    const extractBoundaryCode = (data) => {
      const candidates = [
        data?.SelectAddress?.code,
        data?.SelectAddress?.locality?.code,
        data?.boundaryComponent?.code,
        Array.isArray(data?.boundaryComponent) ? data?.boundaryComponent[data.boundaryComponent.length - 1] : null,
        // Checks if the value itself is a string code
        typeof data?.SelectAddress === 'string' ? data?.SelectAddress : null,
        typeof data?.boundaryComponent === 'string' ? data?.boundaryComponent : null,
        data?.SelectedBoundary?.code
      ];
      const found = candidates.find(c => c && typeof c === 'string');
      return found || "";
    };

    const userInfo = formData?.complaintUser?.code === "ANOTHER_USER"
      ? {
        name: formData?.ComplainantName?.trim() || null,
        mobileNumber: formData?.ComplainantContactNumber?.trim() || null,
        userName: formData?.ComplainantContactNumber?.trim() || null,
        type: "EMPLOYEE",
        tenantId,
      }
      : user;

    const additionalDetail = {
      supervisorName: formData?.SupervisorName?.trim() || null,
      supervisorContactNumber: formData?.SupervisorContactNumber?.trim() || null,
    };

    const geoLocation = formData?.GeoLocationsPoint || { lat: null, lng: null };

    return {
      service: {
        active: true,
        tenantId: formData?.SelectAddress?.city?.code || tenantId,
        serviceCode: getEffectiveServiceCode(formData?.SelectComplaintType, formData?.SelectSubComplaintType),
        description: formData?.description || "",
        applicationStatus: "CREATED",
        source: "web",
        citizen: userInfo,
        isDeleted: false,
        rowVersion: 1,
        address: {
          landmark: validateString(formData?.landmark),
          buildingName: validateString(formData?.AddressOne),
          street: validateString(formData?.AddressTwo),
          pincode: validateString(formData?.postalCode),
          locality: {
            code: extractBoundaryCode(formData),
          },
          geoLocation: validateGeoLocation({
            latitude: geoLocation.lat,
            longitude: geoLocation.lng,
          }),
        },
        additionalDetail: JSON.stringify(additionalDetail),
        auditDetails: {
          createdBy: user?.uuid,
          createdTime: timestamp,
          lastModifiedBy: user?.uuid,
          lastModifiedTime: timestamp,
        },
      },
      workflow: {
        action: "APPLY",
        verificationDocuments: Array.isArray(formData?.ComplaintImagesPoint)
          ? formData.ComplaintImagesPoint.map((image) => ({
            documentType: "PHOTO",
            fileStoreId: image,
            documentUid: "",
            additionalDetails: {},
          }))
          : [],
      },
    };
  };


  const { mutate: CreateComplaintMutation } = Digit.Hooks.pgr.useCreateComplaint(tenantId);


  const handleResponseForCreateComplaint = async (payload) => {

    await CreateComplaintMutation(payload, {
      onError: async (error, variables) => {
        dispatch({
          type: "CREATE_COMPLAINT",
          payload: { responseInfo: { status: "failed" } },
        });
        history.push(`/digit-ui/citizen/pgr/response`);
      },
      onSuccess: async (responseData) => {
        dispatch({
          type: "CREATE_COMPLAINT",
          payload: responseData,
        });
        if (responseData && responseData.responseInfo.status === "successful") {
          const id = responseData.ServiceWrappers[0].service.serviceRequestId;

          await client.refetchQueries(["complaintsList"]);
          history.push(`/digit-ui/citizen/pgr/response`);

        } else {
          history.push(`/digit-ui/citizen/pgr/response`);
        }
      },
    });
  };




  //## validation
  const mandatoryFieldsByStep = [
    // Step 0 — createComplaint config
    [],
    [],
    [],
    // Step 1 — pinComplaintLocaton config
    ["SelectAddress"],
    ["description"],
    // Step 5 — complaintsUploadimages config
    [],
  ];


  const isFieldValid = (data, fieldKey) => {
    switch (fieldKey) {
      case "ComplaintImagesPoint":
        return Array.isArray(data?.ComplaintImagesPoint) && data.ComplaintImagesPoint.length > 0;
      case "SelectAddress":
        return (data?.SelectAddress && Object.keys(data.SelectAddress).length > 0) ||
          (Array.isArray(data?.boundaryComponent) && data.boundaryComponent.length > 0);
      case "description":
        return typeof data?.description === "string" && data.description.trim().length > 0;
      case "SelectComplaintType":
        return data?.SelectComplaintType != null;
      case "GeoLocationsPoint":
        return data?.GeoLocationsPoint?.lat != null && data?.GeoLocationsPoint?.lng != null;
      default:
        return data[fieldKey] != null;
    }
  };

  const onSubmit = async (data) => {
    const merged = { ...formData, ...data };

    // Get fields mandatory for current step
    const mandatoryFields = mandatoryFieldsByStep[currentStep] || [];

    // Find which mandatory fields are missing or invalid
    const missingFields = mandatoryFields.filter(field => !isFieldValid(merged, field));

    if (missingFields.length > 0) {
      const fieldLabelMap = {
        "SelectAddress": "CS_ADDCOMPLAINT_COMPLAINT_LOCATION",
        "description": "CS_COMPLAINT_DETAILS_COMPLAINT_DESCRIPTION"
      };
      const missingLabels = missingFields.map(f => t(fieldLabelMap[f] || f));
      setToast({ label: `${t("CORE_COMMON_REQUIRED_ERRMSG")}: ${missingLabels.join(", ")}`, type: "error" });
      return; // block next step or submit
    }

    setFormData(merged);

    const user = Digit.UserService.getUser();

    if (isLast) {
      const payload = mapFormDataToRequest(merged, tenantId, user, stateInfo);
      handleResponseForCreateComplaint(payload);
    } else {
      setCurrentStep((s) => s + 1);
    }
  };


  const previousMenuPathRef = React.useRef(null);

  const onFormValueChange = (setValue, formData, formState, reset, setError, clearErrors, trigger, getValues) => {

    console.log(`*** LOG formData***`, formData);

    const complaintType = formData?.SelectComplaintType;
    const currentMenuPath = complaintType?.menuPath;

    // Skip if menuPath didn't change
    if (!currentMenuPath || previousMenuPathRef.current === currentMenuPath) return;

    previousMenuPathRef.current = currentMenuPath;

    const subTypes = serviceDefs
      .filter(opt => opt.menuPath === currentMenuPath)
      .map((item) => ({ ...item, i18nKey: "SERVICEDEFS_" + item.serviceCode.toUpperCase() }))
      .sort((a, b) => (a.order || 0) - (b.order || 0));

    // Remove the field if no subTypes available
    const subTypeIndex = createComplaint.body.findIndex(f => f.key === "SelectSubComplaintType");
    if (subTypes.length > 0) {
      const newField = {
        type: "dropdown",
        label: "CS_COMPLAINT_DETAILS_COMPLAINT_SUBTYPE",
        key: "SelectSubComplaintType",
        isMandatory: true,
        disable: false,
        populators: {
          name: "SelectSubComplaintType",
          optionsKey: "i18nKey",
          required: true,
          error: "CORE_COMMON_REQUIRED_ERRMSG",
          options: subTypes,
        },
      };

      if (subTypeIndex === -1) {
        // Inject below complaint type field
        const typeIndex = createComplaint.body.findIndex(f => f.key === "SelectComplaintType");
        createComplaint.body.splice(typeIndex + 1, 0, newField);
      } else {
        createComplaint.body[subTypeIndex] = newField; // update options
      }

      setValue("SelectSubComplaintType", null); // Reset value when type changes
    } else {
      // Remove if previously added
      if (subTypeIndex !== -1) {
        createComplaint.body.splice(subTypeIndex, 1);
      }

      setValue("SelectSubComplaintType", null); // still reset value
    }
  };

  if (formData.GeoLocationsPoint?.pincode) {
    formData.postalCode = `${formData.GeoLocationsPoint.pincode}`;
  }
  else if (formData.postalCode) {
    formData.postalCode = `${formData.postalCode}`;
  }

  if (formData.landmark && typeof formData.landmark === "object") {
    formData.landmark = "";
  }


  return (
    <Card type="secondary">
      <Header>{t("FORM_STEP", { current: currentStep + 1, total: configs.length })}</Header>

      <FormComposerV2
        config={[configs[currentStep]]}
        defaultValues={formData}
        onFormValueChange={onFormValueChange}
        label={isLast ? t("SUBMIT") : t("NEXT")}
        onSubmit={onSubmit}
        showSecondaryLabel={currentStep > 0}
        secondaryLabel={t("BACK")}
        onSecondayActionClick={() => setCurrentStep((s) => s - 1)}
        fieldStyle={{ marginBottom: "1rem" }}
        buttonStyle={{ flexDirection: "row-reverse" }}
      />


      {toast && <Toast label={toast.label} type={toast.type} onClose={() => setToast(null)} />}
    </Card>
  );
};

export default FormExplorer;
