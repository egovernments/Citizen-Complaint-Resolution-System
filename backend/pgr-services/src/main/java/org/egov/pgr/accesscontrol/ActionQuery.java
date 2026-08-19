package org.egov.pgr.accesscontrol;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonInclude;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * One action a caller wants a decision for — mirrors egov-accesscontrol's own
 * {@code org.egov.access.web.contract.policy.ActionQuery} exactly. {@code key} is PGR's own
 * correlation handle, echoed back verbatim on the matching {@code PolicyDecision}; it never
 * participates in the decision itself, so PGR is free to set it to whatever is stable and
 * traceable — here, the same value as {@code url}.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonInclude(JsonInclude.Include.NON_NULL)
@JsonIgnoreProperties(ignoreUnknown = true)
public class ActionQuery {
    private String key;
    private String method;
    private String url;
    private String resourceType;
}
