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
    private Actor actor;
    private WorkflowInfo workflow;
    private List<Stakeholder> stakeholders;
    private ContextInfo context;
    private Map<String, Object> data;
}
