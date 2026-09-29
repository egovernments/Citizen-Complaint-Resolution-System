package org.egov.userpreference.web.model;

import com.fasterxml.jackson.annotation.JsonAlias;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * {@code _search} request envelope. See {@link PreferenceRequest} for why
 * {@code RequestInfo} carries a lower-camel alias and why neither field is
 * bean-validated.
 */
@Data
@AllArgsConstructor
@NoArgsConstructor
@Builder
public class PreferenceSearchRequest {

    @JsonProperty("RequestInfo")
    @JsonAlias("requestInfo")
    private RequestInfo requestInfo;

    @JsonProperty("criteria")
    private PreferenceCriteria criteria;
}
