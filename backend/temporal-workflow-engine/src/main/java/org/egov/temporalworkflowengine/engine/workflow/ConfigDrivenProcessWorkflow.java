package org.egov.temporalworkflowengine.engine.workflow;

import io.temporal.activity.ActivityOptions;
import io.temporal.common.RetryOptions;
import io.temporal.failure.ApplicationFailure;
import io.temporal.workflow.Workflow;
import java.time.Duration;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.HashMap;
import java.util.Map;
import lombok.extern.slf4j.Slf4j;
import org.egov.temporalworkflowengine.engine.WorkflowCatalog;
import org.egov.temporalworkflowengine.engine.WorkflowCatalog.StateDefinition;
import org.egov.temporalworkflowengine.engine.WorkflowCatalog.StepDefinition;
import org.egov.temporalworkflowengine.engine.WorkflowCatalog.TimerDefinition;
import org.egov.temporalworkflowengine.engine.WorkflowCatalog.TransitionDefinition;
import org.egov.temporalworkflowengine.engine.WorkflowCatalog.WorkflowDefinition;
import org.egov.temporalworkflowengine.engine.activities.ProcessActivities;
import org.egov.temporalworkflowengine.engine.model.ProcessRequest;
import org.egov.temporalworkflowengine.engine.model.ProcessResponse;
import org.egov.temporalworkflowengine.engine.model.ProcessSnapshot;

@Slf4j
public class ConfigDrivenProcessWorkflow implements ProcessWorkflow {

    private final WorkflowCatalog workflowCatalog;

    private final ProcessActivities processActivities = Workflow.newActivityStub(
            ProcessActivities.class,
            ActivityOptions.newBuilder()
                    .setStartToCloseTimeout(Duration.ofSeconds(30))
                    .setHeartbeatTimeout(Duration.ofSeconds(10))
                    .setRetryOptions(RetryOptions.newBuilder()
                            .setInitialInterval(Duration.ofSeconds(2))
                            .setBackoffCoefficient(2.0d)
                            .setMaximumAttempts(5)
                            .build())
                    .build());

    private final Deque<ProcessRequest> pendingSignals = new ArrayDeque<>();
    private ProcessSnapshot snapshot;

    public ConfigDrivenProcessWorkflow(WorkflowCatalog workflowCatalog) {
        this.workflowCatalog = workflowCatalog;
    }

    @Override
    public ProcessResponse startProcess(ProcessRequest request) {
        WorkflowDefinition definition = workflowCatalog.getDefinition(request.getModule(), request.getWorkflow());
        snapshot = initialSnapshot(request);
        try {
            snapshot = applyTransition(definition, definition.getStartState(), request);
            while (!isTerminal(definition, snapshot.getState())) {
                snapshot = snapshot.toBuilder()
                        .waitingForSignal(true)
                        .availableActions(workflowCatalog.availableActions(definition, snapshot.getState()))
                        .build();
                TimerDefinition timer = timer(definition, snapshot.getState());
                if (timer != null) {
                    boolean hasSignal = Workflow.await(timer.getAfter(), () -> !pendingSignals.isEmpty());
                    if (!hasSignal) {
                        snapshot = applyTransition(
                                definition,
                                snapshot.getState(),
                                timeoutRequest(request, timer.getAction()));
                        continue;
                    }
                } else {
                    Workflow.await(() -> !pendingSignals.isEmpty());
                }
                ProcessRequest signal = pendingSignals.removeFirst();
                snapshot = applyTransition(definition, snapshot.getState(), signal);
            }
            snapshot = snapshot.toBuilder()
                    .waitingForSignal(false)
                    .availableActions(workflowCatalog.availableActions(definition, snapshot.getState()))
                    .build();
            return ProcessResponse.builder()
                    .workflowId(snapshot.getWorkflowId())
                    .runId(Workflow.getInfo().getRunId())
                    .businessId(snapshot.getBusinessId())
                    .state(snapshot.getState())
                    .assignee(snapshot.getAssignee())
                    .escalated(snapshot.isEscalated())
                    .availableActions(snapshot.getAvailableActions())
                    .message("Process lifecycle completed")
                    .build();
        } catch (Exception exception) {
            handleFailure(exception);
            throw ApplicationFailure.newFailure(
                    "Config driven workflow failed: " + exception.getMessage(),
                    "CONFIG_DRIVEN_WORKFLOW_FAILURE");
        }
    }

