package org.egov.userpreference.web.model;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * Error envelope.
 *
 * <p>The key casing is the Go service's and is load-bearing for existing
 * callers: {@code responseInfo} is lower-camel here (unlike the
 * {@code ResponseInfo} that digit-config-service emits) and the error list is
 * capital-{@code Errors}.
 */
@Data
@AllArgsConstructor
@NoArgsConstructor
@Builder
public class ErrorResponse {

    @JsonProperty("responseInfo")
    @JsonInclude(JsonInclude.Include.NON_NULL)
    private ResponseInfo responseInfo;

    @JsonProperty("Errors")
    private List<Error> errors;

    @Data
    @AllArgsConstructor
    @NoArgsConstructor
    @Builder
    @JsonInclude(JsonInclude.Include.NON_EMPTY)
    public static class Error {

        @JsonProperty("code")
        @JsonInclude(JsonInclude.Include.ALWAYS)
        private String code;

        @JsonProperty("message")
        @JsonInclude(JsonInclude.Include.ALWAYS)
        private String message;

        @JsonProperty("description")
        private String description;
    }
}
