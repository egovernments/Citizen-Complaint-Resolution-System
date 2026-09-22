package org.egov.pgr.util;

import lombok.NoArgsConstructor;
import org.springframework.stereotype.Component;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;

@Component
@NoArgsConstructor
public class PGRConstants {


    public static final String PGR_BUSINESSSERVICE = "PGR";

    public static final String USERTYPE_EMPLOYEE = "EMPLOYEE";

    public static final String USERTYPE_CITIZEN = "CITIZEN";

    public static final String PGR_MODULENAME = "PGR";

    public static final String PGR_WF_REOPEN = "REOPEN";

    public static final String MDMS_SERVICEDEF = "ComplaintHierarchy";

    public static final String MDMS_MODULE_NAME = "RAINMAKER-PGR";

    public static final String MDMS_COMMON_MASTERS_MODULE_NAME = "common-masters";

    public static final String MDMS_DEPT_MASTER = "Department";

    // Access-control policy conditions (Tier-2 PDP source of truth) — see org.egov.pgr.policy.
    // Resolved via egov-accesscontrol's own /access/v1/actions/mdms/_get API (role-scoped), not a
    // raw MDMS call, so only the actionMaster name is needed here.
    public static final String MDMS_ACCESSCONTROL_ACTIONS_MASTER = "actions-test";

    // Leaf complaint types now live in the merged ComplaintHierarchy master; a leaf is matched by its
    // `code` (== the serviceCode stored on a complaint). Codes are globally unique across the merged
    // interior+leaf keyspace (enforced by the masters migration), so matching `code` is unambiguous.
    public static final String MDMS_SERVICEDEF_SEARCH = "$.MdmsRes.RAINMAKER-PGR.ComplaintHierarchy[?(@.code=='{SERVICEDEF}')]";

    public static final String MDMS_DEPARTMENT_SEARCH = "$.MdmsRes.RAINMAKER-PGR.ComplaintHierarchy[?(@.code=='{SERVICEDEF}')].department";

    public static final String MDMS_DEPARTMENT_NAME_SEARCH = "$.MdmsRes.common-masters.Department[?(@.code=='{CODE}')].name";

    public static final String MDMS_SERVICENAME_SEARCH = "$.MdmsRes.RAINMAKER-PGR.ComplaintHierarchy[?(@.code=='{SERVICEDEF}')].name";

    public static final String HRMS_DEPARTMENT_JSONPATH = "$.Employees.*.assignments.*.department";

    public static final String HRMS_DESIGNATION_JSONPATH = "$.Employees.*.assignments[?(@.department=='{department}')].designation";

    public static final String HRMS_EMP_NAME_JSONPATH = "$.Employees.*.user.name";

    public static final String PENDING_FOR_REASSIGNMENT = "PENDINGFORREASSIGNMENT";


    public static final String PENDINGATLME = "PENDINGATLME";

    public static final String REASSIGN = "REASSIGN";

    public static final String REJECT = "REJECT";

    public static final String REJECTED = "REJECTED";

    public static final String PENDINGFORASSIGNMENT = "PENDINGFORASSIGNMENT";

    public static final String RESOLVED = "RESOLVED";

    public static final String CLOSED_AFTER_RESOLUTION = "CLOSEDAFTERRESOLUTION";

    public static final String CLOSED_AFTER_REJECTION = "CLOSEDAFTERREJECTION";

    public static final String RATE = "RATE";

    public static final String APPLY = "APPLY";

    public static final String CITIZEN = "CITIZEN";

    public static final String EMPLOYEE = "EMPLOYEE";

    public static final String COMMENT = "COMMENT";

    public static final String COMMENT_DEFAULT = "COMMENT_DEFAULT";

    public static final String DEFAULT = "DEFAULT";


    public static final String ASSIGN = "ASSIGN";


    public static final String NOTIFICATION_LOCALE = "en_IN";

    public static final String PGR_MODULE = "rainmaker-pgr";

    public static final String COMMON_MODULE = "rainmaker-common";

    public static final String DATE_PATTERN = "dd/MM/yyyy";

    public static final String PGR_WF_RESOLVE = "RESOLVE";

    public static final String USREVENTS_EVENT_TYPE = "SYSTEMGENERATED";

    public static final String USREVENTS_EVENT_NAME = "PGR";

