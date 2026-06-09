package org.egov.pgr.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import io.opentelemetry.api.trace.Span;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.extern.slf4j.Slf4j;
import org.egov.common.contract.request.RequestInfo;
import org.egov.common.contract.request.User;
import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.producer.Producer;
import org.egov.pgr.repository.ServiceRequestRepository;
import org.egov.pgr.util.EscalationSkipReason;
import org.egov.pgr.util.HRMSUtil;
import org.egov.pgr.web.models.*;
import org.egov.pgr.web.models.workflow.ProcessInstance;
import org.egov.pgr.web.models.workflow.ProcessInstanceResponse;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.util.CollectionUtils;

import java.util.*;
import java.util.stream.Collectors;

import static org.egov.pgr.util.PGRConstants.*;

@Component
@Slf4j
public class EscalationService {

    private final HRMSUtil hrmsUtil;
    private final WorkflowService workflowService;
    private final PGRConfiguration config;
    private final Producer producer;
    private final ServiceRequestRepository serviceRequestRepository;
    private final ObjectMapper mapper;

    @Autowired
    public EscalationService(HRMSUtil hrmsUtil, WorkflowService workflowService,
                             PGRConfiguration config, Producer producer,
                             ServiceRequestRepository serviceRequestRepository,
                             ObjectMapper mapper) {
        this.hrmsUtil = hrmsUtil;
        this.workflowService = workflowService;
        this.config = config;
        this.producer = producer;
        this.serviceRequestRepository = serviceRequestRepository;
        this.mapper = mapper;
    }

    /**
     * Escalates a single complaint by finding the supervisor of the current assignee
     * and transitioning the workflow with the ESCALATE action (self-loop).
     *
     * <p>Kept as a boolean-returning facade for backwards compatibility with any
     * existing call site; internally delegates to {@link #escalateComplaintWithReason}.</p>
     *
     * @return true if escalation was performed, false if skipped
     */
    public boolean escalateComplaint(Service complaint, Workflow currentWorkflow, RequestInfo requestInfo) {
        return escalateComplaintWithReason(complaint, currentWorkflow, requestInfo).isSuccess();
    }

    /**
     * Same as {@link #escalateComplaint} but returns the reason it skipped (or SUCCESS),
     * so the caller (scheduler / /escalation/_trigger) can aggregate diagnostics.
     */
    public EscalationResult escalateComplaintWithReason(Service complaint,
                                                        Workflow currentWorkflow,
                                                        RequestInfo requestInfo) {

        String serviceRequestId = complaint.getServiceRequestId();
        String tenantId = complaint.getTenantId();
        int currentLevel = getEscalationLevel(complaint);

        // Record per-complaint OTEL attributes BEFORE any early-return path so
        // even skipped escalations show up in traces with full context.
        Span span = Span.current();
        span.setAttribute("complaint.serviceRequestId", serviceRequestId == null ? "" : serviceRequestId);
        span.setAttribute("complaint.tenantId", tenantId == null ? "" : tenantId);
        span.setAttribute("escalation.fromLevel", currentLevel);
        List<String> currentAssignees = currentWorkflow.getAssignes();
        String currentAssigneeUuid = (currentAssignees != null && !currentAssignees.isEmpty())
                ? currentAssignees.get(0)
                : null;
        span.setAttribute("escalation.fromAssignee", currentAssigneeUuid != null ? currentAssigneeUuid : "");

        // 1. Max depth
        if (currentLevel >= config.getEscalationMaxDepth()) {
            log.info("Complaint {} already at max escalation depth {}, skipping", serviceRequestId, currentLevel);
            span.setAttribute("escalation.skipReason", EscalationSkipReason.MAX_DEPTH_REACHED.name());
            return EscalationResult.skip(EscalationSkipReason.MAX_DEPTH_REACHED,
                    "currentLevel=" + currentLevel + ", maxDepth=" + config.getEscalationMaxDepth());
        }

        // 2. Current assignees
        if (CollectionUtils.isEmpty(currentAssignees)) {
            log.warn("Complaint {} has no current assignees, skipping escalation", serviceRequestId);
            span.setAttribute("escalation.skipReason", EscalationSkipReason.NO_ASSIGNEES.name());
            return EscalationResult.skip(EscalationSkipReason.NO_ASSIGNEES, "workflow returned 0 assignees");
        }

        // 3. Find supervisor for the first assignee that has one
        String supervisorUuid = null;
        for (String assigneeUuid : currentAssignees) {
            supervisorUuid = hrmsUtil.getSupervisorUuid(assigneeUuid, requestInfo, tenantId);
            if (supervisorUuid != null) {
                break;
            }
        }

        if (supervisorUuid == null) {
            log.warn("No supervisor found for any assignee of complaint {}, skipping escalation", serviceRequestId);
            span.setAttribute("escalation.skipReason", EscalationSkipReason.NO_SUPERVISOR_IN_HRMS.name());
            return EscalationResult.skip(EscalationSkipReason.NO_SUPERVISOR_IN_HRMS,
                    "HRMS returned no reportingTo for assignees=" + currentAssignees);
        }

        // 4. Build the escalation workflow
        Workflow escalationWorkflow = Workflow.builder()
                .action(ESCALATE)
                .assignes(Collections.singletonList(supervisorUuid))
                .comments("Auto-escalated: SLA breach at level " + currentLevel)
                .build();

        // 5. Update additionalDetails with escalation metadata
        Map<String, Object> additionalDetails = getAdditionalDetailsMap(complaint);
        additionalDetails.put("escalationLevel", currentLevel + 1);
        additionalDetails.put("lastEscalatedAt", System.currentTimeMillis());
        additionalDetails.put("escalatedFrom", currentAssignees);
        complaint.setAdditionalDetail(additionalDetails);

        // 6. Build ServiceRequest and transition workflow
        ServiceRequest serviceRequest = ServiceRequest.builder()
                .requestInfo(requestInfo)
                .service(complaint)
                .workflow(escalationWorkflow)
                .build();

        try {
            workflowService.updateWorkflowStatus(serviceRequest);
        } catch (Exception e) {
            log.error("Failed to transition workflow for complaint {} during escalation", serviceRequestId, e);
            span.setAttribute("escalation.skipReason", EscalationSkipReason.WORKFLOW_TRANSITION_FAILED.name());
            return EscalationResult.skip(EscalationSkipReason.WORKFLOW_TRANSITION_FAILED,
                    "workflow-v2 rejected ESCALATE: " + e.getMessage());
        }

        // 7. Publish to update topic so persister saves the updated additionalDetails
        producer.push(tenantId, config.getUpdateTopic(), serviceRequest);

        // 8. Publish escalation event for future notification listeners
        Map<String, Object> escalationEvent = new HashMap<>();
        escalationEvent.put("serviceRequestId", serviceRequestId);
        escalationEvent.put("tenantId", tenantId);
        escalationEvent.put("escalationLevel", currentLevel + 1);
        escalationEvent.put("previousAssignees", currentAssignees);
        escalationEvent.put("newAssignee", supervisorUuid);
        escalationEvent.put("timestamp", System.currentTimeMillis());
        producer.push(tenantId, config.getEscalationKafkaTopic(), escalationEvent);

        span.setAttribute("escalation.toAssignee", supervisorUuid);
        span.setAttribute("escalation.toLevel", currentLevel + 1);

        log.info("Escalated complaint {} from level {} to {} (assignee: {} -> {})",
                serviceRequestId, currentLevel, currentLevel + 1, currentAssignees, supervisorUuid);

        return EscalationResult.success(supervisorUuid, currentLevel + 1);
    }

