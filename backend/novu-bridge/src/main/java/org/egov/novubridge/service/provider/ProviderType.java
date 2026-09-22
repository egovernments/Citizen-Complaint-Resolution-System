package org.egov.novubridge.service.provider;

import lombok.Builder;
import lombok.Value;

import java.util.List;

/** One catalog entry, serialized verbatim by {@code GET /providers/catalog}. */
@Value
@Builder
public class ProviderType {

    /** Catalog id: {@code twilio-sms} | {@code twilio-whatsapp} | {@code smtp} | {@code smscountry} | {@code ozeki}. */
    String type;
    String label;
    /** Business channel: {@code SMS} | {@code EMAIL} | {@code WHATSAPP}. */
    String channel;
    /** {@code novu} (Twilio, nodemailer) | {@code novu-generic-sms} (Ozeki) | {@code bridge-adapter} (SMSCountry via our adapter). */
    String transport;
    /** The Novu {@code providerId} the integration is created with. */
    String novuProviderId;
    List<CredentialField> credentialFields;
    boolean supportsVerify;
    boolean supportsTestSend;

    /** The Novu channel the integration lives on — WhatsApp rides Novu's {@code sms} channel. */
    @com.fasterxml.jackson.annotation.JsonIgnore
    public String novuChannel() {
        return "EMAIL".equalsIgnoreCase(channel) ? "email" : "sms";
    }
}
