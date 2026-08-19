package org.egov.pgr.accesscontrol;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonInclude;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Map;

/**
 * Mirrors egov-accesscontrol's {@code FieldObligation} exactly — an instruction to hide one field
 * of one row before it leaves the PEP. Obligations are emitted only for fields the policy DENIED; a
 * field the caller may see produces no obligation at all. PGR applies this mechanically via
 * {@link MaskingStrategy#apply} — it never interprets what the strategy means.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonInclude(JsonInclude.Include.NON_NULL)
@JsonIgnoreProperties(ignoreUnknown = true)
public class FieldObligation {
    /** Dotted path of the field on the PEP's own response object, e.g. {@code citizen.mobileNumber}. */
    private String path;
    private ObligationType type;

    @Builder.Default
    private Map<String, Object> params = Map.of();
}
