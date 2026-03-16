package org.egov.temporalworkflowengine.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;

@Data
@ConfigurationProperties(prefix = "workflow.engine.kafka")
public class KafkaTopicsProperties {

    private String eventTopicPattern;
    private String deadLetterTopic;
}
