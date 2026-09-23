package org.egov.novubridge.service.delivery;

import lombok.Builder;
import lombok.Value;
import org.egov.novubridge.web.models.Contact;

import java.util.Map;

/** A fully-rendered message for one recipient on one channel; providers never see the Kafka envelope. */
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
    /** Operator test-send: no subscriber upsert, {@link #workflowOverride} used; otherwise identical to live. */
    boolean test;
    /** Test-send only: the Novu workflow to trigger instead of the per-channel default. */
    String workflowOverride;
    /** Novu integration the tenant pinned for this channel; blank = the transport picks. */
    String integrationIdentifier;
    /** Catalog type of {@link #integrationIdentifier}, so a transport can attach a gateway's own body. */
    String providerType;
}
