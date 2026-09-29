package org.egov.userpreference.web.model;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Typed view of a {@code USER_NOTIFICATION_PREFERENCES} payload, used purely
 * to validate one. The stored document is the caller's raw JSON — see
 * {@link Preference#getPayload()}.
 */
@Data
@AllArgsConstructor
@NoArgsConstructor
@Builder
@JsonInclude(JsonInclude.Include.NON_EMPTY)
public class PreferencePayload {

    @JsonProperty("preferredLanguage")
    private String preferredLanguage;

    @JsonProperty("consent")
    private Consent consent;
}
