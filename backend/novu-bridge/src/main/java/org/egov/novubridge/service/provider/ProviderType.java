package org.egov.novubridge.service.provider;

import lombok.Builder;
import lombok.Value;

import java.util.List;

/**
 * One out-of-the-box provider the operator can configure from the configurator without
 * touching env vars or redeploying. Serialized verbatim as an entry of
 * {@code GET /providers/catalog}.
 */
@Value
@Builder
public class ProviderType {

    /** Catalog id: {@code twilio-sms} | {@code twilio-whatsapp} | {@code smtp} | {@code smscountry} | {@code ozeki}. */
    String type;
    String label;
    /** Business channel: {@code SMS} | {@code EMAIL} | {@code WHATSAPP}. */
    String channel;
    /**
     * How the message actually reaches the gateway:
     * <ul>
     *   <li>{@code novu} — a first-class Novu provider (Twilio, nodemailer).</li>
     *   <li>{@code novu-generic-sms} — Novu's built-in {@code generic-sms} provider posting
     *       straight at the gateway's own JSON API (Ozeki).</li>
     *   <li>{@code bridge-adapter} — Novu's {@code generic-sms} provider posting at THIS
     *       service's adapter endpoint, which translates to the gateway's non-JSON API
     *       (SMSCountry).</li>
     * </ul>
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
