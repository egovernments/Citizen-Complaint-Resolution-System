import { Link } from "react-router-dom";
import _ from "lodash";

//create functions here based on module name set in mdms(eg->SearchProjectConfig)
//how to call these -> Digit?.Customizations?.[masterName]?.[moduleName]
// these functions will act as middlewares
var Digit = window.Digit || {};



const businessServiceMap = {

  "muster roll": "MR"
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
        invoiceNumber: applicationDetails.referenceId.split('_')?.[1],
        contractNumber: applicationDetails.referenceId.split('_')?.[0],
        documents: applicationDetails.additionalDetails.documents
      }
      return {
        bill: { ...applicationDetails, ...additionalFieldsToSet },
        workflow,
      };
    }
  },
  enableModalSubmit: (businessService, action, setModalSubmit, data) => {
    if (businessService === businessServiceMap?.["muster roll"] && action.action === "APPROVE") {
      setModalSubmit(data?.acceptTerms)
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
      return action.action.includes("VERIFY_AND_FORWARD")
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
    }
    else if (moduleCode?.includes("works.purchase")) {
      return businessServiceMap?.["works.purchase"];
    }
    else if (moduleCode?.includes("works.wages")) {
      return businessServiceMap?.["works.wages"];
    }
    else if (moduleCode?.includes("works.supervision")) {
      return businessServiceMap?.["works.supervision"];
    }
    else {
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
      data.body.inbox.tenantId = Digit.ULBService.getCurrentTenantId();
      data.body.inbox.processSearchCriteria.tenantId = Digit.ULBService.getCurrentTenantId();

      const requestDate = data?.body?.inbox?.moduleSearchCriteria?.range?.requestDate;

      if (requestDate?.startDate && requestDate?.endDate) {
        const fromDate = new Date(requestDate.startDate).getTime();
        const toDate = new Date(requestDate.endDate).getTime();

        data.body.inbox.moduleSearchCriteria.fromDate = fromDate;
        data.body.inbox.moduleSearchCriteria.toDate = toDate;
      }
      else {
        delete data.body.inbox.moduleSearchCriteria.fromDate;
        delete data.body.inbox.moduleSearchCriteria.toDate;
      }

      // Always delete the full range object if it exists
      delete data.body.inbox.moduleSearchCriteria.range;

      const assignee = _.clone(data.body.inbox.moduleSearchCriteria.assignedToMe);
      delete data.body.inbox.moduleSearchCriteria.assignedToMe;
      delete data.body.inbox.moduleSearchCriteria.assignee;

      if (assignee?.code === "ASSIGNED_TO_ME" || data?.state?.filterForm?.assignedToMe?.code === "ASSIGNED_TO_ME") {
        data.body.inbox.moduleSearchCriteria.assignee = Digit.UserService.getUser().info.uuid;
      }

      // --- Handle serviceCode ---
      let serviceCodes = _.clone(data.body.inbox.moduleSearchCriteria.serviceCode || null);
      serviceCodes = serviceCodes?.serviceCode;
      delete data.body.inbox.moduleSearchCriteria.serviceCode;
      if (serviceCodes != null) {
        data.body.inbox.moduleSearchCriteria.complaintType = serviceCodes;
      } else {
        delete data.body.inbox.moduleSearchCriteria.complaintType;
      }

      delete data.body.inbox.moduleSearchCriteria.locality;
      let rawLocality = data?.state?.filterForm?.locality;
      let localityArray = [];
      if (rawLocality) {
        if (Array.isArray(rawLocality)) {
          localityArray = rawLocality.map((loc) => loc?.code).filter(Boolean);
        } else if (rawLocality.code) {
          localityArray = [rawLocality.code];
        }
      }

      if (localityArray.length > 0) {
        delete data.body.inbox.moduleSearchCriteria.locality;
        data.body.inbox.moduleSearchCriteria.area = localityArray;
      } else {
        delete data.body.inbox.moduleSearchCriteria.area;
      }

      // --- Handle status from state.filterForm ---
      const rawStatuses = _.clone(data?.state?.filterForm?.status || {});
      const statuses = Object.keys(rawStatuses).filter((key) => rawStatuses[key] === true);

      if (statuses.length > 0) {
        data.body.inbox.moduleSearchCriteria.status = statuses;
      } else {
        delete data.body.inbox.moduleSearchCriteria.status;
      }

      return data;
    },
    additionalCustomizations: (row, key, column, value, t, searchResult) => {
      switch (key) {
        case "CS_COMMON_COMPLAINT_NO":
          return (
            <div style={{ display: "grid" }}>
              <span className="link" style={{ display: "grid" }}>
                <Link
                  to={`/${window.contextPath}/employee/pgr/complaint/details/${value}`}
                >
                  {String(value ? (column.translate ? t(column.prefix ? `${column.prefix}${value}` : value) : value) : t("ES_COMMON_NA"))}
                </Link>
              </span>
              <span>{t(`SERVICEDEFS.${row?.businessObject?.service?.serviceCode?.toUpperCase()}`)}</span>
            </div>
          );

        case "WF_INBOX_HEADER_LOCALITY":
          return value ? <span>{t(`${value}`)}</span> : <span>{t("NA")}</span>;

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
  }
};
