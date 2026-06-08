package org.egov.pgr.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.web.models.Service;
import org.egov.pgr.web.models.ServiceRequest;
import org.egov.pgr.web.models.Workflow;
import org.springframework.stereotype.Component;
import org.springframework.util.CollectionUtils;

import java.util.*;

import static org.egov.pgr.util.PGRConstants.ESCALATE;

@Component
@Slf4j
@RequiredArgsConstructor
public class EscalationService {

    private final WorkflowService workflowService;
    private final RegistryService registryService;
    private final PGRConfiguration config;
    private final ObjectMapper mapper;

    /**
     * Escalates a complaint by transitioning the workflow with ESCALATE action.
     * Supervisor resolution via HRMS is deferred — the workflow engine handles
     * assignee routing based on the configured escalation rules.
     */
    public boolean escalateComplaint(Service complaint, Workflow currentWorkflow) {
        String serviceRequestId = complaint.getServiceRequestId();
        int currentLevel = getEscalationLevel(complaint);

        if (currentLevel >= config.getEscalationMaxDepth()) {
            log.info("Complaint {} already at max escalation depth {}, skipping", serviceRequestId, currentLevel);
            return false;
        }

        List<String> currentAssignees = currentWorkflow != null ? currentWorkflow.getAssignes() : null;
        if (CollectionUtils.isEmpty(currentAssignees)) {
            log.warn("Complaint {} has no current assignees, skipping escalation", serviceRequestId);
            return false;
        }

        Workflow escalationWorkflow = Workflow.builder()
                .action(ESCALATE)
                .assignes(currentAssignees)
                .comments("Auto-escalated: SLA breach at level " + currentLevel)
                .build();

        Map<String, Object> additionalDetails = getAdditionalDetailsMap(complaint);
        additionalDetails.put("escalationLevel", currentLevel + 1);
        additionalDetails.put("lastEscalatedAt", System.currentTimeMillis());
        additionalDetails.put("escalatedFrom", currentAssignees);
        complaint.setAdditionalDetail(additionalDetails);

        ServiceRequest serviceRequest = ServiceRequest.builder()
                .service(complaint)
                .workflow(escalationWorkflow)
                .build();

        try {
            workflowService.updateWorkflowStatus(serviceRequest);
            registryService.update(complaint);
            log.info("Escalated complaint {} to level {}", serviceRequestId, currentLevel + 1);
            return true;
        } catch (Exception e) {
            log.error("Failed to escalate complaint {}", serviceRequestId, e);
            return false;
        }
    }

    @SuppressWarnings("unchecked")
    private int getEscalationLevel(Service complaint) {
        Object additionalDetail = complaint.getAdditionalDetail();
        if (additionalDetail == null) return 0;
        try {
            Map<String, Object> details = additionalDetail instanceof Map
                    ? (Map<String, Object>) additionalDetail
                    : mapper.convertValue(additionalDetail, Map.class);
            Object level = details.get("escalationLevel");
            if (level instanceof Number) return ((Number) level).intValue();
        } catch (Exception e) {
            log.warn("Failed to read escalationLevel from additionalDetails", e);
        }
        return 0;
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> getAdditionalDetailsMap(Service complaint) {
        Object additionalDetail = complaint.getAdditionalDetail();
        if (additionalDetail == null) return new HashMap<>();
        try {
            if (additionalDetail instanceof Map) return new HashMap<>((Map<String, Object>) additionalDetail);
            return mapper.convertValue(additionalDetail, HashMap.class);
        } catch (Exception e) {
            return new HashMap<>();
        }
    }
}
