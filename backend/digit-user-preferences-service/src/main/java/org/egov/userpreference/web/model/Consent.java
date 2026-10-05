package org.egov.userpreference.web.model;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Per-channel consent map inside a {@code USER_NOTIFICATION_PREFERENCES}
 * payload. Channels not named here are ignored during validation, as they were
 * by the Go struct.
 */
@Data
@AllArgsConstructor
@NoArgsConstructor
@Builder
@JsonInclude(JsonInclude.Include.NON_EMPTY)
public class Consent {

    @JsonProperty("WHATSAPP")
    private ConsentPolicy whatsApp;

    @JsonProperty("SMS")
    private ConsentPolicy sms;

    @JsonProperty("EMAIL")
    private ConsentPolicy email;
}
