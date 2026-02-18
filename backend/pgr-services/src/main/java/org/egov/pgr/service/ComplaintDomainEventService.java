package org.egov.pgr.service;

import lombok.extern.slf4j.Slf4j;
import org.egov.common.contract.request.RequestInfo;
import org.egov.common.contract.request.User;
import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.producer.Producer;
import org.egov.pgr.web.models.ServiceRequest;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.util.CollectionUtils;
import org.springframework.util.StringUtils;

import java.time.Instant;
import java.util.*;

@Service
@Slf4j
public class ComplaintDomainEventService {

    private static final String EVENT_TYPE = "COMPLAINTS_WORKFLOW_TRANSITIONED";
    private static final String EVENT_NAME_PREFIX = "COMPLAINTS.WORKFLOW.";
    private static final String EVENT_PRODUCER = "complaints-service";
    private static final String MODULE = "Complaints";
    private static final String ENTITY_TYPE = "COMPLAINT";
    private final Producer producer;
    private final PGRConfiguration config;

    @Autowired
    public ComplaintDomainEventService(Producer producer, PGRConfiguration config) {
        this.producer = producer;
        this.config = config;
    }

    public void publishWorkflowTransitionEvent(ServiceRequest request, String fromState) {
        if (request == null || request.getService() == null) {
            return;
        }

        if (Boolean.FALSE.equals(config.getIsComplaintsDomainEventEnabled())) {
            return;
        }

        String tenantId = request.getService().getTenantId();
        String action = request.getWorkflow() != null ? request.getWorkflow().getAction() : null;
        if (!StringUtils.hasText(action)) {
            log.warn("Skipping complaints domain event publish as workflow action is empty for complaintId={}",
                    request.getService().getServiceRequestId());
            return;
        }

        try {
            producer.push(tenantId, config.getComplaintsDomainEventsTopic(), buildEvent(request, fromState, action));
        } catch (Exception e) {
            log.error("Failed to publish complaints domain event for complaintId={} tenantId={}",
                    request.getService().getServiceRequestId(), tenantId, e);
        }
    }

    private Map<String, Object> buildEvent(ServiceRequest request, String fromState, String action) {
        org.egov.pgr.web.models.Service service = request.getService();
        Map<String, Object> event = new LinkedHashMap<>();
        event.put("eventId", UUID.randomUUID().toString());
        event.put("eventType", EVENT_TYPE);
        event.put("eventName", EVENT_NAME_PREFIX + action.toUpperCase(Locale.ROOT));
        event.put("eventTime", Instant.now().toString());
        event.put("producer", EVENT_PRODUCER);
        event.put("module", MODULE);
        event.put("entityType", ENTITY_TYPE);
        event.put("entityId", service.getServiceRequestId());
        event.put("tenantId", service.getTenantId());
        event.put("actor", getActor(request.getRequestInfo()));
        event.put("workflow", getWorkflow(action, fromState, service.getApplicationStatus()));
        event.put("stakeholders", getStakeholders(request));
        event.put("context", Collections.singletonMap("locale", config.getComplaintsDomainEventDefaultLocale()));
        event.put("data", getData(service));
        return event;
    }

    private Map<String, Object> getActor(RequestInfo requestInfo) {
        Map<String, Object> actor = new LinkedHashMap<>();
        if (requestInfo == null || requestInfo.getUserInfo() == null) {
            return actor;
        }
        User userInfo = requestInfo.getUserInfo();
        actor.put("userId", userInfo.getUuid());
        actor.put("userType", userInfo.getType());
        return actor;
    }

    private Map<String, Object> getWorkflow(String action, String fromState, String toState) {
        Map<String, Object> workflow = new LinkedHashMap<>();
        workflow.put("action", action.toUpperCase(Locale.ROOT));
        workflow.put("fromState", fromState);
        workflow.put("toState", toState);
        return workflow;
    }

    private List<Map<String, Object>> getStakeholders(ServiceRequest request) {
        List<Map<String, Object>> stakeholders = new ArrayList<>();

        if (request.getService().getCitizen() != null &&
                (StringUtils.hasText(request.getService().getCitizen().getUuid())
                        || StringUtils.hasText(request.getService().getAccountId())
                        || StringUtils.hasText(request.getService().getCitizen().getMobileNumber()))) {
            Map<String, Object> citizen = new LinkedHashMap<>();
            citizen.put("type", "CITIZEN");
            citizen.put("userId", StringUtils.hasText(request.getService().getCitizen().getUuid())
                    ? request.getService().getCitizen().getUuid()
                    : request.getService().getAccountId());
            citizen.put("mobile", request.getService().getCitizen().getMobileNumber());
            stakeholders.add(citizen);
        }

        if (request.getWorkflow() != null && !CollectionUtils.isEmpty(request.getWorkflow().getAssignes())) {
            for (String assignee : request.getWorkflow().getAssignes()) {
                if (!StringUtils.hasText(assignee)) {
                    continue;
                }
                Map<String, Object> employee = new LinkedHashMap<>();
                employee.put("type", "EMPLOYEE");
                employee.put("userId", assignee);
                stakeholders.add(employee);
            }
        }

        return stakeholders;
    }

    private Map<String, Object> getData(org.egov.pgr.web.models.Service service) {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("complaintNo", service.getServiceRequestId());
        data.put("complaintType", service.getServiceCode());
        data.put("complaintDescription", service.getDescription());
        return data;
    }
}
