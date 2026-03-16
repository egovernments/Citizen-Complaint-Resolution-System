package org.egov.temporalworkflowengine.config;

import io.grpc.Status;
import io.grpc.StatusRuntimeException;
import io.temporal.api.workflowservice.v1.RegisterNamespaceRequest;
import io.temporal.client.WorkflowClient;
import io.temporal.serviceclient.WorkflowServiceStubs;
import io.temporal.serviceclient.WorkflowServiceStubsOptions;
import io.temporal.worker.Worker;
import io.temporal.worker.WorkerFactory;
import java.time.Duration;
import org.egov.temporalworkflowengine.engine.WorkflowCatalog;
import org.egov.temporalworkflowengine.engine.activities.ProcessActivitiesImpl;
import org.egov.temporalworkflowengine.engine.workflow.ConfigDrivenProcessWorkflow;
import org.egov.temporalworkflowengine.engine.workflow.ProcessWorkflow;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class TemporalWorkerConfig {

    @Bean
    WorkflowServiceStubs workflowServiceStubs(WorkflowEngineProperties properties) {
        // Force gRPC Netty to avoid native epoll transport, which is unavailable in restricted environments.
        System.setProperty("io.netty.transport.noNative", "true");
        System.setProperty("io.grpc.netty.shaded.io.netty.transport.noNative", "true");
        WorkflowServiceStubsOptions options = WorkflowServiceStubsOptions.newBuilder()
                .setTarget(properties.getTarget())
                .build();
        return WorkflowServiceStubs.newServiceStubs(options);
    }

    @Bean
    WorkflowClient workflowClient(WorkflowServiceStubs serviceStubs, WorkflowEngineProperties properties) {
        ensureNamespaceExists(serviceStubs, properties);
        return WorkflowClient.newInstance(
                serviceStubs,
                io.temporal.client.WorkflowClientOptions.newBuilder()
                        .setNamespace(properties.getNamespace())
                        .build());
    }

    @Bean(initMethod = "start")
    WorkerFactory workerFactory(
            WorkflowClient workflowClient,
            WorkflowEngineProperties properties,
            ProcessActivitiesImpl processActivities,
            WorkflowCatalog workflowCatalog) {
        WorkerFactory factory = WorkerFactory.newInstance(workflowClient);
        Worker worker = factory.newWorker(properties.getTaskQueue());
        worker.registerWorkflowImplementationFactory(ProcessWorkflow.class, () -> new ConfigDrivenProcessWorkflow(workflowCatalog));
        worker.registerActivitiesImplementations(processActivities);
        return factory;
    }

    private void ensureNamespaceExists(WorkflowServiceStubs serviceStubs, WorkflowEngineProperties properties) {
        try {
            serviceStubs.blockingStub().registerNamespace(
                    RegisterNamespaceRequest.newBuilder()
                            .setNamespace(properties.getNamespace())
                            .setWorkflowExecutionRetentionPeriod(
                                    com.google.protobuf.Duration.newBuilder()
                                            .setSeconds(Duration.ofDays(3).getSeconds())
                                            .build())
                            .build());
        } catch (StatusRuntimeException exception) {
            if (exception.getStatus().getCode() != Status.Code.ALREADY_EXISTS) {
                throw exception;
            }
        }
    }
}
