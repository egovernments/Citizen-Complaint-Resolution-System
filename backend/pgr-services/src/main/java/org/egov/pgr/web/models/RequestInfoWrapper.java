package org.egov.pgr.web.models;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.*;

/**
 * Thin wrapper used by search and count endpoints.
 * Auth context comes from the JWT; this carries only optional metadata.
 */
@Getter
@Setter
@AllArgsConstructor
@NoArgsConstructor
@Builder
public class RequestInfoWrapper {

    @JsonProperty("userType")
    private String userType;
}
