package org.egov.pgr.accesscontrol;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonInclude;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/** Mirrors egov-accesscontrol's {@code ResourceInput} exactly. {@code id} is PGR's own handle (the row's {@code Service#getId()}), echoed back verbatim on the matching {@code ResourceDecision}. */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonInclude(JsonInclude.Include.NON_NULL)
@JsonIgnoreProperties(ignoreUnknown = true)
public class ResourceInput {
    private String id;
    private ResourceAttributes attributes;
}
