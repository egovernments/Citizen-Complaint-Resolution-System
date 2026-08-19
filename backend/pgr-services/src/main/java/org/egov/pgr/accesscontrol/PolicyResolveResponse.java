package org.egov.pgr.accesscontrol;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.egov.common.contract.response.ResponseInfo;

import java.util.List;
import java.util.Optional;

/** Response body of {@code POST /access/v1/policy/_resolve} — mirrors egov-accesscontrol's {@code PolicyResolveResponse} exactly. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonIgnoreProperties(ignoreUnknown = true)
public class PolicyResolveResponse {
    @JsonProperty("ResponseInfo")
    private ResponseInfo responseInfo;
    private List<PolicyDecision> decisions;

    /** Lookup by {@link PolicyDecision#getKey()}. Only meaningful after
     *  {@link AccessControlDecisionClient} has validated this response (no duplicate/unexpected keys). */
    public Optional<PolicyDecision> decisionFor(String key) {
        if (decisions == null)
            return Optional.empty();
        return decisions.stream().filter(d -> key.equals(d.getKey())).findFirst();
    }
}
