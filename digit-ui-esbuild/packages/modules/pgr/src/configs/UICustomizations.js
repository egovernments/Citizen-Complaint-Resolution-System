import { Link, useHistory } from "react-router-dom";
import _ from "lodash";
import React from 'react';
import { Button } from "@egovernments/digit-ui-react-components";
import { Tag} from "@egovernments/digit-ui-components";

//create functions here based on module name set in mdms(eg->SearchProjectConfig)
//how to call these -> Digit?.Customizations?.[masterName]?.[moduleName]
// these functions will act as middlewares
// var Digit = window.Digit || {};

const businessServiceMap = {
  "muster roll": "MR",
};

const inboxModuleNameMap = {
  "muster-roll-approval": "muster-roll-service",
};

export const UICustomizations = {
  businessServiceMap,
  updatePayload: (applicationDetails, data, action, businessService) => {
    if (businessService === businessServiceMap.estimate) {
      const workflow = {
        comment: data.comments,
        documents: data?.documents?.map((document) => {
          return {
            documentType: action?.action + " DOC",
            fileName: document?.[1]?.file?.name,
            fileStoreId: document?.[1]?.fileStoreId?.fileStoreId,
            documentUid: document?.[1]?.fileStoreId?.fileStoreId,
            tenantId: document?.[1]?.fileStoreId?.tenantId,
          };
        }),
        assignees: data?.assignees?.uuid ? [data?.assignees?.uuid] : null,
        action: action.action,
      };
      //filtering out the data
      Object.keys(workflow).forEach((key, index) => {
        if (!workflow[key] || workflow[key]?.length === 0) delete workflow[key];
      });

      return {
        estimate: applicationDetails,
        workflow,
      };
    }
    if (businessService === businessServiceMap.contract) {
      const workflow = {
        comment: data?.comments,
        documents: data?.documents?.map((document) => {
          return {
            documentType: action?.action + " DOC",
            fileName: document?.[1]?.file?.name,
            fileStoreId: document?.[1]?.fileStoreId?.fileStoreId,
            documentUid: document?.[1]?.fileStoreId?.fileStoreId,
            tenantId: document?.[1]?.fileStoreId?.tenantId,
          };
        }),
        assignees: data?.assignees?.uuid ? [data?.assignees?.uuid] : null,
        action: action.action,
      };
      //filtering out the data
      Object.keys(workflow).forEach((key, index) => {
        if (!workflow[key] || workflow[key]?.length === 0) delete workflow[key];
      });

      return {
        contract: applicationDetails,
        workflow,
      };
    }
    if (businessService === businessServiceMap?.["muster roll"]) {
      const workflow = {
        comment: data?.comments,
        documents: data?.documents?.map((document) => {
          return {
            documentType: action?.action + " DOC",
            fileName: document?.[1]?.file?.name,
            fileStoreId: document?.[1]?.fileStoreId?.fileStoreId,
            documentUid: document?.[1]?.fileStoreId?.fileStoreId,
            tenantId: document?.[1]?.fileStoreId?.tenantId,
          };
        }),
        assignees: data?.assignees?.uuid ? [data?.assignees?.uuid] : null,
        action: action.action,
      };
      //filtering out the data
      Object.keys(workflow).forEach((key, index) => {
        if (!workflow[key] || workflow[key]?.length === 0) delete workflow[key];
      });

      return {
        musterRoll: applicationDetails,
        workflow,
      };
    }
    if (businessService === businessServiceMap?.["works.purchase"]) {
      const workflow = {
        comment: data.comments,
        documents: data?.documents?.map((document) => {
          return {
            documentType: action?.action + " DOC",
            fileName: document?.[1]?.file?.name,
            fileStoreId: document?.[1]?.fileStoreId?.fileStoreId,
            documentUid: document?.[1]?.fileStoreId?.fileStoreId,
            tenantId: document?.[1]?.fileStoreId?.tenantId,
          };
        }),
        assignees: data?.assignees?.uuid ? [data?.assignees?.uuid] : null,
        action: action.action,
      };
      //filtering out the data
      Object.keys(workflow).forEach((key, index) => {
        if (!workflow[key] || workflow[key]?.length === 0) delete workflow[key];
      });

      const additionalFieldsToSet = {
        projectId: applicationDetails.additionalDetails.projectId,
        invoiceDate: applicationDetails.billDate,
        invoiceNumber: applicationDetails.referenceId.split("_")?.[1],
        contractNumber: applicationDetails.referenceId.split("_")?.[0],
        documents: applicationDetails.additionalDetails.documents,
      };
      return {
        bill: { ...applicationDetails, ...additionalFieldsToSet },
        workflow,
      };
    }
  },
  enableModalSubmit: (businessService, action, setModalSubmit, data) => {
    if (!businessService || !action?.action) {
         console.error('Invalid business service or action');
         return;
       }
    if (businessService === businessServiceMap?.["muster roll"] && action.action === "APPROVE") {
      setModalSubmit(data?.acceptTerms);
    }
  },
  enableHrmsSearch: (businessService, action) => {
    if (businessService === businessServiceMap.estimate) {
      return action.action.includes("TECHNICALSANCTION") || action.action.includes("VERIFYANDFORWARD");
    }
    if (businessService === businessServiceMap.contract) {
      return action.action.includes("VERIFY_AND_FORWARD");
    }
    if (businessService === businessServiceMap?.["muster roll"]) {
      return action.action.includes("VERIFY");
    }
    if (businessService === businessServiceMap?.["works.purchase"]) {
      return action.action.includes("VERIFY_AND_FORWARD");
    }
    return false;
  },
  getBusinessService: (moduleCode) => {
    if (moduleCode?.includes("estimate")) {
      return businessServiceMap?.estimate;
    } else if (moduleCode?.includes("contract")) {
      return businessServiceMap?.contract;
    } else if (moduleCode?.includes("muster roll")) {
      return businessServiceMap?.["muster roll"];
    } else if (moduleCode?.includes("works.purchase")) {
      return businessServiceMap?.["works.purchase"];
    } else if (moduleCode?.includes("works.wages")) {
      return businessServiceMap?.["works.wages"];
    } else if (moduleCode?.includes("works.supervision")) {
      return businessServiceMap?.["works.supervision"];
    } else {
      return businessServiceMap;
    }
  },
  getInboxModuleName: (moduleCode) => {
    if (moduleCode?.includes("estimate")) {
      return inboxModuleNameMap?.estimate;
    } else if (moduleCode?.includes("contract")) {
      return inboxModuleNameMap?.contracts;
    } else if (moduleCode?.includes("attendence")) {
      return inboxModuleNameMap?.attendencemgmt;
    } else {
      return inboxModuleNameMap;
    }
  },

  PGRInboxConfig: {
    preProcess: (data) => {
      const clonedData = _.cloneDeep(data);
      const searchForm = clonedData?.state?.searchForm || {};
      const filterForm = clonedData?.state?.filterForm || {};

      // Build clean params from form state (InboxSearchComposer merges raw form
      // objects into params via the jsonPath config, so we rebuild from scratch)
      const params = {
        tenantId: Digit.ULBService.getCurrentTenantId(),
        limit: clonedData?.state?.tableForm?.limit || 10,
        offset: clonedData?.state?.tableForm?.offset ?? 0,
        sortBy: "applicationStatus",
        sortOrder: "DESC",
      };

      // Search form fields
      if (searchForm.complaintNumber) {
        params.serviceRequestId = searchForm.complaintNumber;
      }
      if (searchForm.mobileNumber) {
        params.mobileNumber = searchForm.mobileNumber;
      }

      // Filter: complaint type (multiselectdropdown returns [{serviceCode, code, i18nKey}])
      const serviceCodes = filterForm.serviceCode;
      if (Array.isArray(serviceCodes) && serviceCodes.length > 0) {
        const codes = serviceCodes.map((s) => s.serviceCode || s.code).filter(Boolean);
        if (codes.length) params.serviceCode = codes;
      }

      // Filter: locality (multiselectdropdown returns [{code, i18nKey}])
      const rawLocality = filterForm.area || filterForm.locality;
      if (Array.isArray(rawLocality) && rawLocality.length > 0) {
        const codes = rawLocality.map((l) => l.code).filter(Boolean);
        if (codes.length) params.locality = codes;
      }

      // Filter: application status (workflowstatesfilter returns {STATUS_KEY: true/false})
      const rawStatuses = filterForm.status || {};
      const statuses = Object.keys(rawStatuses).filter((key) => rawStatuses[key] === true);
      if (statuses.length > 0) {
        params.applicationStatus = statuses;
      }

      // Note: "Assigned to Me" filter is not supported by PGR search API
      // (requires inbox service). The radio still renders but has no effect.

      clonedData.params = params;
      return clonedData;
    },
    additionalCustomizations: (row, key, column, value, t, searchResult) => {
      switch (key) {
        case "CS_COMMON_COMPLAINT_NO":
          return (
            <div style={{display:"grid"}}>
            <span className="link" style={{display:"grid"}}>
            <Link
              to={ `/${window.contextPath}/employee/pgr/complaint/details/${value}`}
            >
              {String(value ? (column.translate ? t(column.prefix ? `${column.prefix}${value}` : value) : value) : t("ES_COMMON_NA"))}
            </Link>
          </span>
          <span>{t(`SERVICEDEFS.${row?.businessObject?.service?.serviceCode.toUpperCase()}`)}</span>
          </div>
          );

          case "WF_INBOX_HEADER_LOCALITY":
          const localityTenantId = row?.ProcessInstance?.tenantId || row?.businessObject?.service?.tenantId;
          return value ? <span>{t(`${Digit.Utils.locale.getTransformedLocale(localityTenantId)}_ADMIN_${value}`)}</span> : <span>{t("NA")}</span>;

        case "CS_COMPLAINT_DETAILS_CURRENT_STATUS":
          return <span>{t(`CS_COMMON_${value}`)}</span>;

        case "WF_INBOX_HEADER_CURRENT_OWNER":
          return value ? <span>{value?.[0]?.name}</span> : <span>{t("NA")}</span>;

        case "WF_INBOX_HEADER_SLA_DAYS_REMAINING":
          return value > 0 ? <Tag label={value} showIcon={false} type="success" /> : <Tag label={value} showIcon={false} type="error" />;

        default:
          return t("ES_COMMON_NA");
      }
    },
    MobileDetailsOnClick: (row, tenantId) => {
      let link;
      Object.keys(row).map((key) => {
        if (key === "WORKS_INBOX_ORDER_NO")
          link = `/${window.contextPath}/employee/contracts/contract-details?tenantId=${tenantId}&workOrderNumber=${row[key]}`;
      });
      return link;
    },
    populateLocalityReqCriteria : () => {
      const tenantId = Digit.ULBService.getCurrentTenantId();

      return {
        url: "/egov-location/location/v11/boundarys/_search",
        params: { tenantId, hierarchyTypeCode:"ADMIN", boundaryType: (typeof window !== "undefined" && window?.globalConfigs?.getConfig("BOUNDARY_TYPE")) || "Locality"},
        body: {},
        config: {
          enabled: true,
          select: (data) => {
            return data;
          },
        },
      };
    }
  },

};
