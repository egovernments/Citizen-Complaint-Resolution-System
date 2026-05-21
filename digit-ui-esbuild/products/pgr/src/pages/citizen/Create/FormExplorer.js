

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
  const tenants = Digit.Hooks.pgr.useTenants();


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
    // Filter unique menuPath types and add translated menuPathName
    const seen = new Set();
    const uniqueComplaintTypes = serviceDefs.filter(item => {
      const key = item.menuPath;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).map(item => ({
      ...item,
      menuPathName: t("SERVICEDEFS." + item.menuPath.toUpperCase()),
    }));

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
            code:
              formData?.GeoLocationsPoint?.ward?.code ||
              formData?.SelectedBoundary?.code ||
              formData?.SelectAddress?.locality?.code ||
              "",
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
    // Step 3 — complaintsLocation: now uses PGRBoundaryComponent.
    // Form key changed from `SelectAddress` to `SelectedBoundary`.
    ["SelectedBoundary"],
    ["description"],
    // Step 5 — complaintsUploadimages config
    [],
  ];


  const isFieldValid = (data, fieldKey) => {
    switch (fieldKey) {
      case "ComplaintImagesPoint":
        return Array.isArray(data?.ComplaintImagesPoint) && data.ComplaintImagesPoint.length > 0;
      case "SelectedBoundary":
        // Tolerate the legacy SelectAddress shape so any in-flight
        // session data created before this change still validates.
        // Also require the picked boundary to be a leaf (no children) so
        // a citizen can't file at the County or Sub-County level — the
        // PGR routing and SLA both key off the Ward (closes
        // egovernments/CCRS#478 — locality validation, citizen path).
        if (data?.SelectedBoundary?.code) {
          const sb = data.SelectedBoundary;
          return !Array.isArray(sb.children) || sb.children.length === 0;
        }
        return !!data?.SelectAddress?.city?.code && !!data?.SelectAddress?.locality?.code;
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

    // The map step writes a Nominatim-derived pincode into
    // GeoLocationsPoint.pincode. Earlier we mirrored that onto
    // formData.postalCode via a render-time mutation, but react-hook-form
    // retained the mirrored value across step changes — so picking a
    // fresh pin and stepping forward still validated against the *old*
    // postalCode. Force the latest GeoLocationsPoint.pincode to win
    // whenever it's present, so the new pin's pincode flows through
    // both the form display and the allowlist check below.
    if (merged?.GeoLocationsPoint?.pincode != null && String(merged.GeoLocationsPoint.pincode).length > 0) {
      merged.postalCode = String(merged.GeoLocationsPoint.pincode);
    }

    // Get fields mandatory for current step
    const mandatoryFields = mandatoryFieldsByStep[currentStep] || [];

    // Find which mandatory fields are missing or invalid
    const missingFields = mandatoryFields.filter(field => !isFieldValid(merged, field));

    if (missingFields.length > 0) {
      const missingLabels = missingFields.map(f => t(f));

      return; // block next step or submit
    }

    // Pincode allowlist is a fallback for environments without a map +
    // ward-resolution flow. When the citizen has pinned a location that
    // resolved to a Nairobi ward (turf point-in-polygon hit), the
    // routing key is the ward, not the pincode, and Nominatim's
    // reverse-geocoded postcode often won't be in the tenant allowlist
    // even though the location is geographically valid. Skip the
    // allowlist check in that case (closes egovernments/CCRS#469); the
    // ward-leaf check on the boundary cascade step covers correctness.
    const wardResolved = !!merged?.GeoLocationsPoint?.ward?.code;
    if (!wardResolved && merged?.postalCode != null && String(merged.postalCode).length > 0) {
      // Kenyan postal codes preserve leading zeros (e.g. "00100") but number
      // inputs may store them without. Normalise both sides so "00100", "100"
      // and integer 100 compare equal.
      const normalisePincode = (v) => String(v ?? "").trim().replace(/^0+/, "") || "0";
      const pincodeStr = normalisePincode(merged.postalCode);
      const allowlistConfigured = Array.isArray(tenants)
        && tenants.some((tnt) => Array.isArray(tnt?.pincode) && tnt.pincode.length > 0);
      if (allowlistConfigured) {
        const isServiceable = tenants.some((tnt) =>
          Array.isArray(tnt?.pincode) && tnt.pincode.some((p) => normalisePincode(p) === pincodeStr)
        );
        if (!isServiceable) {
          setToast({ label: t("CS_COMMON_PINCODE_NOT_SERVICABLE"), type: "error" });
          return;
        }
      }
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
    const complaintType = formData?.SelectComplaintType;
    const currentMenuPath = complaintType?.menuPath;

    // Skip if menuPath didn't change
    if (!currentMenuPath || previousMenuPathRef.current === currentMenuPath) return;

    previousMenuPathRef.current = currentMenuPath;

    const subTypes = serviceDefs
      .filter(opt => opt.menuPath === currentMenuPath)
      .sort((a, b) => (a.order || 0) - (b.order || 0));

    // CCRS#437: reset subtype IMMEDIATELY on complaint type change so the
    // stale value from the previous type cannot leak into the next render.
    // setValue options force the Controller to flush the new value before the
    // dropdown options are swapped below. Pass undefined (not null) so the
    // underlying Dropdown falls back cleanly to its empty state.
    setValue("SelectSubComplaintType", undefined, { shouldDirty: true, shouldTouch: true, shouldValidate: false });

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
          optionsKey: "name",
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
    } else {
      // Remove if previously added
      if (subTypeIndex !== -1) {
        createComplaint.body.splice(subTypeIndex, 1);
      }
    }
  };

  // Sync the map-derived pincode onto formData.postalCode through a
  // proper setState so react-hook-form picks up the new defaultValue
  // when stepping into / out of locationDetails. The previous in-place
  // mutation persisted a stale "40476" across step transitions because
  // FormComposerV2 retained the field value internally — see #469.
  React.useEffect(() => {
    const pin = formData?.GeoLocationsPoint?.pincode;
    const desired = pin != null && String(pin).length > 0 ? String(pin) : undefined;
    if (desired !== undefined && formData.postalCode !== desired) {
      setFormData((prev) => ({ ...prev, postalCode: desired }));
    }
  }, [formData?.GeoLocationsPoint?.pincode]);

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


      {toast && (
        <Toast
          label={typeof toast === "string" ? toast : toast.label}
          type={typeof toast === "object" && toast.type ? toast.type : "success"}
          onClose={() => setToast(null)}
        />
      )}
    </Card>
  );
};

export default FormExplorer;
