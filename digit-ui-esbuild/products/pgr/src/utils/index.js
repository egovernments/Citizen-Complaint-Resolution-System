import _ from "lodash";
import axios from "axios";
import { CustomisedHooks } from "../hooks";
import { UICustomizations } from "../configs/UICustomizations";

export const overrideHooks = () => {
  Object.keys(CustomisedHooks).map((ele) => {
    if (ele === "Hooks") {
      Object.keys(CustomisedHooks[ele]).map((hook) => {
        Object.keys(CustomisedHooks[ele][hook]).map((method) => {
          setupHooks(hook, method, CustomisedHooks[ele][hook][method]);
        });
      });
    } else if (ele === "Utils") {
      Object.keys(CustomisedHooks[ele]).map((hook) => {
        Object.keys(CustomisedHooks[ele][hook]).map((method) => {
          setupHooks(hook, method, CustomisedHooks[ele][hook][method], false);
        });
      });
    } else {
      Object.keys(CustomisedHooks[ele]).map((method) => {
        setupLibraries(ele, method, CustomisedHooks[ele][method]);
      });
    }
  });
};
const setupHooks = (HookName, HookFunction, method, isHook = true) => {
  window.Digit = window.Digit || {};
  window.Digit[isHook ? "Hooks" : "Utils"] = window.Digit[isHook ? "Hooks" : "Utils"] || {};
  window.Digit[isHook ? "Hooks" : "Utils"][HookName] = window.Digit[isHook ? "Hooks" : "Utils"][HookName] || {};
  window.Digit[isHook ? "Hooks" : "Utils"][HookName][HookFunction] = method;
};
/* To Overide any existing libraries  we need to use similar method */
const setupLibraries = (Library, service, method) => {
  window.Digit = window.Digit || {};
  window.Digit[Library] = window.Digit[Library] || {};
  window.Digit[Library][service] = method;
};

/* To Overide any existing config/middlewares  we need to use similar method */
export const updateCustomConfigs = () => {
setupLibraries("Customizations", "commonUiConfig", { ...window?.Digit?.Customizations?.commonUiConfig, ...UICustomizations });
};

