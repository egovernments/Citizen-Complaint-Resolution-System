package org.egov.pgr.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.egov.common.contract.request.RequestInfo;
import org.egov.common.contract.request.User;
import org.egov.pgr.repository.ServiceRequestRepository;
import org.egov.pgr.util.HRMSUtil;
import org.egov.pgr.web.models.RequestInfoWrapper;
import org.egov.pgr.web.models.Service;
import org.egov.pgr.web.models.ServiceRequest;
import org.egov.pgr.web.models.Workflow;
import org.egov.pgr.web.models.workflow.ProcessInstance;
import org.egov.pgr.web.models.workflow.ProcessInstanceResponse;
import org.egov.tracer.model.CustomException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.util.CollectionUtils;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

import static org.egov.pgr.util.PGRConstants.ESCALATE;

/**
 * The shared escalation domain operation. Manual and automatic callers both
 * enter here through {@link PGRService#update(ServiceRequest)}.
 */
@Component
@Slf4j
public class EscalationService {

    private static final String REOPEN = "REOPEN";

    public static final String ASSIGNMENT_CHANGED_AT = "assignmentChangedAt";
    public static final String ASSIGNMENT_CHANGE_SOURCE = "assignmentChangeSource";
    public static final String ESCALATION_LEVEL = "escalationLevel";
    public static final String ESCALATION_WINDOW_STARTED_AT = "escalationWindowStartedAt";
    public static final String LAST_ESCALATED_AT = "lastEscalatedAt";
    public static final String ESCALATED_FROM = "escalatedFrom";
    public static final String ESCALATED_TO = "escalatedTo";
    public static final String ESCALATION_TRIGGER = "escalationTrigger";

    private static final Set<String> SERVER_MANAGED_METADATA = Set.of(
            ASSIGNMENT_CHANGED_AT,
            ASSIGNMENT_CHANGE_SOURCE,
            ESCALATION_LEVEL,
            ESCALATION_WINDOW_STARTED_AT,
            LAST_ESCALATED_AT,
            ESCALATED_FROM,
            ESCALATED_TO,
            ESCALATION_TRIGGER
    );

    private final HRMSUtil hrmsUtil;
    private final WorkflowService workflowService;
    private final ServiceRequestRepository serviceRequestRepository;
    private final EscalationConfigurationService configurationService;
    private final ObjectMapper mapper;

    @Autowired
    public EscalationService(HRMSUtil hrmsUtil,
                             WorkflowService workflowService,
                             ServiceRequestRepository serviceRequestRepository,
                             EscalationConfigurationService configurationService,
                             ObjectMapper mapper) {
        this.hrmsUtil = hrmsUtil;
        this.workflowService = workflowService;
        this.serviceRequestRepository = serviceRequestRepository;
        this.configurationService = configurationService;
        this.mapper = mapper;
    }

    /** Removes metadata that only the service may originate. */
    public void prepareCreate(Service service) {
        Map<String, Object> additionalDetails = details(service);
        SERVER_MANAGED_METADATA.forEach(additionalDetails::remove);
        service.setAdditionalDetail(additionalDetails);
    }

    /**
     * Preserves server-managed assignment metadata for every update and, for
     * ESCALATE, resolves the next reportingTo employee and advances the shared
     * hierarchy metadata exactly once.
     */
    public void prepareUpdate(ServiceRequest request, Service persistedService) {
        prepareUpdate(request, persistedService, isAutomatic(request.getRequestInfo()));
    }

    public void prepareUpdate(ServiceRequest request, Service persistedService, boolean automatic) {
        if (request == null || request.getService() == null || request.getWorkflow() == null) {
            return;
        }

        Map<String, Object> incoming = details(request.getService());
        Map<String, Object> persisted = details(persistedService);
        preserveServerMetadata(incoming, persisted);

        String action = request.getWorkflow().getAction();
        if (action != null && ESCALATE.equalsIgnoreCase(action)) {
            prepareEscalation(request, persistedService, incoming, automatic);
        } else if (REOPEN.equalsIgnoreCase(action)) {
            // A reopened complaint starts a fresh cumulative escalation cycle. Using the
            // original creation time would make an old complaint immediately consume rungs.
            incoming.put(ESCALATION_LEVEL, 0);
            incoming.put(ESCALATION_WINDOW_STARTED_AT, System.currentTimeMillis());
            incoming.remove(LAST_ESCALATED_AT);
            incoming.remove(ESCALATED_FROM);
            incoming.remove(ESCALATED_TO);
            incoming.remove(ESCALATION_TRIGGER);
        } else if (changesAssignment(action, request.getWorkflow())) {
            long now = System.currentTimeMillis();
            incoming.put(ASSIGNMENT_CHANGED_AT, now);
            incoming.put(ASSIGNMENT_CHANGE_SOURCE, action.toUpperCase());
            // First assignment starts at rung zero; later reassignments preserve consumed rungs.
            incoming.putIfAbsent(ESCALATION_LEVEL, 0);
        }

        request.getService().setAdditionalDetail(incoming);
    }

