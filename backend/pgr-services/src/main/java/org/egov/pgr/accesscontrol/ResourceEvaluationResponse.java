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

/**
 * Response body of {@code POST /access/v1/policy/resources/_evaluate} — mirrors
 * egov-accesscontrol's {@code ResourceEvaluationResponse} exactly. {@code decision} is the
 * action-level decision (may this caller invoke this action at all); {@code results} is one entry
 * per submitted {@link ResourceInput}, correlated by {@code id}.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonIgnoreProperties(ignoreUnknown = true)
public class ResourceEvaluationResponse {
    @JsonProperty("ResponseInfo")
    private ResponseInfo responseInfo;
    private PolicyDecision decision;
    private List<ResourceDecision> results;

    /** Lookup by {@link ResourceDecision#getId()}. Only meaningful after
     *  {@link AccessControlDecisionClient} has validated this response (no duplicate/unexpected ids). */
    public Optional<ResourceDecision> resultFor(String id) {
        if (results == null)
            return Optional.empty();
        return results.stream().filter(r -> id.equals(r.getId())).findFirst();
    }
}