/// Util function to downloads files with type as pdf or excel
export const downloadFileWithName = ({ fileStoreId = null, customName = null, type = "excel" }) => {
  const downloadFile = (blob, fileName, extension) => {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${fileName}.${extension}`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 7000);
  };

  if (fileStoreId) {
    const fileTypeMapping = {
      excel: {
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        extension: "xlsx",
      },
      pdf: {
        mimeType: "application/pdf",
        extension: "pdf",
      },
    };

    const { mimeType, extension } = fileTypeMapping[type] || fileTypeMapping["excel"]; // Default to Excel if type is invalid

    axios
      .get("/filestore/v1/files/id", {
        responseType: "arraybuffer",
        headers: {
          "Content-Type": "application/json",
          Accept: mimeType,
          "auth-token": Digit.UserService.getUser()?.["access_token"],
        },
        params: {
          tenantId: Digit.ULBService.getCurrentTenantId(),
          fileStoreId: fileStoreId,
        },
      })
      .then((res) => {
        downloadFile(
          new Blob([res.data], { type: mimeType }),
          customName || "download",
          extension
        );
      });
  }
};


export function formatTimestampToDate(timestamp) {
  // Check if the timestamp is valid
  if (!timestamp || typeof timestamp !== "number") {
    return "Invalid timestamp";
  }

  // Convert timestamp to a JavaScript Date object
  const date = new Date(timestamp);

  // Define an array of month abbreviations
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  // Extract day, month, and year from the date
  const day = date.getDate().toString().padStart(2, "0");
  const month = monthNames[date.getMonth()]; // getMonth() returns 0-11
  const year = date.getFullYear();

  // Return the formatted date string
  return `${day} ${month} ${year}`;
}

// pagination options for table
export const getCustomPaginationOptions = (t) => ({
  rowsPerPageText: t("HCM_AM_ROWS_PER_PAGE"),
  rangeSeparatorText: t("HCM_AM_OF"),
});

export const convertEpochToDate = (dateEpoch) => {
  // Returning null in else case because new Date(null) returns initial date from calender
  if (dateEpoch) {
    const dateFromApi = new Date(dateEpoch);
    let month = dateFromApi.getMonth() + 1;
    let day = dateFromApi.getDate();
    let year = dateFromApi.getFullYear();
    month = (month > 9 ? "" : "0") + month;
    day = (day > 9 ? "" : "0") + day;
    return `${year}-${month}-${day}`;
  } else {
    return null;
  }
};

export const convertEpochFormateToDate = (dateEpoch) => {
  // Returning null in else case because new Date(null) returns initial date from calender
  if (dateEpoch) {
    const dateFromApi = new Date(dateEpoch);
    let month = dateFromApi.getMonth() + 1;
    let day = dateFromApi.getDate();
    let year = dateFromApi.getFullYear();
    month = (month > 9 ? "" : "0") + month;
    day = (day > 9 ? "" : "0") + day;
    return `${day}/${month}/${year}`;
  } else {
    return null;
  }
};


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



export const formPayloadToCreateComplaint = (formData, tenantId, user, extOpts) => {
  const userInfo =  {
    "name": formData?.ComplainantName?.trim()?.length > 0 ? formData?.ComplainantName?.trim() : null,
    "mobileNumber": formData?.ComplainantContactNumber?.trim()?.length > 0 ? formData?.ComplainantContactNumber?.trim() : null,
    "userName": formData?.ComplainantContactNumber?.trim()?.length > 0 ? formData?.ComplainantContactNumber?.trim() : null,
    "type": "EMPLOYEE",
    "tenantId": tenantId,
  };
  const additionalDetail = { supervisorName : formData?.SupervisorName?.trim()?.length > 0 ? formData?.SupervisorName?.trim() : null, supervisorContactNumber : formData?.SupervisorContactNumber?.trim()?.length > 0 ? formData?.SupervisorContactNumber?.trim() : null };
  const timestamp = Date.now();
  let complaint = {
    "service": {
      "active": true,
      "tenantId": tenantId,
      "serviceCode": getEffectiveServiceCode(formData?.SelectComplaintType,formData?.SelectSubComplaintType),
      "description": formData?.description,
      "applicationStatus": "CREATED",
      "source": "web",
      "citizen": userInfo,
      "isDeleted": false,
      "rowVersion": 1,
      "address": {
        "landmark": formData?.landmark,
        "buildingName": formData?.AddressOne,
        "street": formData?.AddressTwo,
        "pincode": formData?.postalCode,
        // `SelectedBoundary` is the deepest node the operator picked
        // in the PGR boundary cascade (e.g. the Ward). Falls back to
        // the legacy `SelectLocality` key so any caller that still
        // writes the old shape keeps working during rollout.
        "locality": {
          "code": formData?.SelectedBoundary?.code || formData?.SelectLocality?.code,
        },
        "geoLocation": {}
      },
      "additionalDetail": JSON.stringify(additionalDetail),
      "auditDetails": {
        "createdBy": user?.uuid,
        "createdTime": timestamp,
        "lastModifiedBy": user?.uuid,
        "lastModifiedTime": timestamp
      }
    },
    "workflow": {
      "action": "APPLY",
      "assignes": [],
      "hrmsAssignes": [],
      "comments": ""
    }
  }

  // Additive: attach a FLAT top-level service.extendedAttributes when the
  // employee's tenant mapped to a category (extOpts.caseRelatedTo). Backward
  // compatible — existing 3-arg callers and non-mapped tenants are unchanged.
  if (extOpts && extOpts.caseRelatedTo) {
    const sct = formData?.SelectComplaintType;
    const sst = formData?.SelectSubComplaintType;
    const lvl1 = sct?.code ?? sct?.serviceCode ?? sct?.name;
    const lvl2 = sst?.code ?? sst?.serviceCode ?? sst?.name;
    const ext = {
      caseRelatedTo: extOpts.caseRelatedTo,
      isConfidential: !!formData?.isConfidential,
      schemaVersion: "1.0",
    };
    if (lvl1) ext.hierarchyLevel1 = lvl1;
    if (lvl2) ext.hierarchyLevel2 = lvl2;
    (extOpts.fieldKeys || []).forEach((k) => {
      const v = formData?.[k];
      if (v !== undefined && v !== null && String(v).length > 0) ext[k] = v;
    });
    complaint.service.extendedAttributes = ext;
  }

  // Complainant address (citizen-flow parity — same extendedAttributes key the
  // citizen "Your details" card writes). Attached even when the tenant has no
  // category mapping so the field never silently drops its value; deliberately
  // NOT citizen.correspondenceAddress, which would round-trip the user service.
  const complainantAddress = formData?.ComplainantAddress?.trim();
  if (complainantAddress) {
    complaint.service.extendedAttributes = {
      ...(complaint.service.extendedAttributes || {}),
      complainantAddress,
    };
  }

  return complaint;
};

// ---------------------------------------------------------------------------
// ComplaintHierarchy -> legacy ServiceDefs adapter
// ---------------------------------------------------------------------------
// The legacy RAINMAKER-PGR.ServiceDefs master is gone. Service definitions now
// derive from the single RAINMAKER-PGR.ComplaintHierarchy adjacency list, which
// holds BOTH interior classification nodes AND leaf complaint types. A leaf row
// additionally carries department/departments/slaHours/keywords; interior nodes
// omit them. A leaf row's `code` IS the serviceCode stored on a complaint.
//
// These helpers keep the rest of the PGR UI unchanged by mapping leaf rows back
// onto the legacy ServiceDefs field names. `menuPath`/`menuPathName` are no
// longer master fields — they are derived from the tree (group = parentCode,
// group label = parent node's name).

// A row is a LEAF complaint type iff it carries a department or slaHours.
export const isComplaintHierarchyLeaf = (row) =>
  row != null && (row.department != null || row.slaHours != null);

// Map ComplaintHierarchy rows (full tree) -> legacy ServiceDefs[] (leaves only).
export const mapComplaintHierarchyToServiceDefs = (rows = []) => {
  const all = Array.isArray(rows) ? rows : [];
  const nameByCode = {};
  all.forEach((n) => {
    if (n?.code != null) nameByCode[n.code] = n.name;
  });
  return all
    .filter((row) => isComplaintHierarchyLeaf(row) && row.active !== false)
    .map((row) => ({
      serviceCode: row.code,
      name: row.name,
      department: row.department,
      departments: row.departments,
      slaHours: row.slaHours,
      keywords: row.keywords,
      order: row.order,
      active: row.active,
      parentCode: row.parentCode,
      menuPath: row.parentCode,
      menuPathName: row.parentCode != null ? nameByCode[row.parentCode] : undefined,
    }));
};

// `select` helper for useCustomMDMS([{ name: "ComplaintHierarchy" }]) calls that
// previously read RAINMAKER-PGR.ServiceDefs. Returns the adapted ServiceDefs[].
export const selectServiceDefsFromComplaintHierarchy = (raw) =>
  mapComplaintHierarchyToServiceDefs(raw?.["RAINMAKER-PGR"]?.ComplaintHierarchy);

export default {};