    private void prepareEscalation(ServiceRequest request, Service persistedService,
                                   Map<String, Object> details, boolean automatic) {
        String tenantId = persistedService.getTenantId();
        String complaintId = persistedService.getServiceRequestId();
        RequestInfo requestInfo = request.getRequestInfo();
        ReconciledEscalation reconciled = reconcile(persistedService, requestInfo);
        int currentLevel = reconciled.level();
        EscalationConfigurationService.ResolvedEscalationConfig escalationConfig =
                configurationService.resolve(requestInfo, tenantId);
        int maxDepth = escalationConfig.effectiveMaxDepth(persistedService.getServiceCode());

        if (currentLevel >= maxDepth) {
            throw new CustomException("ESCALATION_MAX_DEPTH",
                    "Complaint " + complaintId + " is already at maximum escalation depth");
        }

        if (automatic) {
            validateAutomaticThreshold(persistedService, currentLevel,
                    reconciled.windowStartedAt(), escalationConfig);
        }

        List<String> currentAssignees = getCurrentAssignees(complaintId, tenantId, requestInfo);
        if (currentAssignees.isEmpty()) {
            throw new CustomException("ESCALATION_NO_ASSIGNEE",
                    "An unassigned complaint cannot be escalated; use ASSIGN");
        }

        String expectedAssignee = resolveNextAssignee(currentAssignees, requestInfo, tenantId);
        if (expectedAssignee == null) {
            throw new CustomException("ESCALATION_TOP_OF_HIERARCHY",
                    "No reportingTo employee exists for the current assignee");
        }
        if (currentAssignees.contains(expectedAssignee)) {
            throw new CustomException("ESCALATION_HIERARCHY_CYCLE",
                    "HRMS reportingTo points back to a current assignee");
        }

        List<String> requestedAssignees = request.getWorkflow().getAssignes();
        if (!CollectionUtils.isEmpty(requestedAssignees)
                && (requestedAssignees.size() != 1 || !expectedAssignee.equals(requestedAssignees.get(0)))) {
            throw new CustomException("INVALID_ESCALATION_ASSIGNEE",
                    "ESCALATE can only assign the current employee's reportingTo; use REASSIGN otherwise");
        }

        request.getWorkflow().setAssignes(Collections.singletonList(expectedAssignee));
        long now = System.currentTimeMillis();
        String trigger = automatic ? "AUTOMATIC" : "MANUAL";
        details.put(ESCALATION_LEVEL, currentLevel + 1);
        details.put(LAST_ESCALATED_AT, now);
        details.put(ASSIGNMENT_CHANGED_AT, now);
        details.put(ASSIGNMENT_CHANGE_SOURCE, trigger + "_ESCALATION");
        details.put(ESCALATED_FROM, new ArrayList<>(currentAssignees));
        details.put(ESCALATED_TO, expectedAssignee);
        details.put(ESCALATION_TRIGGER, trigger);
    }

    public Map<String, Object> buildEscalationEvent(ServiceRequest request) {
        Service service = request.getService();
        Map<String, Object> details = details(service);
        Map<String, Object> event = new LinkedHashMap<>();
        event.put("serviceRequestId", service.getServiceRequestId());
        event.put("tenantId", service.getTenantId());
        event.put(ESCALATION_LEVEL, details.get(ESCALATION_LEVEL));
        event.put("previousAssignees", details.get(ESCALATED_FROM));
        event.put("newAssignee", details.get(ESCALATED_TO));
        event.put("trigger", details.get(ESCALATION_TRIGGER));
        event.put("timestamp", details.get(LAST_ESCALATED_AT));
        return event;
    }

