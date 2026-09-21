package org.egov.novubridge.service.delivery;

import lombok.Builder;
import lombok.Value;
import org.egov.novubridge.web.models.Contact;

import java.util.Map;

/**
 * The one shape the delivery layer works on: a fully-rendered message for one recipient on
 * one channel. The pipeline builds it from an inbound event; the configurator's test-send
 * builds it from operator input. Providers never see the Kafka envelope.
 */
@Value
@Builder(toBuilder = true)
public class Dispatch {
    String tenantId;
    /** SMS | WHATSAPP | EMAIL (upper-case). */
    String channel;
    /** Stable recipient id — tenantId:userUuid (or tenantId:phone); test sends use nb-test-*. */
    String subscriberId;
    Contact contact;
    /** Final, localized body. */
    String body;
    /** EMAIL subject; null for other channels. */
    String subject;
    /** Idempotency / correlation key carried to the provider. */
    String transactionId;
    /** Structured payload echoed alongside the body (complaintNo, status, ...). */
    Map<String, Object> data;
    /** Provider-side template id (Twilio WhatsApp Content SID) when the channel requires one. */
    String templateId;
    /** Positional variables for {@link #templateId}. */
    Map<String, Object> contentVariables;
    /**
     * True for operator test-sends: no subscriber profile is upserted and the workflow may be
     * overridden. Providers must otherwise behave exactly as for a live dispatch.
     */
    boolean test;
    /** Test-send only: the Novu workflow to trigger instead of the per-channel default. */
    String workflowOverride;
    /**
     * Novu integration identifier the tenant chose for this channel
     * ({@code NotificationChannel.provider}). Blank = let the transport pick as it always has.
     */
    String integrationIdentifier;
    /**
     * Catalog type of {@link #integrationIdentifier} ({@code ozeki}, {@code smscountry}, …)
     * when it can be derived, so a transport can attach the gateway's own request body.
     */
    String providerType;
}
