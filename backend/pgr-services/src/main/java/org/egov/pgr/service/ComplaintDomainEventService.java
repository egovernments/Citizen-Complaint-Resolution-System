package org.egov.pgr.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.web.models.Service;
import org.egov.pgr.web.models.ServiceRequest;
import org.egov.pgr.web.models.User;
import org.springframework.util.CollectionUtils;
import org.springframework.util.StringUtils;
import org.springframework.web.client.RestTemplate;

import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.*;

@org.springframework.stereotype.Service
@Slf4j
@RequiredArgsConstructor
public class ComplaintDomainEventService {

    private static final String EVENT_TYPE       = "COMPLAINTS_WORKFLOW_TRANSITIONED";
    private static final String EVENT_NAME_PREFIX = "COMPLAINTS.WORKFLOW.";
    private static final String EVENT_PRODUCER   = "pgr-services";
    private static final String MODULE           = "Complaints";
    private static final String ENTITY_TYPE      = "COMPLAINT";

    private static final DateTimeFormatter DATE_FORMATTER =
            DateTimeFormatter.ofPattern("dd-MMM-yyyy hh:mma", Locale.ENGLISH);

    private final PGRConfiguration config;
    private final RestTemplate restTemplate;

    public void publishWorkflowTransitionEvent(ServiceRequest request, String fromState) {
        if (request == null || request.getService() == null) return;
        if (Boolean.FALSE.equals(config.getIsComplaintsDomainEventEnabled())) return;

        String action = request.getWorkflow() != null ? request.getWorkflow().getAction() : null;
        if (!StringUtils.hasText(action)) return;

        try {
            Map<String, Object> event = buildEvent(request, fromState, action);
            log.info("Publishing complaints domain event: type={} entityId={}",
                    EVENT_TYPE, request.getService().getServiceRequestId());
            // Direct HTTP publish — wire to your event bus endpoint as needed
            // restTemplate.postForEntity(eventsEndpoint, event, Void.class);
            log.debug("Domain event payload: {}", event);
        } catch (Exception e) {
            log.error("Failed to publish domain event for complaintId={}",
                    request.getService().getServiceRequestId(), e);
        }
    }

    private Map<String, Object> buildEvent(ServiceRequest request, String fromState, String action) {
        Service service = request.getService();
        Map<String, Object> event = new LinkedHashMap<>();
        event.put("eventId",    UUID.randomUUID().toString());
        event.put("eventType",  EVENT_TYPE);
        event.put("eventName",  EVENT_NAME_PREFIX + action.toUpperCase(Locale.ROOT));
        event.put("eventTime",  Instant.now().toString());
        event.put("producer",   EVENT_PRODUCER);
        event.put("module",     MODULE);
        event.put("entityType", ENTITY_TYPE);
        event.put("entityId",   service.getServiceRequestId());
        event.put("tenantId",   service.getTenantId());
        event.put("actor",      getActor(request));
        event.put("workflow",   getWorkflowInfo(action, fromState, service.getApplicationStatus()));
        event.put("stakeholders", getStakeholders(request));
        event.put("context",    Collections.singletonMap("locale", "en_IN"));
        event.put("data",       getData(request));
        return event;
    }

    private Map<String, Object> getActor(ServiceRequest request) {
        Map<String, Object> actor = new LinkedHashMap<>();
        actor.put("userId",   request.getUserId());
        actor.put("userType", resolveUserType(request));
        return actor;
    }

    private Map<String, Object> getWorkflowInfo(String action, String fromState, String toState) {
        Map<String, Object> wf = new LinkedHashMap<>();
        wf.put("action",    action.toUpperCase(Locale.ROOT));
        wf.put("fromState", fromState);
        wf.put("toState",   toState);
        return wf;
    }

    private List<Map<String, Object>> getStakeholders(ServiceRequest request) {
        List<Map<String, Object>> stakeholders = new ArrayList<>();
        Service service = request.getService();

        if (service.getCitizen() != null && StringUtils.hasText(service.getAccountId())) {
            Map<String, Object> citizen = new LinkedHashMap<>();
            citizen.put("type",   "CITIZEN");
            citizen.put("userId", service.getAccountId());
            citizen.put("mobile", buildMobile(service.getCitizen()));
            stakeholders.add(citizen);
        }

        if (request.getWorkflow() != null && !CollectionUtils.isEmpty(request.getWorkflow().getAssignes())) {
            for (String assignee : request.getWorkflow().getAssignes()) {
                if (!StringUtils.hasText(assignee)) continue;
                Map<String, Object> emp = new LinkedHashMap<>();
                emp.put("type",   "EMPLOYEE");
                emp.put("userId", assignee);
                stakeholders.add(emp);
            }
        }

        return stakeholders;
    }

    private Map<String, Object> getData(ServiceRequest request) {
        Service service = request.getService();
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("complaintNo",  service.getServiceRequestId());
        data.put("status",       service.getApplicationStatus());
        data.put("serviceCode",  service.getServiceCode());
        data.put("citizenName",  service.getCitizen() != null ? service.getCitizen().getName() : null);
        data.put("mobileNumber", buildMobile(service.getCitizen()));
        data.put("submittedDate", getSubmittedDate(service));
        data.put("comment",      request.getWorkflow() != null ? request.getWorkflow().getComments() : null);
        return data;
    }

    private String buildMobile(User citizen) {
        if (citizen == null || !StringUtils.hasText(citizen.getMobileNumber())) return null;
        String mobile = citizen.getMobileNumber().trim();
        if (mobile.startsWith("+")) return mobile;
        if (StringUtils.hasText(citizen.getCountryCode())) {
            String code = citizen.getCountryCode().trim();
            return (code.startsWith("+") ? code : "+" + code) + mobile;
        }
        return mobile;
    }

    private String getSubmittedDate(Service service) {
        if (service.getAuditDetails() != null && service.getAuditDetails().getCreatedTime() != null) {
            return Instant.ofEpochMilli(service.getAuditDetails().getCreatedTime())
                    .atZone(ZoneId.of("Asia/Kolkata"))
                    .format(DATE_FORMATTER);
        }
        return null;
    }

    private String resolveUserType(ServiceRequest request) {
        if (CollectionUtils.isEmpty(request.getRoles())) return "CITIZEN";
        boolean isEmployee = request.getRoles().stream()
                .anyMatch(r -> r.equalsIgnoreCase("EMPLOYEE") || r.equalsIgnoreCase("GRO_EMPLOYEE"));
        return isEmployee ? "EMPLOYEE" : "CITIZEN";
    }
}
