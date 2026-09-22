package org.egov.novubridge.web.models;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Map;

/**
 * The bridge's ONE inbound envelope (schema version 1): a fully-rendered message for a single
 * recipient on a single channel. Module-neutral by construction — nothing here names a domain.
 * Producers (pgr-services, otp-publisher, any other module) declare themselves with
 * {@code eventType}; the bridge accepts the types listed in {@code novu.bridge.event.types} and
 * never infers the shape from which fields happen to be set.
 *
 * <p>Required: eventId, eventType, eventName, tenantId, channel, subscriberId, renderedBody.
 *
 * <p><b>Published contract.</b> The wire form of this class is
 * {@code contract/envelope-v1.schema.json} (packaged in this jar, and published at
 * {@code docs/2.12/notifications/contract/}). Keep them in step by hand: every field below
 * appears in the schema, and the schema's required set is exactly what
 * {@link org.egov.novubridge.service.EnvelopeValidator} enforces. Renaming a JSON field here is a schema-version change,
 * not a refactor — the Java type name is free to change, the wire names are not.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class NotificationEvent {
    /** Envelope schema version; absent means "1". */
    private String schemaVersion;

    private String eventId;
    private String eventType;        // COMPLAINTS_WORKFLOW_TRANSITIONED | CORE_SMS | … (novu.bridge.event.types)
    private String eventTime;
    private String producer;
    private String module;           // free-form producing module ("Complaints", "CORE", "XYZ")
    private String eventName;
    private String entityType;       // what entityId names ("COMPLAINT", "SMS", …)
    private String entityId;         // the producing module's own reference for this message
    private String tenantId;

    private String channel;          // SMS | WHATSAPP | EMAIL
    private String subscriberId;     // tenantId:userUuid (fallback tenantId:phone)
    private Contact contact;         // recipient profile (phone/email/name/locale)
    private String renderedBody;     // final localized message body (already rendered by the producer)
    private String subject;          // EMAIL only, else null
    private String transactionId;    // producer-stable idempotency key
    private String templateKey;      // producer-side template identity (PGR sends the MDMS NotificationTemplate uid)

    // ---- Provider-template delivery (WHATSAPP only) ----
    // Set by the producer when an approved provider template exists for this message. When
    // present, the provider sends the template id + positional variables instead of the
    // free-form renderedBody. Null for SMS/EMAIL.
    private String templateId;                     // e.g. Twilio WhatsApp Content SID (HX…)
    private Map<String, Object> contentVariables;  // positional 1-based ({"1":.., "2":..})

    /**
     * Free-form structured payload echoed alongside the body. The bridge reads only three keys,
     * all optional: {@code referenceNumber} (the ledger's reference when {@code entityId} is
     * absent) and {@code action}/{@code toState} (used to reconstruct a template key when the
     * producer sends none). PGR fills it with {@code complaintNo, status, action, toState}.
     */
    private Map<String, Object> data;
}
