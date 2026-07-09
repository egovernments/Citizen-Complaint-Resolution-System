package org.egov.novubridge.web.models;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;
import java.util.Map;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ComplaintsDomainEvent {
    private String eventId;
    private String eventType;
    private String eventTime;
    private String producer;
    private String module;
    private String eventName;
    private String entityType;
    private String entityId;
    private String tenantId;

    // ---- Config-driven pre-rendered contract (PGR pre-renders one event
    //      per recipient x channel; novu-bridge is pure pass-through) ----
    private String channel;          // SMS | WHATSAPP | EMAIL
    private String subscriberId;     // tenantId:userUuid (fallback tenantId:mobile)
    private Contact contact;         // recipient profile (phone/email/name/locale)
    private String renderedBody;     // final localized message body (already rendered by PGR)
    private String subject;          // EMAIL only, else null
    private String transactionId;    // serviceRequestId:action:toState:subscriberId:channel
    private String templateKey;      // MDMS NotificationTemplate uid (audience.action.toState.channel.locale);
                                     // NOT yet emitted by pgr-services (NotificationService.publishRenderedEvent
                                     // must add it) — null until then, forward-compatible here.

    // ---- Legacy fields (retained for the old coarse-event / dry-run path) ----
    private Actor actor;
    private WorkflowInfo workflow;
    private List<Stakeholder> stakeholders;
    private ContextInfo context;
    private Map<String, Object> data;
}
