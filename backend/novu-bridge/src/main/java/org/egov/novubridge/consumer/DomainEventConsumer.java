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

    @KafkaListener(topics = {"${novu.bridge.kafka.input.topic}", "${novu.bridge.kafka.retry.topic}"})
    public void listen(final HashMap<String, Object> record, @Header(KafkaHeaders.RECEIVED_TOPIC) String topic) {
        boolean fromRetry = topic != null && topic.equals(config.getRetryTopic());

        // Retry-topic messages are wrapped { event, attempt, ... }; input-topic messages are the raw event.
        ComplaintsDomainEvent event = fromRetry
                ? mapper.convertValue(record.get("event"), ComplaintsDomainEvent.class)
                : mapper.convertValue(record, ComplaintsDomainEvent.class);
        int attempt = fromRetry ? asInt(record.get("attempt")) : 0;

        // Space out retries so a brief downstream outage isn't burned through instantly.
        if (fromRetry) {
            backoff();
        }

        try {
            dispatchPipelineService.processEnabledChannels(event, true, null);
        } catch (CustomException ce) {
            handleFailure(event, attempt, ce.getCode(), ce.getMessage(), ce);
        } catch (Exception e) {
            handleFailure(event, attempt, "NB_PROCESSING_ERROR", e.getMessage(), e);
        }
    }

    /**
     * Bounded automatic retry: re-queue the event on the retry topic (incrementing the attempt count)
     * until maxRetries is exhausted, then route it to the DLQ. Recovers from transient downstream
     * failures (e.g. a brief config-service blip) without a manual replay, while still bounding the
     * work and never silently dropping the event.
     */
    private void handleFailure(ComplaintsDomainEvent event, int attempt, String code, String message, Exception cause) {
        int maxRetries = config.getMaxRetries() != null ? config.getMaxRetries() : 0;
        int nextAttempt = attempt + 1;
        if (nextAttempt <= maxRetries) {
            log.warn("Processing failed for eventId={} code={}; scheduling retry {}/{}",
                    event.getEventId(), code, nextAttempt, maxRetries, cause);
            Map<String, Object> retry = new HashMap<>();
            retry.put("event", event);
            retry.put("attempt", nextAttempt);
            retry.put("lastErrorCode", code);
            retry.put("lastErrorMessage", message);
            producer.push(event.getTenantId(), config.getRetryTopic(), retry);
        } else {
            log.error("Processing failed for eventId={} code={}; retries exhausted ({}), routing to DLQ",
                    event.getEventId(), code, maxRetries, cause);
            publishDlq(event, code, message);
        }
    }

    private void backoff() {
        int delay = config.getRetryDelayMs() != null ? config.getRetryDelayMs() : 0;
        if (delay <= 0) {
            return;
        }
        try {
            Thread.sleep(delay);
        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
        }
    }

    private static int asInt(Object value) {
        return (value instanceof Number n) ? n.intValue() : 0;
    }

    private void publishDlq(ComplaintsDomainEvent event, String errorCode, String errorMessage) {
        Map<String, Object> dlq = new HashMap<>();
        dlq.put("event", event);
        dlq.put("errorCode", errorCode);
        dlq.put("errorMessage", errorMessage);
        producer.push(event.getTenantId(), config.getDlqTopic(), dlq);
    }
}
