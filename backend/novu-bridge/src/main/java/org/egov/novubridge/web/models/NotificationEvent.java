package org.egov.novubridge.web.models;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Map;

/**
 * The pre-rendered inbound envelope (schema version 1): one finished message for one recipient on
 * one channel. Producers declare themselves with {@code eventType} (allowlisted by
 * {@code novu.bridge.event.types}); the shape is never sniffed.
 *
 * <p>Published contract: {@code contract/envelope-v1.schema.json}, kept in step by hand. Renaming a
 * JSON field here is a schema-version change, not a refactor.
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

    // WHATSAPP only: an approved provider template, sent instead of the free-form renderedBody.
    private String templateId;                     // e.g. Twilio WhatsApp Content SID (HX…)
    private Map<String, Object> contentVariables;  // positional 1-based ({"1":.., "2":..})

    /** Echoed alongside the body. The bridge reads only referenceNumber, complaintNo and action/toState. */
    private Map<String, Object> data;
}
