package org.egov.userpreference.web.model;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Response metadata block (DIGIT standard).
 *
 * <p>{@code NON_EMPTY} mirrors the {@code omitempty} tags the Go service
 * carried on every field, so an absent {@code apiId}/{@code msgId} on the way
 * in stays absent on the way out rather than surfacing as {@code null}.
 */
@Data
@AllArgsConstructor
@NoArgsConstructor
@Builder
@JsonInclude(JsonInclude.Include.NON_EMPTY)
public class ResponseInfo {

    @JsonProperty("apiId")
    private String apiId;

    @JsonProperty("ver")
    private String ver;

    @JsonProperty("ts")
    private Long ts;

    @JsonProperty("resMsgId")
    private String resMsgId;

    @JsonProperty("msgId")
    private String msgId;

    @JsonProperty("status")
    private String status;
}
