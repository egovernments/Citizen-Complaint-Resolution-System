package org.egov.temporalworkflowengine.workers;

import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.egov.temporalworkflowengine.config.WorkflowEngineProperties;
import org.springframework.stereotype.Component;

@Slf4j
@Component
@RequiredArgsConstructor
public class WorkerLifecycleLogger {

    private final WorkflowEngineProperties properties;

    @PostConstruct
    void logStartup() {
        log.info(
                "Temporal worker initialized for namespace {} on task queue {}",
                properties.getNamespace(),
                properties.getTaskQueue());
    }
}
