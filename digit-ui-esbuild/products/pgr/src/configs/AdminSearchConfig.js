/**
 * Config for the SUPERUSER Admin Complaint Search screen (/employee/pgr/admin-search).
 *
 * Mirrors the inbox-v2 pattern exactly (InboxSearchComposer, config-driven):
 * - search section: complaint number + date range
 * - filter sidebar: department MULTI-select (incl. "No department (N/A)" → NA sentinel)
 * - results: complaint no / department / category / status / created / modified
 *
 * Data comes from POST /pgr-services/v2/request/_admin/_search (backend PR #1260)
 * via the custom hook pgr.useAdminComplaintSearch; form→param translation lives
 * in UICustomizations.AdminSearchConfig.preProcess.
 *
 * Department options are injected at runtime by the AdminSearch page (MDMS
 * common-masters.Department + the N/A entry) into
 * sections.filter.uiConfig.fields[0].populators.options — same runtime-inject
 * approach the inbox uses for complaint types.
 */

import Urls from "../utils/urls";

const AdminSearchConfig = () => {
    const tenantId = Digit.ULBService.getCurrentTenantId();
    return {
        label: "ES_PGR_ADMIN_SEARCH",
        type: "inbox",
        customHookName: "pgr.useAdminComplaintSearch",
        apiDetails: {
            serviceName: Urls.pgr.adminSearch,
            requestParam: {
                tenantId: tenantId,
                limit: 20,
                offset: 0,
                sortBy: "createdTime",
                sortOrder: "DESC",
            },
            requestBody: {},
            minParametersForSearchForm: 0,
            minParametersForFilterForm: 0,
            masterName: "commonUiConfig",
            moduleName: "AdminSearchConfig",
            tableFormJsonPath: "requestParam",
            filterFormJsonPath: "requestParam",
            searchFormJsonPath: "requestParam",
        },
        sections: {
            search: {
                uiConfig: {
                    headerStyle: null,
                    primaryLabel: "ACTION_TEST_SEARCH",
                    secondaryLabel: "CS_COMMON_CLEAR_SEARCH",
                    minReqFields: 0,
                    defaultValues: {
                        complaintNumber: "",
                        range: null,
                    },
                    fields: [
                        {
                            label: "CS_COMMON_COMPLAINT_NO",
                            type: "text",
                            isMandatory: false,
                            disable: false,
                            populators: {
                                name: "complaintNumber",
                                error: "ES_PGR_ADMIN_COMPLAINT_NO_INVALID",
                                // Full complaint id or a fragment; sanitised in preProcess.
                                validation: { pattern: "[A-Za-z0-9\\-]{2,64}", minlength: 2 },
                            },
                        },
                        {
                            label: "EVENTS_DATERANGE_LABEL",
                            type: "dateRange",
                            isMandatory: false,
                            disable: false,
                            populators: {
                                name: "range",
                            },
                        },
                    ],
                },
                label: "",
                children: {},
                show: true,
            },
            filter: {
                uiConfig: {
                    type: "filter",
                    primaryLabel: "ES_COMMON_APPLY",
                    secondaryLabel: "ES_CLEAR_ALL",
                    formClassName: "filter",
                    minReqFields: 0,
                    defaultValues: {
                        departments: [],
                    },
                    fields: [
                        {
                            label: "ES_PGR_ADMIN_DEPARTMENTS",
                            type: "multiselectdropdown",
                            isMandatory: false,
                            disable: false,
                            key: "departments",
                            populators: {
                                name: "departments",
                                optionsKey: "i18nKey",
                                defaultText: "ES_PGR_ADMIN_SELECT_DEPARTMENTS",
                                selectedText: "COMMON_SELECTED",
                                allowMultiSelect: true,
                                // Injected at runtime by the AdminSearch page:
                                // [{ code: "NA", i18nKey: <No department> }, { code, i18nKey }...]
                                options: [],
                            },
                        },
                    ],
                },
                label: "ES_COMMON_FILTER_BY",
                show: true,
            },
            searchResult: {
                label: "",
                uiConfig: {
                    // Server-side pagination — client header sort would only
                    // reorder the current page (same reasoning as inbox #432),
                    // so all columns disable it; ordering is createdTime DESC
                    // server-side.
                    columns: [
                        {
                            label: "CS_COMMON_COMPLAINT_NO",
                            jsonPath: "businessObject.service.serviceRequestId",
                            key: "complaintNumber",
                            additionalCustomization: true,
                            disableSortBy: true,
                            wrap: true,
                            minWidth: "180px",
                        },
                        {
                            label: "ES_PGR_ADMIN_HEADER_DEPARTMENT",
                            jsonPath: "businessObject.service.additionalDetail.department",
                            key: "department",
                            additionalCustomization: true,
                            disableSortBy: true,
                        },
                        {
                            label: "CS_COMPLAINT_DETAILS_COMPLAINT_TYPE",
                            jsonPath: "businessObject.service.serviceCode",
                            key: "category",
                            additionalCustomization: true,
                            disableSortBy: true,
                        },
                        {
                            label: "CS_COMPLAINT_DETAILS_CURRENT_STATUS",
                            jsonPath: "businessObject.service.applicationStatus",
                            key: "adminStatus",
                            additionalCustomization: true,
                            disableSortBy: true,
                        },
                        {
                            label: "ES_PGR_ADMIN_CREATED_DATE",
                            jsonPath: "businessObject.service.auditDetails.createdTime",
                            key: "createdTime",
                            additionalCustomization: true,
                            disableSortBy: true,
                        },
                        {
                            label: "ES_PGR_ADMIN_LAST_MODIFIED",
                            jsonPath: "businessObject.service.auditDetails.lastModifiedTime",
                            key: "lastModifiedTime",
                            additionalCustomization: true,
                            disableSortBy: true,
                        },
                    ],
                    enableGlobalSearch: false,
                    enableColumnSort: true,
                    resultsJsonPath: "items",
                    totalCountJsonPath: "totalCount",
                },
                children: {},
                show: true,
            },
            links: {
                uiConfig: { links: [], label: "", logoIcon: {} },
                children: {},
                show: false,
            },
        },
    };
};

export default AdminSearchConfig;
