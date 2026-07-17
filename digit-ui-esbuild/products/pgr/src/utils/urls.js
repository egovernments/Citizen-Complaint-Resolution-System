
const healthHrms = window?.globalConfigs?.getConfig("HRMS_CONTEXT_PATH") || "egov-hrms";
const mdmsPath = window?.globalConfigs?.getConfig("MDMS_CONTEXT_PATH") || "mdms-v2";
const boundarySearchPath = window?.globalConfigs?.getConfig("BOUNDARY_CONTEXT") || "boundary-service/boundary-relationships/_search?";
const hierarchyType = window?.globalConfigs?.getConfig("HIERARCHY_TYPE") || "MICROPLAN";
const projectContextPath = window?.globalConfigs?.getConfig("PROJECT_CONTEXT_PATH") || "project";

const Urls = {
  pgr: {
    inboxSearch: `/inbox/v2/_search`,
    search: `/pgr-services/v2/request/_search`,
    // Visibility V1 step-2: server-resolved inbox tabs (pgr-services)
    visibilitySearch: `/pgr-services/v2/request/inbox/_search`,
    visibilityCount: `/pgr-services/v2/request/inbox/_count`,
    // SUPERUSER cross-department search (backend PR #1260); returns ServiceWrappers + totalCount
    adminSearch: `/pgr-services/v2/request/_admin/_search`,
    create: `/pgr-services/v2/request/_create`,
    update: `/pgr-services/v2/request/_update`,
  },
  workflow: {
    processSearch: `egov-workflow-v2/egov-wf/process/_search`,
    businessServiceSearch:  `/egov-workflow-v2/egov-wf/businessservice/_search`,
  }
};

export default Urls;