
/**
 * config for PGR Inbox screen:
 * @Initial Data Load: On screen load, the system automatically fetches a list of Complaints.
 * @filter section: Allows users to filter the list based on current application status, boundary, assigned to and complaint type parameters.
 * @search section: Enables users to search for specific complaints using complaint number, date range, or phone number.
 * @link section: Provides navigation to the Create Complaint screen.
 */

import Urls from "../utils/urls";

const PGRSearchInboxConfig = () => {
    const tenantId = Digit.ULBService.getCurrentTenantId();
    return {
        label: "CS_COMMON_INBOX",
        type: 'inbox',
        customHookName: "pgr.usePGRInboxSearch",
        apiDetails: {
            serviceName: Urls.pgr.search,
            requestParam: {
                tenantId: tenantId,
                limit: 10,
                offset: 0,
                sortBy: "applicationStatus",
                sortOrder: "DESC",
            },
            requestBody: {},
            minParametersForSearchForm: 0,
            minParametersForFilterForm: 0,
            masterName: "commonUiConfig",
            moduleName: "PGRInboxConfig",
            tableFormJsonPath: "requestParam",
            filterFormJsonPath: "requestParam",
            searchFormJsonPath: "requestParam",
        },
        sections: {
            search: {
                uiConfig: {
                    headerStyle: null,
                    primaryLabel: 'ACTION_TEST_SEARCH',
                    secondaryLabel: 'CS_COMMON_CLEAR_SEARCH',
                    minReqFields: 1,
                    defaultValues: {
                        complaintNumber: "",
                        mobileNumber: "",
                        range:null

                    },
                    fields: [
                        {
                            label: "CS_COMMON_COMPLAINT_NO",
                            type: "text",
                            isMandatory: false,
                            disable: false,
                            populators: {
                                name: "complaintNumber",
                                error: `ESTIMATE_PATTERN_ERR_MSG`,
                                validation: { pattern: "PG-PGR-\d{4}-\d{2}-\d{2}-\d{6}", minlength: 2 }
                            },
                        },
                          {
                            label: "CS_COMMON_MOBILE_NO",
                            type: "text",
                            isMandatory: false,
                            disable: false,
                            populators: {
                                // prefix:"+922",
                                name: "mobileNumber",
                                // error: `PROJECT_PATTERN_ERR_MSG`,
                                // validation: { pattern: "^\+?[1-9]\d{0,2}[-.\s]?\(?\d{1,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}$", minlength: 2 }
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
                        }
                    ]
                },
                label: "",
                children: {},
                show: true
            },
            searchResult: {
                label: "",
                uiConfig: {
                    // Column header sort is client-side react-table, which only
                    // reorders the CURRENT page while pagination is server-side —
                    // so it misleads operators (issue #432). Every column sets
                    // `disableSortBy: true`; ordering is done server-side in
                    // PGRInboxConfig.preProcess (sortBy=sla, most urgent first).
                    columns: [
                        {
                            label: "CS_COMMON_COMPLAINT_NO",
                            jsonPath: "businessObject.service.serviceRequestId",
                            key: "complaintNumber",
                            additionalCustomization: true,
                            disableSortBy: true,
                            // #432.4: react-data-table ellipsis-truncates the
                            // full serviceRequestId by default. wrap lets the
                            // complaint number render in full; minWidth keeps
                            // the column from collapsing too narrow.
                            wrap: true,
                            minWidth: "180px",
                        },
                        {
                            label: "WF_INBOX_HEADER_LOCALITY",
                            jsonPath: "businessObject.service.address.locality.code",
                            additionalCustomization: true,
                            disableSortBy: true,
                        },
                        {
                            label: "CS_COMPLAINT_DETAILS_CURRENT_STATUS",
                            jsonPath: "businessObject.service.applicationStatus",
                            additionalCustomization: true,
                            // Client-side header sort only reorders the current
                            // page (server pagination), so it misleads operators.
                            // The inbox is ordered server-side by SLA (#432).
                            disableSortBy: true,
                        },
                        {
                            label: "WF_INBOX_HEADER_CURRENT_OWNER",
                            jsonPath: "ProcessInstance.assignes",
                            additionalCustomization: true,
                            key: "assignee",
                            disableSortBy: true,
                        },
                        {
                            label: "WF_INBOX_HEADER_SLA_DAYS_REMAINING",
                            jsonPath: "businessObject.serviceSla",
                            additionalCustomization: true,
                            key: "state",
                            // #432.2: the inbox is now ordered by SLA remaining
                            // server-side (sortBy=sla, ASC — most urgent first;
                            // see PGRInboxConfig.preProcess + PGRQueryBuilder).
                            // The previous per-column client sortFunction only
                            // reordered the CURRENT page, so rows dropped in/out
                            // of view as page size changed. disableSortBy hides
                            // the misleading per-page sort icon.
                            disableSortBy: true,
                        },
                    ],
                    enableGlobalSearch: false,
                    enableColumnSort: true,
                    resultsJsonPath: "items",
                },
                children: {},
                show: true
            },
            links: {
                uiConfig: {
                    links: [
                        {
                            text: "ES_PGR_NEW_COMPLAINT",
                            url: "/employee/pgr/create-complaint",
                            roles: ["SUPERUSER", "PGR-ADMIN", "PGR_ADMIN", "HELPDESK_USER"],
                            hyperlink: true,
                        },
                    ],
                    label: "CS_COMMON_HOME_COMPLAINTS",
                    logoIcon: {
                        component: "ReceiptInboxIcon",
                        customClass: "inbox-search-icon--projects"
                    }
                },
                children: {},
                show: true
            },
            filter: {
                uiConfig: {
                    type: 'filter',
                    headerStyle: null,
                    primaryLabel: 'ES_COMMON_APPLY',
                    formClassName: "filter",
                    secondaryLabel: 'ES_CLEAR_ALL',
                    minReqFields: 0,
                    defaultValues: {
                        locality: null,
                        assignedToMe: {
                            "code": "ASSIGNED_TO_ALL",
                            "name": "ASSIGNED_TO_ALL"
                        },
                        status: null,
                        complaintType: null,
                        serviceCode:null,

                    },
                    fields: [
                        {
                            label: "",
                            type: "radio",
                            isMandatory: false,
                            disable: false,
                            populators: {
                                name: "assignedToMe",
                                options: [
                                    { code: "ASSIGNED_TO_ME", name: "ASSIGNED_TO_ME" },
                                    { code: "ASSIGNED_TO_ALL", name: "ASSIGNED_TO_ALL" },
                                ],
                                optionsKey: "name",
                                styles: {
                                    "gap": "1rem",
                                    "flexDirection": "column"
                                },
                                innerStyles: {
                                    "display": "flex"
                                }
                            },

                        },
                        {

                            label: "CS_COMPLAINT_DETAILS_COMPLAINT_SUBTYPE",
                            isMandatory: false,
                            key: "serviceCode",
                            type: "dropdown",
                            disable: false,
                            preProcess: {
                                updateDependent: ["populators.options"]
                            },
                            populators: {
                                name: "serviceCode",
                                optionsKey: "i18nKey",
                                defaultText: '',
                                selectedText: "COMMON_SELECTED",
                                allowMultiSelect: false,
                                options: [],
                                isDropdownWithChip: false
                            }
                        },
                        {

                            label: "",
                            isMandatory: false,
                            key: "locality",
                            type: "component",
                            component: "PGRBoundaryComponent",
                            disable: false,
                            populators: {
                                name: "locality",
                            }
                        },
                        {
                            label: "ES_PGR_FILTER_STATUS",
                            type: "workflowstatesfilter",
                            labelClassName: "checkbox-status-filter-label",
                            isMandatory: false,
                            disable: false,
                            populators: {
                                name: "status",
                                labelPrefix: "CS_COMMON_",
                                businessService: "PGR",
                                onlylabelPrefix: true
                            }
                        },
                    ]
                },
                label: "ES_COMMON_FILTER_BY",
                show: true
            },
        },
        additionalSections: {}
    };
};

export default PGRSearchInboxConfig;