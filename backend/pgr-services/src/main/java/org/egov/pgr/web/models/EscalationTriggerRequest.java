package org.egov.pgr.web.models;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.egov.common.contract.request.RequestInfo;

import java.util.List;

/**
 * Body of {@code POST /pgr-services/escalation/_trigger}. Lets a SUPERUSER
 * synchronously kick the scheduler (no Kafka), optionally scoped to a subset
 * of serviceRequestIds.
 */
@Getter
@Setter
@AllArgsConstructor
@NoArgsConstructor
@Builder
public class EscalationTriggerRequest {

    @JsonProperty("RequestInfo")
    private RequestInfo requestInfo;

    @JsonProperty("tenantId")
    private String tenantId;

    /** Optional: scope the scan to these serviceRequestIds. Null/empty = scan all candidates. */
    @JsonProperty("serviceRequestIds")
    private List<String> serviceRequestIds;

    /** Optional: when true, report would-be escalations without mutating anything. */
    @JsonProperty("dryRun")
    private Boolean dryRun;
}