    public static final String USREVENTS_EVENT_POSTEDBY = "SYSTEM-PGR";

    public static final String IMAGE_DOCUMENT_TYPE = "PHOTO";

    public static final String MDMS_DATA_JSONPATH = "$.MdmsRes.RAINMAKER-PGR.ComplaintHierarchy";

    // Leaf rows key the serviceCode in the merged master's `code` field.
    public static final String MDMS_DATA_SERVICE_CODE_KEYWORD = "code";

    public static final String MDMS_DATA_SLA_KEYWORD = "slaHours";

    // --- Reopen window (RAINMAKER-PGR.UIConstants.REOPENSLA) ---
    // REOPENSLA is the millisecond window after resolution/rejection during which a complaint
    // may still be reopened. It is the single source of truth for both the citizen and the
    // employee/CSR path — the UI gates on it and validateReOpen() enforces it server-side.
    public static final String MDMS_UI_CONSTANTS_MASTER = "UIConstants";
    public static final String MDMS_UI_CONSTANTS_JSONPATH = "$.MdmsRes.RAINMAKER-PGR.UIConstants";
    public static final String MDMS_REOPEN_SLA_KEYWORD = "REOPENSLA";

    // --- Thin notification events (docs/2.20/notifications/contract/thin-event-v1.schema.json) ---
    // The four RAINMAKER-PGR.Notification* masters are novu-bridge's now, not this service's: the
    // producer names no audience, picks no channel and reads no routing row. What is left is the
    // vocabulary that goes ON the event.

    // ActorRef.type on the two actors a complaint has.
    public static final String AUDIENCE_CITIZEN = "CITIZEN";
    public static final String AUDIENCE_EMPLOYEE = "EMPLOYEE";

    // Event-name prefix: <prefix><ACTION>.<TOSTATE> is the config key, <prefix><ACTION> the ledger
    // label the Logs screen has been filtering on for releases.
    public static final String EVENT_NAME_PREFIX = "COMPLAINTS.WORKFLOW.";

    public static final String COMPLAINTS_RESOLVED = "complaintsResolved";

    public static final String AVERAGE_RESOLUTION_TIME = "averageResolutionTime";

    public static final String TENANTID_MDC_STRING = "TENANTID";

    public static String SCHEMA_REPLACE_STRING = "{schema}";

    public static final String DESIGNATION = "designation";

    public static final String DEPARTMENT = "department";

    public static final String ESCALATE = "ESCALATE";

    // One escalation policy master under RAINMAKER-PGR (MDMS v2 schema code
    // RAINMAKER-PGR.EscalationConfig). The JSONPath constant is where that
    // master lands in an MdmsRes payload.
    public static final String MDMS_ESCALATION_CONFIG = "EscalationConfig";

    // MDMS master under module RAINMAKER-PGR (mdms-v2 schema code
    // RAINMAKER-PGR.InboxVisibilityConfig, seeded by default-data-handler):
    // the per-tenant visibility feature flag + resolver config. The JSONPATH
    // constant is where that master lands in an MdmsRes payload.
    public static final String MDMS_INBOX_VISIBILITY_CONFIG = "InboxVisibilityConfig";

    public static final String MDMS_INBOX_VISIBILITY_CONFIG_JSONPATH = "$.MdmsRes.RAINMAKER-PGR.InboxVisibilityConfig";

    public static final String MDMS_ESCALATION_CONFIG_JSONPATH = "$.MdmsRes.RAINMAKER-PGR.EscalationConfig";

    public static final String HRMS_REPORTING_TO_JSONPATH = "$.Employees[0].assignments[?(@.isCurrentAssignment==true)].reportingTo";

    // Extended attributes — complaint category config and field schemas
    public static final String MDMS_COMPLAINT_RELATED_TO_MAP = "ComplaintRelatedToMap";
    public static final String MDMS_COMPLAINT_TEMPLATE_TYPE  = "ComplaintTemplateType";
    public static final String MDMS_COMPLAINT_SCHEMA         = "ComplaintExtendedAttributeSchema";

    public static final String ROLE_CONFIDENTIAL_VIEWER = "CONFIDENTIAL_COMPLAINT_VIEWER";

    // Placeholder written over dynamic fields the caller isn't authorized to see in plaintext.
    public static final String MASK_SENTINEL = "****";

}
