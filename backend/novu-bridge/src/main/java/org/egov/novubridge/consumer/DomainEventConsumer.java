package org.egov.novubridge.consumer;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.producer.Producer;
import org.egov.novubridge.service.DispatchPipelineService;
import org.egov.novubridge.web.models.ComplaintsDomainEvent;
import org.egov.tracer.model.CustomException;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.support.KafkaHeaders;
import org.springframework.messaging.handler.annotation.Header;
import org.springframework.stereotype.Component;

import java.util.HashMap;
import java.util.Map;

/**
 * One consumer, one envelope, one topic per producer ({@code novu.bridge.kafka.input.topics}).
 * The topic never decides how an event is handled — the envelope's {@code eventType} does —
 * so a new producer gets its own topic without any consumer-side branching.
 */
@Component
@Slf4j
public class DomainEventConsumer {

    private final ObjectMapper mapper;
    private final DispatchPipelineService dispatchPipelineService;
    private final Producer producer;
    private final NovuBridgeConfiguration config;

    public DomainEventConsumer(ObjectMapper mapper,
                               DispatchPipelineService dispatchPipelineService,
                               Producer producer,
                               NovuBridgeConfiguration config) {
        this.mapper = mapper;
        this.dispatchPipelineService = dispatchPipelineService;
        this.producer = producer;
        this.config = config;
    }

    @KafkaListener(topics = "#{'${novu.bridge.kafka.input.topics}'.split(',')}")
    public void listen(final HashMap<String, Object> record, @Header(KafkaHeaders.RECEIVED_TOPIC) String topic) {
        ComplaintsDomainEvent event = mapper.convertValue(record, ComplaintsDomainEvent.class);
        try {
            dispatchPipelineService.process(event, true, null);
        } catch (CustomException ce) {
            log.error("Domain event processing failed for eventId={} topic={} code={}", event.getEventId(), topic, ce.getCode(), ce);
            publishDlq(event, topic, ce.getCode(), ce.getMessage());
        } catch (Exception e) {
            log.error("Domain event processing failed for eventId={} topic={}", event.getEventId(), topic, e);
            publishDlq(event, topic, "NB_PROCESSING_ERROR", e.getMessage());
        }
    }

    private void publishDlq(ComplaintsDomainEvent event, String sourceTopic, String errorCode, String errorMessage) {
        Map<String, Object> dlq = new HashMap<>();
        dlq.put("event", event);
        dlq.put("sourceTopic", sourceTopic);
        dlq.put("errorCode", errorCode);
        dlq.put("errorMessage", errorMessage);
        producer.push(event.getTenantId(), config.getDlqTopic(), dlq);
    }
}
