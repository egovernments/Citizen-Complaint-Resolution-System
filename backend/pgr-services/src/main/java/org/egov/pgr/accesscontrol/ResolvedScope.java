package org.egov.pgr.accesscontrol;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonInclude;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * Mirrors egov-accesscontrol's {@code ResolvedScope} exactly — the row-scope a PEP must apply for
 * one action, fully resolved server-side. It is a DECISION, not an input: nothing here is echoed
 * from the request, and PGR can only narrow within it, never widen.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonInclude(JsonInclude.Include.NON_NULL)
@JsonIgnoreProperties(ignoreUnknown = true)
public class ResolvedScope {
    private ScopeEffect effect;
    private TenantScope tenant;

    /**
     * When non-empty, the caller may only see rows owned by one of these accounts. Empty means "no
     * ownership restriction" — NOT the same as unrestricted, since {@link #axes} can still apply.
     */
    @Builder.Default
    private List<String> citizenUuids = List.of();

    private ScopeAxes axes;
}
