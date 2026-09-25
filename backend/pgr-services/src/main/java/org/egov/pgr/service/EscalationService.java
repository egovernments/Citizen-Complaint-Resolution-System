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
import java.util.Objects;
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

    /** Bounds the workflow history fetch; workflow-v2 otherwise defaults to 10 rows. */
    private static final int PROCESS_HISTORY_LIMIT = 200;

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
        } else if ("REOPEN".equalsIgnoreCase(action)) {
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
        int currentLevel = Math.max(escalationLevel(persistedService),
                workflowEscalationCount(complaintId, tenantId, requestInfo,
                        escalationWindowStartedAt(persistedService)));
        EscalationConfigurationService.ResolvedEscalationConfig escalationConfig =
                configurationService.resolve(requestInfo, tenantId);
        int maxDepth = escalationConfig.effectiveMaxDepth(persistedService.getServiceCode());

        if (currentLevel >= maxDepth) {
            throw new CustomException("ESCALATION_MAX_DEPTH",
                    "Complaint " + complaintId + " is already at maximum escalation depth");
        }

        if (automatic) {
            validateAutomaticThreshold(persistedService, currentLevel, escalationConfig);
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

    /** Reconciles metadata with workflow history so lagging metadata cannot repeat a rung forever. */
    public int reconciledEscalationLevel(Service complaint, RequestInfo requestInfo) {
        return Math.max(escalationLevel(complaint), workflowEscalationCount(
                complaint.getServiceRequestId(), complaint.getTenantId(), requestInfo,
                escalationWindowStartedAt(complaint)));
    }

    private void validateAutomaticThreshold(Service complaint, int currentLevel,
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
        long createdAt = escalationWindowStartedAt(complaint);
        long threshold = escalationConfig.resolveSla(complaint.getServiceCode(), currentLevel);
        if (createdAt <= 0 || System.currentTimeMillis() - createdAt < threshold) {
            throw new CustomException("ESCALATION_NOT_DUE",
                    "The next cumulative escalation threshold has not been reached");
        }
    }

    /**
     * Who currently holds this complaint, per the workflow source of truth.
     *
     * <p>PGR keeps no assignee on the complaint itself — `eg_pgr_service_v2` has no such
     * column — so ownership has to be derived from workflow. Workflow does not model an
     * owner either: it records transitions, each carrying the assignees that transition was
     * given. Most carry none. On the live `ke` tenant, 778 RESOLVE rows have 76 assignee
     * rows between them, and COMMENT, APPLY, REJECT and RATE have none at all.</p>
     *
     * <p>Reading `ProcessInstances[0].assignes` therefore answers "who did the last
     * transition name", not "who holds this". Any action submitted without assignees — a
     * citizen COMMENT, an ESCALATE, an ASSIGN the operator left blank — makes a complaint
     * with a real owner look unassigned, so the scheduler skips it and the UI hides the
     * actions only its holder should have (#2129, #2138).</p>
     *
     * <p>The holder is instead the assignee named by the most recent transition <em>within
     * the complaint's current state occupancy</em>. Walking back stops the moment the state
     * changes, because leaving a state relinquishes ownership: REASSIGN and REOPEN return
     * the complaint to a queue on purpose, and resurrecting the pre-queue assignee would
     * re-own a complaint nobody has picked up. A complaint that entered its current state
     * without an assignee is genuinely unowned, and still reports empty.</p>
     */
    public List<String> getCurrentAssignees(String serviceRequestId, String tenantId,
                                            RequestInfo requestInfo) {
        StringBuilder url = workflowService.getprocessInstanceSearchURL(tenantId, serviceRequestId);
        // History, because the holder may have been named several transitions ago. Bounded
        // explicitly: egov-workflow-v2 defaults egov.wf.default.limit to 10, and a silently
        // truncated history would drop the very row that names the holder.
        url.append("&history=true&limit=").append(PROCESS_HISTORY_LIMIT);
        RequestInfoWrapper wrapper = RequestInfoWrapper.builder().requestInfo(requestInfo).build();
        Object result = serviceRequestRepository.fetchResult(url, wrapper);

        try {
            ProcessInstanceResponse response = mapper.convertValue(result, ProcessInstanceResponse.class);
            if (response == null || CollectionUtils.isEmpty(response.getProcessInstances())) {
                return Collections.emptyList();
            }
            return assigneesInCurrentOccupancy(response.getProcessInstances());
        } catch (Exception e) {
            log.error("Failed to read workflow assignees for complaint {}", serviceRequestId, e);
            return Collections.emptyList();
        }
    }

    /**
     * Walks newest-first through one state occupancy and returns the first assignees found.
     * The list is ordered newest-first by egov-workflow-v2.
     */
    private List<String> assigneesInCurrentOccupancy(List<ProcessInstance> instances) {
        String currentState = stateOf(instances.get(0));
        for (ProcessInstance instance : instances) {
            if (!Objects.equals(currentState, stateOf(instance))) {
                // Left the current state: anything older belongs to a previous occupancy.
                return Collections.emptyList();
            }
            List<String> assignees = uuidsOf(instance);
            if (!assignees.isEmpty()) {
                return assignees;
            }
        }
        return Collections.emptyList();
    }

    /** The state UUID an instance landed in, or null when workflow did not populate it. */
    private String stateOf(ProcessInstance instance) {
        return instance == null || instance.getState() == null ? null : instance.getState().getUuid();
    }

    private List<String> uuidsOf(ProcessInstance instance) {
        if (instance == null || CollectionUtils.isEmpty(instance.getAssignes())) {
            return Collections.emptyList();
        }
        return instance.getAssignes().stream()
                .map(User::getUuid)
                .filter(uuid -> uuid != null && !uuid.isBlank())
                .collect(Collectors.toList());
    }

    /** Cheap scheduler preflight; the locked update repeats this authoritative check. */
    public boolean hasReportingTo(List<String> assignees, RequestInfo requestInfo, String tenantId) {
        if (CollectionUtils.isEmpty(assignees)) {
            return false;
        }
        String nextAssignee = resolveNextAssignee(assignees, requestInfo, tenantId);
        return nextAssignee != null && !assignees.contains(nextAssignee);
    }

    private int workflowEscalationCount(String serviceRequestId, String tenantId,
                                        RequestInfo requestInfo, long windowStartedAt) {
        StringBuilder url = workflowService.getprocessInstanceSearchURL(tenantId, serviceRequestId);
        url.append("&history=true");
        RequestInfoWrapper wrapper = RequestInfoWrapper.builder().requestInfo(requestInfo).build();
        Object result = serviceRequestRepository.fetchResult(url, wrapper);
        try {
            ProcessInstanceResponse response = mapper.convertValue(result, ProcessInstanceResponse.class);
            if (response == null || CollectionUtils.isEmpty(response.getProcessInstances())) {
                return 0;
            }
            return (int) response.getProcessInstances().stream()
                    .filter(instance -> ESCALATE.equalsIgnoreCase(instance.getAction()))
                    .filter(instance -> windowStartedAt <= 0
                            || (instance.getAuditDetails() != null
                            && instance.getAuditDetails().getCreatedTime() != null
                            && instance.getAuditDetails().getCreatedTime() >= windowStartedAt))
                    .count();
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
