package org.egov.userpreference.web.model;

import com.fasterxml.jackson.annotation.JsonAlias;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * {@code _upsert} request envelope.
 *
 * <p>The wrapper key is {@code RequestInfo} per the DIGIT standard, but
 * novu-bridge's {@code PreferenceServiceClient} posts {@code requestInfo} and
 * the Go service accepted it because {@code encoding/json} matches keys
 * case-insensitively. {@code spring.jackson.mapper.accept-case-insensitive-properties}
 * restores that tolerance service-wide; the explicit {@link JsonAlias} keeps
 * this specific, in-production spelling working even for a mapper built
 * without that flag (as in a plain unit test).
 *
 * <p>Neither field is bean-validated on purpose: the Go service reported a
 * missing envelope as {@code INVALID_REQUEST_INFO} / {@code INVALID_REQUEST}
 * from its own validator, and a {@code @NotNull} here would pre-empt that with
 * a generic {@code INVALID_FIELD} instead.
 */
@Data
@AllArgsConstructor
@NoArgsConstructor
@Builder
public class PreferenceRequest {

    @JsonProperty("RequestInfo")
    @JsonAlias("requestInfo")
    private RequestInfo requestInfo;

    @JsonProperty("preference")
    private Preference preference;
}
