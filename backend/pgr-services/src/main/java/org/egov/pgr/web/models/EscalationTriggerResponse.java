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

    @JsonProperty("skipped")
    private int skipped;

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

        /** Either "ESCALATED" or "SKIPPED". */
        @JsonProperty("action")
        private String action;

        /** EscalationSkipReason name. "SUCCESS" when action=ESCALATED. */
        @JsonProperty("reason")
        private String reason;

        /** Optional free-text diagnostic (e.g. elapsed=12345ms, sla=600000ms). */
        @JsonProperty("detail")
        private String detail;
    }
}
