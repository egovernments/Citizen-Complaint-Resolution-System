package org.egov.userpreference.web.model;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Consent settings for one channel.
 *
 * <p>{@code status} and {@code scope} are {@code String}s, not enums — see
 * {@link ConsentStatus} for why. This type exists only to validate the
 * {@code USER_NOTIFICATION_PREFERENCES} payload; the payload itself is stored
 * and returned as the caller's original JSON.
 */
@Data
@AllArgsConstructor
@NoArgsConstructor
@Builder
@JsonInclude(JsonInclude.Include.NON_EMPTY)
public class ConsentPolicy {

    @JsonProperty("status")
    private String status;

    @JsonProperty("scope")
    private String scope;

    @JsonProperty("tenantId")
    private String tenantId;
}
