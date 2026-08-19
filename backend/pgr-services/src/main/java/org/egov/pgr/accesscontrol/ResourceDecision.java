package org.egov.pgr.accesscontrol;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonInclude;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * Mirrors egov-accesscontrol's {@code ResourceDecision} exactly — the decision for one submitted
 * row, correlated back to its {@link ResourceInput} by {@code id}. A denied row carries obligations
 * for every configured field too, so a PEP that honours obligations but mishandles {@code allowed}
 * still cannot leak that row's protected fields.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonInclude(JsonInclude.Include.NON_NULL)
@JsonIgnoreProperties(ignoreUnknown = true)
public class ResourceDecision {
    private String id;
    private boolean allowed;
    private String reason;

    @Builder.Default
    private List<FieldObligation> obligations = List.of();
}
