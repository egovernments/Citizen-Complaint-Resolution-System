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
        if (event.getWorkflow() == null || !StringUtils.hasText(event.getWorkflow().getToState())) {
            throw new CustomException("NB_INVALID_EVENT", "workflow.toState is required");
        }
    }
}
