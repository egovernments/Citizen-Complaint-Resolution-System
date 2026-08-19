package org.egov.pgr.accesscontrol;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonInclude;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Mirrors egov-accesscontrol's {@code ResourceAttributes} exactly — a CLOSED set of named fields,
 * deliberately not a free-form map, so PGR can never satisfy a condition by inventing an attribute
 * name and never has to know what the PDP does with these.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
@JsonInclude(JsonInclude.Include.NON_NULL)
@JsonIgnoreProperties(ignoreUnknown = true)
public class ResourceAttributes {
    private String accountId;
    private String department;
    private String boundary;
}