    /**
     * Outcome of a single {@link #escalateComplaintWithReason} call. Either a
     * successful escalation (with the new assignee + level) or a skip with a
     * structured reason and optional human-readable detail.
     */
    @Getter
    @Builder
    @AllArgsConstructor
    public static class EscalationResult {
        private final boolean success;
        private final EscalationSkipReason reason;
        private final String detail;
        private final String newAssigneeUuid;
        private final Integer newLevel;

        public static EscalationResult success(String newAssigneeUuid, int newLevel) {
            return new EscalationResult(true, EscalationSkipReason.SUCCESS, null, newAssigneeUuid, newLevel);
        }

        public static EscalationResult skip(EscalationSkipReason reason, String detail) {
            return new EscalationResult(false, reason, detail, null, null);
        }
    }

    /**
     * Gets current assignee UUIDs from workflow process instance search.
     */
    public List<String> getCurrentAssignees(String serviceRequestId, String tenantId, RequestInfo requestInfo) {

        StringBuilder url = workflowService.getprocessInstanceSearchURL(tenantId, serviceRequestId);
        RequestInfoWrapper requestInfoWrapper = RequestInfoWrapper.builder().requestInfo(requestInfo).build();

        Object result = serviceRequestRepository.fetchResult(url, requestInfoWrapper);

        try {
            ProcessInstanceResponse response = mapper.convertValue(result, ProcessInstanceResponse.class);
            if (response == null || CollectionUtils.isEmpty(response.getProcessInstances())) {
                return Collections.emptyList();
            }

            ProcessInstance processInstance = response.getProcessInstances().get(0);
            if (CollectionUtils.isEmpty(processInstance.getAssignes())) {
                return Collections.emptyList();
            }

            return processInstance.getAssignes().stream()
                    .map(User::getUuid)
                    .collect(Collectors.toList());
        } catch (Exception e) {
            log.error("Failed to get assignees for complaint {}", serviceRequestId, e);
            return Collections.emptyList();
        }
    }

    /**
     * Extracts escalation level from complaint additionalDetails. Defaults to 0.
     */
    @SuppressWarnings("unchecked")
    private int getEscalationLevel(Service complaint) {
        Object additionalDetail = complaint.getAdditionalDetail();
        if (additionalDetail == null) {
            return 0;
        }

        try {
            Map<String, Object> details;
            if (additionalDetail instanceof Map) {
                details = (Map<String, Object>) additionalDetail;
            } else {
                details = mapper.convertValue(additionalDetail, Map.class);
            }

            Object level = details.get("escalationLevel");
            if (level instanceof Number) {
                return ((Number) level).intValue();
            }
        } catch (Exception e) {
            log.warn("Failed to read escalationLevel from additionalDetails", e);
        }
        return 0;
    }

    /**
     * Gets additionalDetails as a mutable Map, creating one if needed.
     */
    @SuppressWarnings("unchecked")
    private Map<String, Object> getAdditionalDetailsMap(Service complaint) {
        Object additionalDetail = complaint.getAdditionalDetail();
        if (additionalDetail == null) {
            return new HashMap<>();
        }

        try {
            if (additionalDetail instanceof Map) {
                return new HashMap<>((Map<String, Object>) additionalDetail);
            }
            return mapper.convertValue(additionalDetail, HashMap.class);
        } catch (Exception e) {
            log.warn("Failed to convert additionalDetails to Map, creating new", e);
            return new HashMap<>();
        }
    }
}