    /** Escalation thresholds are cumulative from creation, or from the latest reopen. */
    public long escalationWindowStartedAt(Service complaint) {
        Object configuredStart = details(complaint).get(ESCALATION_WINDOW_STARTED_AT);
        if (configuredStart instanceof Number number && number.longValue() > 0) {
            return number.longValue();
        }
        if (complaint.getAuditDetails() == null) {
            return 0L;
        }
        Long created = complaint.getAuditDetails().getCreatedTime();
        return created == null ? 0L : created;
    }

    public int escalationLevel(Service complaint) {
        Object level = details(complaint).get(ESCALATION_LEVEL);
        return level instanceof Number number ? Math.max(number.intValue(), 0) : 0;
    }

    /** The escalation ladder position and cycle start, reconciled against workflow history. */
    public record ReconciledEscalation(int level, long windowStartedAt) {
    }

    /**
     * Reconciles metadata with workflow history for two independent failure modes.
     *
     * <p>Lagging metadata must not let a rung repeat forever, so the ladder position is
     * never lower than the number of ESCALATE transitions actually recorded.</p>
     *
     * <p>A REOPEN starts a fresh cycle. {@code prepareUpdate} writes that reset into
     * {@code additionalDetails}, but a complaint whose reset did not survive would
     * otherwise keep counting the rungs it consumed before being reopened and stay
     * pinned at maximum depth for good (#2126). Workflow history always retains the
     * REOPEN, so a reopen newer than the recorded window is authoritative: the cycle
     * restarts there and pre-reopen metadata is discarded rather than merged.</p>
     */
    public ReconciledEscalation reconcile(Service complaint, RequestInfo requestInfo) {
        long metadataWindow = escalationWindowStartedAt(complaint);
        EscalationHistory history = readEscalationHistory(
                complaint.getServiceRequestId(), complaint.getTenantId(), requestInfo);

        if (history.lastReopenAt() > metadataWindow) {
            return new ReconciledEscalation(
                    history.escalationsSince(history.lastReopenAt()), history.lastReopenAt());
        }
        return new ReconciledEscalation(
                Math.max(escalationLevel(complaint), history.escalationsSince(metadataWindow)),
                metadataWindow);
    }

    private void validateAutomaticThreshold(Service complaint, int currentLevel, long windowStartedAt,
            EscalationConfigurationService.ResolvedEscalationConfig escalationConfig) {
        String status = complaint.getApplicationStatus();
        if (status == null || !escalationConfig.getEligibleStatuses().contains(status.toUpperCase(Locale.ROOT))) {
            throw new CustomException("ESCALATION_STATUS_NOT_ELIGIBLE",
                    "Complaint is not in an automatic-escalation state");
        }
        if (!escalationConfig.isEnabled(complaint.getServiceCode(), currentLevel)) {
            throw new CustomException("ESCALATION_LEVEL_DISABLED",
                    "Automatic escalation is disabled at the current level");
        }
        long createdAt = windowStartedAt;
        long threshold = escalationConfig.resolveSla(complaint.getServiceCode(), currentLevel);
        if (createdAt <= 0 || System.currentTimeMillis() - createdAt < threshold) {
            throw new CustomException("ESCALATION_NOT_DUE",
                    "The next cumulative escalation threshold has not been reached");
        }
    }

    /** Gets current assignees from the workflow process-instance source of truth. */
    public List<String> getCurrentAssignees(String serviceRequestId, String tenantId,
                                            RequestInfo requestInfo) {
        StringBuilder url = workflowService.getprocessInstanceSearchURL(tenantId, serviceRequestId);
        RequestInfoWrapper wrapper = RequestInfoWrapper.builder().requestInfo(requestInfo).build();
        Object result = serviceRequestRepository.fetchResult(url, wrapper);

        try {
            ProcessInstanceResponse response = mapper.convertValue(result, ProcessInstanceResponse.class);
            if (response == null || CollectionUtils.isEmpty(response.getProcessInstances())) {
                return Collections.emptyList();
            }
            ProcessInstance instance = response.getProcessInstances().get(0);
            if (CollectionUtils.isEmpty(instance.getAssignes())) {
                return Collections.emptyList();
            }
            return instance.getAssignes().stream()
                    .map(User::getUuid)
                    .filter(uuid -> uuid != null && !uuid.isBlank())
                    .collect(Collectors.toList());
        } catch (Exception e) {
            log.error("Failed to read workflow assignees for complaint {}", serviceRequestId, e);
            return Collections.emptyList();
        }
    }

