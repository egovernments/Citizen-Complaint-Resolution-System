package org.egov.pgr.accesscontrol;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonInclude;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Mirrors egov-accesscontrol's {@code PolicyDecision} exactly — the decision for one
 * {@link ActionQuery}. {@code allowed} answers "may this caller invoke this action at all";
 * {@code scope} answers "which rows may they see when they do". The two are independent: an
 * allowed action can still carry a {@code ScopeEffect#DENY} scope.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonInclude(JsonInclude.Include.NON_NULL)
@JsonIgnoreProperties(ignoreUnknown = true)
public class PolicyDecision {
    private String key;
    private boolean allowed;
    private String reason;
    private ResolvedScope scope;
}
