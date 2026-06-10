package org.egov.pgr.util;

/**
 * Enumerates the reasons the escalation scheduler may decide NOT to escalate a
 * given complaint. Surfaced in structured log lines, OTEL span attributes and
 * the synchronous {@code /escalation/_trigger} response so operators can tell
 * exactly why a scan that touched N complaints escalated only M of them.
 */
public enum EscalationSkipReason {

    /** Complaint is already at or above the configured max escalation depth. */
    MAX_DEPTH_REACHED("Complaint already at or above max escalation depth"),

    /** AuditDetails has neither lastModifiedTime nor createdTime; can't compute SLA elapsed. */
    NO_LAST_MODIFIED_TIME("Complaint has no last-modified or created timestamp"),

    /** Elapsed time since lastModified is still under the resolved SLA. */
    SLA_NOT_BREACHED("SLA window has not yet elapsed since last modification"),

    /** Workflow process instance returned no current assignees to escalate from. */
    NO_ASSIGNEES("No current assignees on the workflow to escalate from"),

    /** None of the current assignees has a reportingTo set in HRMS. */
    NO_SUPERVISOR_IN_HRMS("No supervisor (reportingTo) found in HRMS for any current assignee"),

    /** egov-workflow-v2 rejected the ESCALATE transition (validation/state mismatch). */
    WORKFLOW_TRANSITION_FAILED("Workflow service rejected the ESCALATE transition"),

    /**
     * Complaint could not be mapped to a (path, category, subcategoryL1) tuple
     * needed to look up its CRS.CategorySLA row. Falls through to CRS.StateSLA
     * or the v0 EscalationConfig, but the warning is surfaced so operators can
     * complete the mapping in the Category SLA Matrix editor.
     */
    UNMAPPED_CATEGORY("Complaint could not be mapped to a CRS.CategorySLA row (path/category/subcategoryL1)"),

    /**
     * The workflow state on the complaint has no entry in CRS.WorkflowStateMapping
     * AND CRS.StateSLA has no matching key either — so the scheduler cannot resolve
     * which SLA column applies. Operators see this when they bring up a new
     * workflow (or rename a state) without updating the mapping singleton.
     */
    STATE_MAPPING_MISSING("Workflow state has no mapping in CRS.WorkflowStateMapping and no CRS.StateSLA fallback"),

    /**
     * Role escalation is enabled but the unattended complaint's workflow state
     * has no entry in roleEscalation.actingRoleByState — the scheduler cannot
     * tell which role "owes action" in that state. Operators add the mapping
     * under Escalation behaviour in Settings.
     */
    ROLE_NOT_MAPPED("Unattended complaint's workflow state has no acting-role mapping"),

    /**
     * The role-target resolution (pin / ladder / reportingTo consensus) found
     * two or more candidates and refuses to guess — the misroute would be
     * invisible and unexplainable. Operators pin a CRS.RoleSupervisors row or
     * fix the HRMS data.
     */
    ROLE_SUPERVISOR_AMBIGUOUS("Two or more candidates matched for the role's escalation target"),

    /**
     * The role-target resolution exhausted every strategy (pin, ladder,
     * reportingTo consensus — including the tenant-wide department fallback)
     * without finding a single candidate. Operators create/activate the
     * supervisor in HRMS or pin a CRS.RoleSupervisors row.
     */
    NO_ROLE_SUPERVISOR("No candidate found anywhere for the role's escalation target"),

    /** Sentinel: escalation completed successfully (used in span attrs / response payloads). */
    SUCCESS("Escalation performed successfully");

    private final String description;

    EscalationSkipReason(String description) {
        this.description = description;
    }

    public String getDescription() {
        return description;
    }
}
