/**
 * Config for the employee "Search Citizen Complaint" screen (/employee/pgr/search).
 *
 * Sibling of PGRSearchInboxConfig (the /inbox-v2 screen) — same InboxSearchComposer
 * machinery and the same pgr-services `_search`, but a pure SEARCH surface: results
 * are driven entirely by the filters the operator applies. The differences vs the
 * inbox config:
 *   - filter fields match the reference mock: Department, Complaint Type (hierarchy
 *     cascade), Assigned (employee), Província (boundary), Status.
 *   - no "assigned to me" radio (this screen searches ALL complaints).
 *   - moduleName "PGRComplaintSearchConfig" → its own UICustomizations.preProcess,
 *     which (unlike the inbox) does NOT force an open-states default on Status, so an
 *     empty Status filter returns every matching complaint.
 */

import Urls from "../utils/urls";

const PGRComplaintSearchConfig = () => {
  const tenantId = Digit.ULBService.getCurrentTenantId();
  return {
    label: "PGR_SEARCH_COMPLAINT",
    type: "inbox",
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
      moduleName: "PGRComplaintSearchConfig",
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
            mobileNumber: "",
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
                error: `ESTIMATE_PATTERN_ERR_MSG`,
                validation: { pattern: "PG-PGR-\d{4}-\d{2}-\d{2}-\d{6}", minlength: 2 },
              },
            },
            {
              label: "CS_COMMON_MOBILE_NO",
              type: "text",
              isMandatory: false,
              disable: false,
              populators: {
                name: "mobileNumber",
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
      searchResult: {
        label: "",
        uiConfig: {
          // Column-header sort is client-side react-table (reorders only the
          // current page while pagination is server-side), so it's disabled on
          // every column — ordering is done server-side in preProcess.
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
              label: "WF_INBOX_HEADER_LOCALITY",
              jsonPath: "businessObject.service.address.locality.code",
              additionalCustomization: true,
              disableSortBy: true,
            },
            {
              label: "CS_COMPLAINT_DETAILS_CURRENT_STATUS",
              jsonPath: "businessObject.service.applicationStatus",
              additionalCustomization: true,
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
            // Department — resolves to the department's serviceCodes server-side.
            {
              label: "ES_PGR_FILTER_DEPARTMENT",
              isMandatory: false,
              key: "department",
              type: "component",
              component: "PGRDepartmentComponent",
              disable: false,
              populators: {
                name: "department",
              },
            },
            // Assigned — employee the complaint is currently assigned to. Placed
            // directly below Department and DEPENDENT on it (dependsOnKey):
            // disabled until a department is chosen, and the employee list is
            // scoped to the chosen department. Clears when the department changes.
            {
              label: "PGR_FILTER_ASSIGNEE",
              isMandatory: false,
              key: "assignee",
              type: "component",
              component: "PGRAssigneeComponent",
              disable: false,
              populators: {
                name: "assignee",
                roles: ["PGR_LME", "GRO", "DGRO", "CSR"],
                dependsOnKey: "department",
              },
            },
            // Complaint Type — hierarchy cascade (Category / Sub Category…). The
            // component writes SelectComplaintType + SelectSubComplaintType; the
            // field key MUST match the name the component writes for the value to
            // reach filterForm, so it's keyed on SelectSubComplaintType.
            {
              label: "CS_COMPLAINT_TYPE",
              isMandatory: false,
              key: "SelectSubComplaintType",
              type: "component",
              component: "PGRComplaintHierarchyComponent",
              disable: false,
              populators: {
                name: "SelectSubComplaintType",
                // Search-only: leave a truthy marker on the bound field for a
                // partial (non-leaf) pick so "Clear All" can reset the cascade.
                emitPartialSelection: true,
              },
            },
            // Província — boundary cascade (renders its own labels).
            {
              label: "",
              isMandatory: false,
              key: "locality",
              type: "component",
              component: "PGRBoundaryComponent",
              disable: false,
              populators: {
                name: "locality",
              },
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
                onlylabelPrefix: true,
              },
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
