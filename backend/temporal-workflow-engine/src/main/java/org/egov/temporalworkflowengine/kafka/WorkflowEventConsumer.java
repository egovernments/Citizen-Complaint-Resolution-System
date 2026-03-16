package org.egov.temporalworkflowengine.kafka;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.egov.temporalworkflowengine.client.WorkflowEngineClient;
import org.egov.temporalworkflowengine.engine.WorkflowCatalog;
import org.egov.temporalworkflowengine.engine.model.ProcessRequest;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.support.KafkaHeaders;
import org.springframework.messaging.handler.annotation.Header;
import org.springframework.stereotype.Component;

@Slf4j
@Component
@RequiredArgsConstructor
public class WorkflowEventConsumer {

    private final WorkflowEngineClient workflowEngineClient;
    private final WorkflowCatalog workflowCatalog;
    private final ObjectMapper objectMapper;

    @KafkaListener(
            topicPattern = "${workflow.engine.kafka.event-topic-pattern:((^[a-zA-Z]+-)?save-pgr-request|(^[a-zA-Z]+-)?update-pgr-request)}",
            containerFactory = "kafkaListenerContainerFactory")
    public void onEvent(String payload, @Header(KafkaHeaders.RECEIVED_TOPIC) String topic) throws Exception {
        Map<String, Object> event = objectMapper.readValue(payload, new TypeReference<>() {});
        ProcessRequest request = workflowCatalog.mapIncomingEvent(topic, event);
        if (request == null) {
            log.debug("No workflow mapping found for topic {}", topic);
            return;
        }
        log.info("Received workflow event topic={} module={} workflow={} businessId={}",
                topic, request.getModule(), request.getWorkflow(), request.getBusinessId());
        if (workflowCatalog.isStartAction(request)) {
            workflowEngineClient.start(request);
        } else {
            workflowEngineClient.signal(request);
        }
    }
}
