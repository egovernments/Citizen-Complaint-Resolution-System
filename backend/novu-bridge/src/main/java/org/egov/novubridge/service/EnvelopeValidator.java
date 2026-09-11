package org.egov.novubridge.service;

import org.egov.novubridge.web.models.ComplaintsDomainEvent;
import org.egov.tracer.model.CustomException;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

@Service
public class EnvelopeValidator {

    public void validate(ComplaintsDomainEvent event) {
        if (event == null) {
            throw new CustomException("NB_INVALID_EVENT", "Event payload is required");
        }
        if (!StringUtils.hasText(event.getEventId())) {
            throw new CustomException("NB_INVALID_EVENT", "eventId is required");
        }
        if (!StringUtils.hasText(event.getEventType())) {
            throw new CustomException("NB_INVALID_EVENT", "eventType is required");
        }
        if (!StringUtils.hasText(event.getEventName())) {
            throw new CustomException("NB_INVALID_EVENT", "eventName is required");
        }
        if (!StringUtils.hasText(event.getTenantId())) {
            throw new CustomException("NB_INVALID_EVENT", "tenantId is required");
        }

        boolean preRendered = event.getContact() != null || StringUtils.hasText(event.getRenderedBody());
        if (preRendered) {
            // Config-driven pass-through contract: PGR already rendered the body
            // and resolved the recipient. There is no workflow block.
            if (!StringUtils.hasText(event.getChannel())) {
                throw new CustomException("NB_INVALID_EVENT", "channel is required for a pre-rendered event");
            }
            if (!StringUtils.hasText(event.getRenderedBody())) {
                throw new CustomException("NB_INVALID_EVENT", "renderedBody is required for a pre-rendered event");
            }
            if (!StringUtils.hasText(event.getSubscriberId())) {
                throw new CustomException("NB_INVALID_EVENT", "subscriberId is required for a pre-rendered event");
            }
            return;
        }

        // Legacy coarse event / dry-run shape still carries a workflow block.
        if (event.getWorkflow() == null || !StringUtils.hasText(event.getWorkflow().getToState())) {
            throw new CustomException("NB_INVALID_EVENT", "workflow.toState is required");
        }
    }
}
