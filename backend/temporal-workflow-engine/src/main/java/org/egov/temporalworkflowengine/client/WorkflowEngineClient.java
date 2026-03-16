package org.egov.temporalworkflowengine.client;

import io.micrometer.core.instrument.MeterRegistry;
import io.temporal.client.WorkflowClient;
import io.temporal.client.WorkflowOptions;
import io.temporal.client.WorkflowStub;
import java.util.Locale;
import lombok.RequiredArgsConstructor;
import org.apache.commons.lang3.StringUtils;
import org.egov.temporalworkflowengine.config.WorkflowEngineProperties;
import org.egov.temporalworkflowengine.engine.model.ProcessRequest;
import org.egov.temporalworkflowengine.engine.model.ProcessResponse;
import org.egov.temporalworkflowengine.engine.model.ProcessSnapshot;
import org.egov.temporalworkflowengine.engine.workflow.ProcessWorkflow;
import org.springframework.stereotype.Component;

@Component
@RequiredArgsConstructor
public class WorkflowEngineClient {

    private final WorkflowClient workflowClient;
    private final WorkflowEngineProperties properties;
    private final MeterRegistry meterRegistry;

    public ProcessResponse start(ProcessRequest request) {
        String workflowId = resolveWorkflowId(request);
        WorkflowOptions options = WorkflowOptions.newBuilder()
                .setTaskQueue(properties.getTaskQueue())
                .setWorkflowId(workflowId)
                .setWorkflowExecutionTimeout(properties.getWorkflows().getCreate().getExecutionTimeout())
                .setWorkflowTaskTimeout(properties.getWorkflows().getCreate().getTaskTimeout())
                .build();
        ProcessWorkflow workflow = workflowClient.newWorkflowStub(ProcessWorkflow.class, options);
        WorkflowClient.start(workflow::startProcess, request.toBuilder().workflowId(workflowId).build());
        WorkflowStub stub = WorkflowStub.fromTyped(workflow);
        meterRegistry.counter("workflow.engine.started", "operation", "start").increment();
        return ProcessResponse.builder()
                .workflowId(workflowId)
                .runId(stub.getExecution().getRunId())
                .businessId(request.getBusinessId())
                .state("STARTED")
                .availableActions(java.util.List.of())
                .message("Workflow accepted")
                .build();
    }

    public ProcessResponse signal(ProcessRequest request) {
        String workflowId = resolveWorkflowId(request);
        ProcessWorkflow workflow = workflowClient.newWorkflowStub(ProcessWorkflow.class, workflowId);
        workflow.signalProcess(request.toBuilder().workflowId(workflowId).build());
        meterRegistry.counter("workflow.engine.signal", "operation", request.getAction()).increment();
        return ProcessResponse.builder()
                .workflowId(workflowId)
                .businessId(request.getBusinessId())
                .state("SIGNALLED")
                .availableActions(java.util.List.of())
                .message("Signal submitted")
                .build();
    }

    public ProcessSnapshot snapshot(String workflowId) {
        ProcessWorkflow workflow = workflowClient.newWorkflowStub(ProcessWorkflow.class, workflowId);
        return workflow.getSnapshot();
    }

    private String resolveWorkflowId(ProcessRequest request) {
        if (StringUtils.isNotBlank(request.getWorkflowId())) {
            return request.getWorkflowId();
        }
        if (StringUtils.isNotBlank(request.getBusinessId())) {
            return properties.getWorkflowIdPrefix() + normalized(request.getTenantId()) + "-"
                    + normalized(request.getBusinessId());
        }
        return properties.getWorkflowIdPrefix() + normalized(request.getTenantId()) + "-"
                + normalized(request.getCorrelationId());
    }

    private String normalized(String value) {
        return StringUtils.defaultString(value, "unknown")
                .toLowerCase(Locale.ROOT)
                .replaceAll("[^a-z0-9]+", "-");
    }
}
