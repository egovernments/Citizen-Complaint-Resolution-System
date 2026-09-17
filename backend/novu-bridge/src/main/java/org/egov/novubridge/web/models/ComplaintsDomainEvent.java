package org.egov.novubridge.web.models;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Map;

/**
 * The bridge's ONE inbound envelope (schema version 1): a fully-rendered message for a single
 * recipient on a single channel. Producers (pgr-services, otp-publisher, …) declare themselves
 * with {@code eventType}; the bridge accepts the types listed in
 * {@code novu.bridge.event.types} and never infers the shape from which fields happen to be set.
 *
 * <p>Required: eventId, eventType, eventName, tenantId, channel, subscriberId, renderedBody.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ComplaintsDomainEvent {
    /** Envelope schema version; absent means "1". */
    private String schemaVersion;

    private String eventId;
    private String eventType;        // COMPLAINTS_WORKFLOW_TRANSITIONED | OTP | … (novu.bridge.event.types)
    private String eventTime;
    private String producer;
    private String module;
    private String eventName;
    private String entityType;
    private String entityId;
    private String tenantId;

    private String channel;          // SMS | WHATSAPP | EMAIL
    private String subscriberId;     // tenantId:userUuid (fallback tenantId:phone)
    private Contact contact;         // recipient profile (phone/email/name/locale)
    private String renderedBody;     // final localized message body (already rendered by the producer)
    private String subject;          // EMAIL only, else null
    private String transactionId;    // producer-stable idempotency key
    private String templateKey;      // producer-side template identity (PGR: MDMS NotificationTemplate uid)

    // ---- Provider-template delivery (WHATSAPP only) ----
    // Set by the producer when an approved provider template exists for this message. When
    // present, the provider sends the template id + positional variables instead of the
    // free-form renderedBody. Null for SMS/EMAIL.
    private String templateId;                     // e.g. Twilio WhatsApp Content SID (HX…)
    private Map<String, Object> contentVariables;  // positional 1-based ({"1":.., "2":..})

    /** Structured payload echoed alongside the body (complaintNo, status, action, toState, …). */
    private Map<String, Object> data;
}
