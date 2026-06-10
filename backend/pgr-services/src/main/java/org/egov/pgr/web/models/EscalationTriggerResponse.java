package org.egov.pgr.web.models;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.egov.common.contract.response.ResponseInfo;

import java.util.List;
import java.util.Map;

/**
 * Response body for synchronous escalation trigger. Mirrors the per-scan stats
 * the scheduler also emits via OTEL span attributes, plus a per-complaint trail
 * so the caller (test harness, configurator) can assert exactly what happened.
 */
@Getter
@Setter
@AllArgsConstructor
@NoArgsConstructor
@Builder
public class EscalationTriggerResponse {

    @JsonProperty("ResponseInfo")
    private ResponseInfo responseInfo;

    @JsonProperty("tenantId")
    private String tenantId;

    @JsonProperty("scanned")
    private int scanned;

    @JsonProperty("escalated")
    private int escalated;

    /**
     * Dry-run only: breached complaints that WOULD have been escalated.
     * Always 0 on real runs; conversely {@code escalated} stays 0 on dry runs.
     */
    @JsonProperty("wouldEscalate")
    private int wouldEscalate;

    @JsonProperty("skipped")
    private int skipped;

    /** Echo of the request's dryRun flag — true means nothing was mutated. */
    @JsonProperty("dryRun")
    private boolean dryRun;

    /**
     * Live scans: pre-breach warnings emitted this tick (crossing detection —
     * each complaint warns once per level, on the tick its elapsed time
     * crosses the threshold). Dry runs: complaints currently inside the
     * warning window [threshold, SLA) — nothing is emitted.
     */
    @JsonProperty("preBreachWarnings")
    private int preBreachWarnings;

    /** Histogram of skip reason → count (keys are {@link org.egov.pgr.util.EscalationSkipReason} names). */
    @JsonProperty("skipBreakdown")
    private Map<String, Integer> skipBreakdown;

    /** Per-complaint outcome. */
    @JsonProperty("details")
    private List<EscalationOutcome> details;

    @Getter
    @Setter
    @AllArgsConstructor
    @NoArgsConstructor
    @Builder
    public static class EscalationOutcome {

        @JsonProperty("serviceRequestId")
        private String serviceRequestId;

        /** "ESCALATED", "SKIPPED" or (dry-run only) "WOULD_ESCALATE". */
        @JsonProperty("action")
        private String action;

        /** EscalationSkipReason name. "SUCCESS" when action=ESCALATED. */
        @JsonProperty("reason")
        private String reason;

        /** Optional free-text diagnostic (e.g. elapsed=12345ms, sla=600000ms). */
        @JsonProperty("detail")
        private String detail;

        /**
         * Winning SLA-resolution layer for this complaint, one of
         * {@link org.egov.pgr.util.PGRConstants#SLA_SOURCE_CATEGORY_LEVEL},
         * {@link org.egov.pgr.util.PGRConstants#SLA_SOURCE_CATEGORY},
         * {@link org.egov.pgr.util.PGRConstants#SLA_SOURCE_POLICY_LEVEL},
         * {@link org.egov.pgr.util.PGRConstants#SLA_SOURCE_STATE} or
         * {@link org.egov.pgr.util.PGRConstants#SLA_SOURCE_V0}. Null on
         * MAX_DEPTH_REACHED (decided before resolution runs) and
         * NO_LAST_MODIFIED_TIME (resolution ran, but without a timestamp no
         * SLA comparison was possible, so the source is not reported).
         */
        @JsonProperty("slaSource")
        private String slaSource;

        /**
         * Role-escalation provenance (PRD primary journey): which strategy
         * picked the target — "R1_PIN" (CRS.RoleSupervisors), "R2_LADDER"
         * (supervisorRoleByRole) or "R3_REPORTING" (reportingTo consensus).
         * Set on every role-path outcome (escalated, would-escalate and role
         * skips); null on the named-assignee path.
         */
        @JsonProperty("resolutionStrategy")
        private String resolutionStrategy;

        /** Role that owed action in the complaint's workflow state. Null on the named-assignee path. */
        @JsonProperty("actingRole")
        private String actingRole;

        /** How many candidates the winning/failing resolution strategy matched. Null on the named-assignee path. */
        @JsonProperty("candidateCount")
        private Integer candidateCount;

        /**
         * Whether the candidate search was restricted to the complaint's
         * ServiceDefs department — false when the tenant-wide retry fired (or
         * no department existed). Null on the named-assignee path.
         */
        @JsonProperty("departmentFiltered")
        private Boolean departmentFiltered;
    }
}
