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
        return escalateComplaintWithReason(complaint, currentWorkflow, requestInfo,
                config.getEscalationMaxDepth(), 0L, 0L).isSuccess();
    }

    /**
     * Same as {@link #escalateComplaint} but returns the reason it skipped (or SUCCESS),
     * so the caller (scheduler / /escalation/_trigger) can aggregate diagnostics.
     *
     * <p>{@code maxDepth} is resolved by the scheduler (CRS.EscalationPolicy →
     * v0 EscalationConfig → static config) and passed in so the service no
     * longer re-derives it from static config only — that divergence let the
     * two sides disagree on the depth check. {@code elapsedMs}/{@code slaMs}
     * feed the audit-trail comment; the HRMS summary lookup for that comment
     * is one extra HRMS call per actual escalation — escalations are rare;
     * acceptable.</p>
     */
    public EscalationResult escalateComplaintWithReason(Service complaint,
                                                        Workflow currentWorkflow,
                                                        RequestInfo requestInfo,
                                                        int maxDepth,
                                                        long elapsedMs,
                                                        long slaMs) {

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
        if (currentLevel >= maxDepth) {
            log.info("Complaint {} already at max escalation depth {}, skipping", serviceRequestId, currentLevel);
            span.setAttribute("escalation.skipReason", EscalationSkipReason.MAX_DEPTH_REACHED.name());
            return EscalationResult.skip(EscalationSkipReason.MAX_DEPTH_REACHED,
                    "currentLevel=" + currentLevel + ", maxDepth=" + maxDepth);
        }

        // 2. Current assignees
        if (CollectionUtils.isEmpty(currentAssignees)) {
            log.warn("Complaint {} has no current assignees, skipping escalation", serviceRequestId);
            span.setAttribute("escalation.skipReason", EscalationSkipReason.NO_ASSIGNEES.name());
            return EscalationResult.skip(EscalationSkipReason.NO_ASSIGNEES, "workflow returned 0 assignees");
        }

        // 3. Find supervisor for the first assignee that has one
        String supervisorUuid = findSupervisorUuid(currentAssignees, requestInfo, tenantId);

        if (supervisorUuid == null) {
            log.warn("No supervisor found for any assignee of complaint {}, skipping escalation", serviceRequestId);
            span.setAttribute("escalation.skipReason", EscalationSkipReason.NO_SUPERVISOR_IN_HRMS.name());
            return EscalationResult.skip(EscalationSkipReason.NO_SUPERVISOR_IN_HRMS,
                    "HRMS returned no reportingTo for assignees=" + currentAssignees);
        }

        // 4. Build the escalation workflow with a PRD audit-trail comment
        //    (who it went to + the numbers that justified the breach).
        Map<String, String> supervisorSummary = hrmsUtil.getEmployeeSummary(supervisorUuid, requestInfo, tenantId);
        Workflow escalationWorkflow = Workflow.builder()
                .action(ESCALATE)
                .assignes(Collections.singletonList(supervisorUuid))
                .comments(buildEscalateComment(supervisorUuid, supervisorSummary, currentLevel, elapsedMs, slaMs))
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

        // 7. Refresh audit details BEFORE pushing to the update topic. The
        //    persister maps eg_pgr_service_v2.lastmodifiedtime from this object;
        //    without the refresh the next tick measures elapsed from the
        //    pre-escalation timestamp, and decreasing per-level SLAs cascade
        //    straight to maxDepth (PRD P6: each level gets a fresh window).
        if (complaint.getAuditDetails() != null) {
            complaint.getAuditDetails().setLastModifiedTime(System.currentTimeMillis());
            if (requestInfo.getUserInfo() != null && requestInfo.getUserInfo().getUuid() != null) {
                complaint.getAuditDetails().setLastModifiedBy(requestInfo.getUserInfo().getUuid());
            }
        }

        // 8. Publish to update topic so persister saves the updated additionalDetails
        producer.push(tenantId, config.getUpdateTopic(), serviceRequest);

        // 9. Publish escalation event for future notification listeners
        Map<String, Object> escalationEvent = new HashMap<>();
        escalationEvent.put("serviceRequestId", serviceRequestId);
        escalationEvent.put("tenantId", tenantId);
        escalationEvent.put("escalationLevel", currentLevel + 1);
        escalationEvent.put("previousAssignees", currentAssignees);
        escalationEvent.put("newAssignee", supervisorUuid);
        escalationEvent.put("newAssigneeName", supervisorSummary.get("name"));
        escalationEvent.put("newAssigneeDesignation", supervisorSummary.get("designation"));
        escalationEvent.put("elapsedMs", elapsedMs);
        escalationEvent.put("slaMs", slaMs);
        escalationEvent.put("timestamp", System.currentTimeMillis());
        producer.push(tenantId, config.getEscalationKafkaTopic(), escalationEvent);

        span.setAttribute("escalation.toAssignee", supervisorUuid);
        span.setAttribute("escalation.toLevel", currentLevel + 1);

        log.info("Escalated complaint {} from level {} to {} (assignee: {} -> {})",
                serviceRequestId, currentLevel, currentLevel + 1, currentAssignees, supervisorUuid);

        return EscalationResult.success(supervisorUuid, currentLevel + 1);
    }

    /**
     * Dry-run twin of {@link #escalateComplaintWithReason}: same max-depth
     * check and HRMS supervisor lookup, but ZERO mutations — no
     * additionalDetail write, no workflow transition, no Kafka publish.
     * Used by {@code POST /escalation/_trigger} with {@code dryRun=true}.
     */
    public EscalationResult previewEscalation(Service complaint,
                                              Workflow currentWorkflow,
                                              RequestInfo requestInfo,
                                              int maxDepth,
                                              long elapsedMs,
                                              long slaMs) {

        String serviceRequestId = complaint.getServiceRequestId();
        String tenantId = complaint.getTenantId();
        int currentLevel = getEscalationLevel(complaint);

        Span span = Span.current();
        span.setAttribute("complaint.serviceRequestId", serviceRequestId == null ? "" : serviceRequestId);
        span.setAttribute("complaint.tenantId", tenantId == null ? "" : tenantId);
        span.setAttribute("escalation.fromLevel", currentLevel);
        span.setAttribute("escalation.dryRun", true);

        if (currentLevel >= maxDepth) {
            span.setAttribute("escalation.skipReason", EscalationSkipReason.MAX_DEPTH_REACHED.name());
            return EscalationResult.skip(EscalationSkipReason.MAX_DEPTH_REACHED,
                    "currentLevel=" + currentLevel + ", maxDepth=" + maxDepth);
        }

        List<String> currentAssignees = currentWorkflow.getAssignes();
        if (CollectionUtils.isEmpty(currentAssignees)) {
            span.setAttribute("escalation.skipReason", EscalationSkipReason.NO_ASSIGNEES.name());
            return EscalationResult.skip(EscalationSkipReason.NO_ASSIGNEES, "workflow returned 0 assignees");
        }

        String supervisorUuid = findSupervisorUuid(currentAssignees, requestInfo, tenantId);
        if (supervisorUuid == null) {
            span.setAttribute("escalation.skipReason", EscalationSkipReason.NO_SUPERVISOR_IN_HRMS.name());
            return EscalationResult.skip(EscalationSkipReason.NO_SUPERVISOR_IN_HRMS,
                    "HRMS returned no reportingTo for assignees=" + currentAssignees);
        }

        return EscalationResult.builder()
                .success(true)
                .reason(EscalationSkipReason.SUCCESS)
                .detail("would escalate to " + supervisorUuid + " (level " + currentLevel + "→" + (currentLevel + 1)
                        + "), elapsed=" + elapsedMs + "ms, sla=" + slaMs + "ms")
                .newAssigneeUuid(supervisorUuid)
                .newLevel(currentLevel + 1)
                .build();
    }

    private String findSupervisorUuid(List<String> currentAssignees, RequestInfo requestInfo, String tenantId) {
        for (String assigneeUuid : currentAssignees) {
            String supervisorUuid = hrmsUtil.getSupervisorUuid(assigneeUuid, requestInfo, tenantId);
            if (supervisorUuid != null) {
                return supervisorUuid;
            }
        }
        return null;
    }

    private static String buildEscalateComment(String supervisorUuid, Map<String, String> summary,
                                               int currentLevel, long elapsedMs, long slaMs) {
        long elapsedH = elapsedMs / (60L * 60L * 1000L);
        long slaH = slaMs / (60L * 60L * 1000L);
        // Three tiers: name+designation → name only → uuid fallback. A partial
        // HRMS summary (designation JsonPath failed but name resolved) still
        // yields a human-readable comment instead of a raw uuid.
        if (summary.containsKey("name") && summary.containsKey("designation")) {
            return String.format("Auto-escalated to %s (%s): SLA breached at level %d (elapsed %dh > SLA %dh)",
                    summary.get("name"), summary.get("designation"), currentLevel, elapsedH, slaH);
        }
        if (summary.containsKey("name")) {
            return String.format("Auto-escalated to %s: SLA breached at level %d (elapsed %dh > SLA %dh)",
                    summary.get("name"), currentLevel, elapsedH, slaH);
        }
        return String.format("Auto-escalated to %s: SLA breached at level %d (elapsed %dh > SLA %dh)",
                supervisorUuid, currentLevel, elapsedH, slaH);
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
     * Gets current assignee UUIDs for a complaint.
     *
     * DIGIT's workflow service has a known quirk: a self-loop ASSIGN action
     * (e.g. PENDINGFORASSIGNMENT → PENDINGATLME → next ASSIGN within
     * PENDINGATLME) can return an empty assignees array on the latest
     * ProcessInstance even though the action carried assignees. Falling back
     * to history=true and walking back to the most recent ProcessInstance
     * with a non-empty assignees list closes that hole.
     */
    public List<String> getCurrentAssignees(String serviceRequestId, String tenantId, RequestInfo requestInfo) {

        StringBuilder url = workflowService.getprocessInstanceSearchURL(tenantId, serviceRequestId);
        RequestInfoWrapper requestInfoWrapper = RequestInfoWrapper.builder().requestInfo(requestInfo).build();

        try {
            Object result = serviceRequestRepository.fetchResult(url, requestInfoWrapper);
            ProcessInstanceResponse response = mapper.convertValue(result, ProcessInstanceResponse.class);
            if (response != null && !CollectionUtils.isEmpty(response.getProcessInstances())) {
                ProcessInstance pi = response.getProcessInstances().get(0);
                if (!CollectionUtils.isEmpty(pi.getAssignes())) {
                    return pi.getAssignes().stream().map(User::getUuid).collect(Collectors.toList());
                }
            }
        } catch (Exception e) {
            log.warn("Current-PI assignee lookup failed for {}, falling back to history", serviceRequestId, e);
        }

        // Fallback: history=true → most recent PI with non-empty assignees
        StringBuilder hUrl = new StringBuilder(url).append("&history=true");
        try {
            Object hResult = serviceRequestRepository.fetchResult(hUrl, requestInfoWrapper);
            ProcessInstanceResponse hResp = mapper.convertValue(hResult, ProcessInstanceResponse.class);
            if (hResp == null || CollectionUtils.isEmpty(hResp.getProcessInstances())) {
                return Collections.emptyList();
            }
            // History is ordered most-recent-first by the workflow service; walk it
            // and pick the first PI that carries assignees.
            for (ProcessInstance pi : hResp.getProcessInstances()) {
                if (!CollectionUtils.isEmpty(pi.getAssignes())) {
                    return pi.getAssignes().stream().map(User::getUuid).collect(Collectors.toList());
                }
            }
            return Collections.emptyList();
        } catch (Exception e) {
            log.error("Failed to get assignees (history fallback) for complaint {}", serviceRequestId, e);
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
