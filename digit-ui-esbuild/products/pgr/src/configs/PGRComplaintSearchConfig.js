import Urls from "../utils/urls";

const PGRComplaintSearchConfig = () => {
    const tenantId = Digit.ULBService.getCurrentTenantId();
    return {
        label: "PGR_SEARCH_COMPLAINT",
        type: "inbox",
        customHookName: "pgr.usePGRInboxSearch",   // reuse — same _search API
        apiDetails: {
            serviceName: Urls.pgr.search,
            requestParam: { tenantId, limit: 10, offset: 0, sortBy: "applicationStatus", sortOrder: "DESC" },
            requestBody: {},
            minParametersForSearchForm: 0,
            minParametersForFilterForm: 0,
            masterName: "commonUiConfig",
            moduleName: "PGRComplaintSearchConfig",   // NEW key → its own preProcess (Step 2)
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
                    totalCountJsonPath: "totalCount",
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
                    type: "filter",
                    headerStyle: null,
                    primaryLabel: "ES_COMMON_APPLY",
                    formClassName: "filter",
                    secondaryLabel: "ES_CLEAR_ALL",
                    minReqFields: 0,
                    defaultValues: {
                        department: null,
                        SelectComplaintType: null,
                        SelectSubComplaintType: null,
                        assignee: null,
                        locality: null,
                        status: null,
                    },
                    fields: [
                        // 1) Department — drives the Assignee list.
                        {
                            label: "PGR_FILTER_DEPARTMENT",
                            isMandatory: false,
                            key: "department",
                            type: "component",
                            component: "PGRDepartmentComponent",
                            disable: false,
                            populators: { name: "department" },
                        },
                        // 2) Assignee — sits directly under Department. Dependent:
                        //    employees load only after a Department is picked
                        //    (dependsOnKey), scoped to that department; disabled until then.
                        {
                            label: "PGR_FILTER_ASSIGNEE",
                            isMandatory: false,
                            key: "assignee",
                            type: "component",
                            component: "PGRAssigneeComponent",
                            disable: false,
                            populators: {
                                name: "assignee",
                                dependsOnKey: "department",
                                roles: ["PGR_LME", "GRO", "DGRO", "PGR_VIEWER", "SUPERVISOR"],
                            },
                        },
                        // 3) Complaint type — hierarchy cascade (Category / Sub Category…).
                        //    Labels shown. key MUST match what the component writes
                        //    (SelectSubComplaintType) so the value registers + submits.
                        {
                            label: "CS_ADDCOMPLAINT_COMPLAINT_TYPE",
                            isMandatory: false,
                            key: "SelectSubComplaintType",
                            type: "component",
                            component: "PGRComplaintHierarchyComponent",
                            disable: false,
                            populators: { name: "SelectSubComplaintType" },
                        },
                        // 4) Provincia (required) — boundary. Label left empty: the boundary
                        //    component renders its own "Província" label (avoids a duplicate).
                        {
                            label: "",
                            isMandatory: true,
                            key: "locality",
                            type: "component",
                            component: "PGRBoundaryComponent",
                            disable: false,
                            populators: { name: "locality" },
                        },
                        // 5) Status — dynamic dropdown from the PGR BusinessService states
                        {
                            label: "ES_PGR_FILTER_STATUS",
                            isMandatory: false,
                            key: "status",
                            type: "component",
                            component: "PGRStatusDropdownComponent",
                            disable: false,
                            populators: { name: "status", businessService: "PGR" },
                        },
                    ],
                },
                label: "ES_COMMON_FILTER_BY",
                show: true,
            },
        },
        additionalSections: {},
    };
};

export default PGRComplaintSearchConfig;