    /** Cheap scheduler preflight; the locked update repeats this authoritative check. */
    public boolean hasReportingTo(List<String> assignees, RequestInfo requestInfo, String tenantId) {
        if (CollectionUtils.isEmpty(assignees)) {
            return false;
        }
        String nextAssignee = resolveNextAssignee(assignees, requestInfo, tenantId);
        return nextAssignee != null && !assignees.contains(nextAssignee);
    }

    /** ESCALATE timestamps and the latest REOPEN, read from workflow history in one request. */
    private record EscalationHistory(List<Long> escalatedAt, long lastReopenAt) {

        int escalationsSince(long cutoff) {
            if (cutoff <= 0) {
                return escalatedAt.size();
            }
            return (int) escalatedAt.stream().filter(at -> at >= cutoff).count();
        }
    }

    private EscalationHistory readEscalationHistory(String serviceRequestId, String tenantId,
                                                    RequestInfo requestInfo) {
        StringBuilder url = workflowService.getprocessInstanceSearchURL(tenantId, serviceRequestId);
        url.append("&history=true");
        RequestInfoWrapper wrapper = RequestInfoWrapper.builder().requestInfo(requestInfo).build();
        Object result = serviceRequestRepository.fetchResult(url, wrapper);
        try {
            ProcessInstanceResponse response = mapper.convertValue(result, ProcessInstanceResponse.class);
            if (response == null || CollectionUtils.isEmpty(response.getProcessInstances())) {
                return new EscalationHistory(Collections.emptyList(), 0L);
            }
            List<Long> escalatedAt = new ArrayList<>();
            long lastReopenAt = 0L;
            for (ProcessInstance instance : response.getProcessInstances()) {
                Long at = instance.getAuditDetails() == null
                        ? null : instance.getAuditDetails().getCreatedTime();
                if (at == null) {
                    continue;
                }
                if (ESCALATE.equalsIgnoreCase(instance.getAction())) {
                    escalatedAt.add(at);
                } else if (REOPEN.equalsIgnoreCase(instance.getAction())) {
                    lastReopenAt = Math.max(lastReopenAt, at);
                }
            }
            return new EscalationHistory(escalatedAt, lastReopenAt);
        } catch (Exception e) {
            throw new CustomException("ESCALATION_HISTORY_ERROR",
                    "Failed to reconcile escalation history for complaint " + serviceRequestId);
        }
    }

    private String resolveNextAssignee(List<String> currentAssignees, RequestInfo requestInfo,
                                       String tenantId) {
        for (String assignee : currentAssignees) {
            String reportingTo = hrmsUtil.getSupervisorUuid(assignee, requestInfo, tenantId);
            if (reportingTo != null && !reportingTo.isBlank()) {
                return reportingTo;
            }
        }
        return null;
    }

    private boolean changesAssignment(String action, Workflow workflow) {
        return action != null
                && ("ASSIGN".equalsIgnoreCase(action) || "REASSIGN".equalsIgnoreCase(action))
                && !CollectionUtils.isEmpty(workflow.getAssignes());
    }

    private boolean isAutomatic(RequestInfo requestInfo) {
        return requestInfo != null && requestInfo.getUserInfo() != null
                && "SYSTEM".equalsIgnoreCase(requestInfo.getUserInfo().getType());
    }

    private void preserveServerMetadata(Map<String, Object> incoming, Map<String, Object> persisted) {
        for (String key : SERVER_MANAGED_METADATA) {
            if (persisted.containsKey(key)) {
                incoming.put(key, persisted.get(key));
            } else {
                incoming.remove(key);
            }
        }
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> details(Service service) {
        if (service == null || service.getAdditionalDetail() == null) {
            return new LinkedHashMap<>();
        }
        Object raw = service.getAdditionalDetail();
        try {
            if (raw instanceof Map<?, ?> map) {
                return new LinkedHashMap<>((Map<String, Object>) map);
            }
            return mapper.convertValue(raw, LinkedHashMap.class);
        } catch (Exception e) {
            log.warn("Failed to read complaint additionalDetails; using an empty object", e);
            return new LinkedHashMap<>();
        }
    }
}
