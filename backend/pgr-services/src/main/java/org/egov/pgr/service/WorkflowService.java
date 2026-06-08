package org.egov.pgr.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.digit.services.workflow.WorkflowClient;
import org.digit.services.workflow.model.WorkflowState;
import org.digit.services.workflow.model.WorkflowTransitionRequest;
import org.digit.services.workflow.model.WorkflowTransitionResponse;
import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.web.models.Service;
import org.egov.pgr.web.models.ServiceRequest;
import org.egov.pgr.web.models.Workflow;
import org.springframework.stereotype.Component;
import org.springframework.util.CollectionUtils;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

@Slf4j
@Component
@RequiredArgsConstructor
public class WorkflowService {

    private final WorkflowClient workflowClient;
    private final PGRConfiguration config;

    private final Map<String, String> stateNameMap = new ConcurrentHashMap<>();
    private volatile boolean stateMapLoaded = false;

    public String updateWorkflowStatus(ServiceRequest request) {
        Service service = request.getService();
        Workflow workflow = request.getWorkflow();

        if (workflow == null || workflow.getAction() == null || workflow.getAction().isBlank()) {
            log.warn("No workflow action provided for {}", service.getServiceRequestId());
            return service.getApplicationStatus();
        }

        Map<String, List<String>> attributes = new HashMap<>();
        attributes.put("roles", request.getRoles() != null ? request.getRoles() : Collections.emptyList());
        if (!CollectionUtils.isEmpty(workflow.getAssignes())) {
            attributes.put("assignes", workflow.getAssignes());
        }

        WorkflowTransitionRequest wfRequest = WorkflowTransitionRequest.builder()
                .processCode(config.getWorkflowProcessCode())
                .entityId(service.getServiceRequestId())
                .action(workflow.getAction())
                .comment(workflow.getComments())
                .attributes(attributes)
                .build();

        try {
            WorkflowTransitionResponse response = workflowClient.executeTransition(wfRequest);
            if (response != null) {
                ensureStateMapLoaded();
                String stateId = response.getCurrentState();
                String stateName = stateNameMap.getOrDefault(stateId, stateId);
                service.setApplicationStatus(stateName);
                service.setWorkflowInstanceId(response.getId());
                return stateName;
            }
        } catch (Exception e) {
            log.error("Workflow transition failed for {} action={}", service.getServiceRequestId(), workflow.getAction(), e);
            throw new RuntimeException("Workflow transition failed: " + e.getMessage(), e);
        }

        return service.getApplicationStatus();
    }

    public void enrichWorkflow(List<org.egov.pgr.web.models.ServiceWrapper> serviceWrappers) {
        for (org.egov.pgr.web.models.ServiceWrapper wrapper : serviceWrappers) {
            String serviceRequestId = wrapper.getService().getServiceRequestId();
            try {
                WorkflowTransitionResponse response = workflowClient.executeTransition(
                        WorkflowTransitionRequest.builder()
                                .processCode(config.getWorkflowProcessCode())
                                .entityId(serviceRequestId)
                                .build());
                if (response != null && wrapper.getWorkflow() != null) {
                    wrapper.getWorkflow().setAction(response.getAction());
                }
            } catch (Exception e) {
                log.warn("Could not enrich workflow for {}: {}", serviceRequestId, e.getMessage());
            }
        }
    }

    private void ensureStateMapLoaded() {
        if (stateMapLoaded) return;
        synchronized (stateNameMap) {
            if (stateMapLoaded) return;
            try {
                List<WorkflowState> states = workflowClient.listStates(config.getWorkflowProcessCode());
                for (WorkflowState state : states) {
                    stateNameMap.put(state.getId(), state.getName());
                }
                stateMapLoaded = true;
                log.info("Loaded {} workflow states for process {}", stateNameMap.size(), config.getWorkflowProcessCode());
            } catch (Exception e) {
                log.warn("Failed to load workflow state names: {}", e.getMessage());
            }
        }
    }
}
