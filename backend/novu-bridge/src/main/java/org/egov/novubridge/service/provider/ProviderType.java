package org.egov.novubridge.service.provider;

import lombok.Builder;
import lombok.Value;

import java.util.List;

/** One catalog entry, serialized verbatim by {@code GET /providers/catalog}. */
@Value
@Builder
public class ProviderType {

    /** Catalog id: {@code twilio-sms} | {@code twilio-whatsapp} | {@code smtp} | {@code smscountry} | {@code ozeki} | {@code jasmin}. */
    String type;
    String label;
    /** Business channel: {@code SMS} | {@code EMAIL} | {@code WHATSAPP}. */
    String channel;
    /**
     * {@code novu}: Novu's worker calls the gateway through the provider named by
     * {@link #novuProviderId}. Every current type is {@code novu}; SMSCountry, Ozeki and Jasmin
     * are DIGIT's providers mounted into the worker (see {@link ProviderCatalog}).
     */
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