    @Override
    public void signalProcess(ProcessRequest request) {
        pendingSignals.addLast(request);
    }

    @Override
    public ProcessSnapshot getSnapshot() {
        return snapshot;
    }

    private ProcessSnapshot applyTransition(WorkflowDefinition definition, String fromState, ProcessRequest request) {
        TransitionDefinition transition = workflowCatalog.findTransition(definition, fromState, request.getAction())
                .orElseThrow(() -> new IllegalArgumentException(
                        "No transition configured for state=" + fromState + ", action=" + request.getAction()));
        ProcessSnapshot current = snapshot.toBuilder()
                .lastAction(request.getAction())
                .signalPayload(request.getPayload())
                .metadata(mergedMetadata(snapshot.getMetadata(), Map.of(
                        "correlationId", request.getCorrelationId(),
                        "actor", request.getActor() == null ? Map.of() : request.getActor())))
                .build();
        for (StepDefinition step : transition.getSteps()) {
            current = processActivities.executeStep(step.getName(), step.getParameters(), current);
        }
        StateDefinition stateDefinition = definition.getStates().get(transition.getToState());
        current = current.toBuilder()
                .state(transition.getToState())
                .businessId(current.getBusinessId() == null ? request.getBusinessId() : current.getBusinessId())
                .tenantId(current.getTenantId() == null ? request.getTenantId() : current.getTenantId())
                .availableActions(workflowCatalog.availableActions(definition, transition.getToState()))
                .waitingForSignal(stateDefinition != null && !stateDefinition.isTerminal())
                .signalPayload(null)
                .build();
        return current;
    }

    private ProcessSnapshot initialSnapshot(ProcessRequest request) {
        return ProcessSnapshot.builder()
                .workflowId(Workflow.getInfo().getWorkflowId())
                .module(request.getModule())
                .workflow(request.getWorkflow())
                .tenantId(request.getTenantId())
                .businessId(request.getBusinessId())
                .state(request.getAction())
                .payload(request.getPayload())
                .signalPayload(request.getPayload())
                .metadata(new HashMap<>())
                .availableActions(java.util.List.of())
                .build();
    }

    private ProcessRequest timeoutRequest(ProcessRequest originalRequest, String action) {
        return originalRequest.toBuilder()
                .workflowId(snapshot.getWorkflowId())
                .businessId(snapshot.getBusinessId())
                .action(action)
                .payload(snapshot.getPayload())
                .build();
    }

    private TimerDefinition timer(WorkflowDefinition definition, String state) {
        StateDefinition stateDefinition = definition.getStates().get(state);
        return stateDefinition == null ? null : stateDefinition.getTimer();
    }

    private boolean isTerminal(WorkflowDefinition definition, String state) {
        StateDefinition stateDefinition = definition.getStates().get(state);
        return stateDefinition != null && stateDefinition.isTerminal();
    }

    private Map<String, Object> mergedMetadata(Map<String, Object> existing, Map<String, Object> updates) {
        Map<String, Object> merged = new HashMap<>(existing == null ? Map.of() : existing);
        merged.putAll(updates);
        return merged;
    }

    private void handleFailure(Exception exception) {
        if (snapshot == null) {
            return;
        }
        Map<String, Object> metadata = mergedMetadata(snapshot.getMetadata(), Map.of("failureReason", exception.getMessage()));
        ProcessSnapshot failed = snapshot.toBuilder().metadata(metadata).build();
        processActivities.executeStep("pushToDeadLetter", Map.of(), failed);
        if (Boolean.TRUE.equals(metadata.get("assignmentCompleted"))) {
            processActivities.executeStep("compensateAssignment", Map.of(), failed);
        }
        if (Boolean.TRUE.equals(metadata.get("complaintPersisted"))) {
            processActivities.executeStep("compensateComplaint", Map.of(), failed);
        }
    }
}
