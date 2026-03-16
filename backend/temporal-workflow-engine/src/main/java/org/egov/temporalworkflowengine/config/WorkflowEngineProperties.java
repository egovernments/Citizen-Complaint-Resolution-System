package org.egov.temporalworkflowengine.config;

import java.time.Duration;
import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;

@Data
@ConfigurationProperties(prefix = "temporal")
public class WorkflowEngineProperties {

    private String namespace;
    private String target;
    private String taskQueue;
    private String workflowIdPrefix;
    private WorkflowProperties workflows = new WorkflowProperties();
    private ActivityProperties activities = new ActivityProperties();

    @Data
    public static class WorkflowProperties {
        private TimeoutProperties create = new TimeoutProperties();
        private TimeoutProperties update = new TimeoutProperties();
    }

    @Data
    public static class TimeoutProperties {
        private Duration executionTimeout = Duration.ofHours(24);
        private Duration taskTimeout = Duration.ofSeconds(30);
        private boolean autoEscalationEnabled;
        private Duration autoEscalationTimeout = Duration.ofMinutes(30);
    }

    @Data
    public static class ActivityProperties {
        private Duration startToCloseTimeout = Duration.ofSeconds(30);
        private Duration heartbeatTimeout = Duration.ofSeconds(10);
        private RetryProperties retry = new RetryProperties();
    }

    @Data
    public static class RetryProperties {
        private Duration initialInterval = Duration.ofSeconds(2);
        private double backoffCoefficient = 2.0d;
        private int maximumAttempts = 5;
    }
}
