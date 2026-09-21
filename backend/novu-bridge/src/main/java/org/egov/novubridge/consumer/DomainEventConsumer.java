package org.egov.novubridge.consumer;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.producer.Producer;
import org.egov.novubridge.service.DispatchPipelineService;
import org.egov.novubridge.service.thin.ThinEventPipelineService;
import org.egov.novubridge.web.models.NotificationEvent;
import org.egov.novubridge.web.models.ThinEvent;
import org.egov.tracer.model.CustomException;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.support.KafkaHeaders;
import org.springframework.messaging.handler.annotation.Header;
import org.springframework.stereotype.Component;

import java.util.HashMap;
import java.util.Map;

/**
 * One consumer, two inbound kinds, one topic per producer ({@code novu.bridge.kafka.input.topics}).
 *
 * <p>The topic never decides how a message is handled — the {@code eventType} decides which
 * producer it is, and the {@code kind} discriminator decides which contract it speaks:
 *
 * <ul>
 *   <li>{@code kind} absent, or {@code RENDERED} — a pre-rendered {@link NotificationEvent}: the
 *       producer resolved the recipient, picked the template and filled it, and the bridge gates,
 *       delivers and records. Absent is the historical form and stays the default forever, which
 *       is what lets every v1 producer written before the thin event existed keep working
 *       untouched.</li>
 *   <li>{@code kind = THIN} — a {@link ThinEvent}: the producer said what happened and the box
 *       decides the rest.</li>
 * </ul>
 *
 * <p><b>Read, not sniffed.</b> The discriminator is taken off the raw map before binding, because
 * binding first would mean choosing a model before knowing which contract applies — and guessing
 * a contract from which fields happen to be set is exactly what the {@code eventType} allowlist
 * exists to avoid. An unrecognised {@code kind} is not guessed at either: it binds as an envelope
 * and is refused by the envelope validator, so it lands in the ledger and the DLQ with a code, not
 * in a log line.
 */
@Component
@Slf4j
public class DomainEventConsumer {

    /** The discriminator's field name on the wire; see {@code contract/README.md}. */
    static final String KIND = "kind";

    private final ObjectMapper mapper;
    private final DispatchPipelineService dispatchPipelineService;
    private final ThinEventPipelineService thinEventPipelineService;
    private final Producer producer;
    private final NovuBridgeConfiguration config;

    public DomainEventConsumer(ObjectMapper mapper,
                               DispatchPipelineService dispatchPipelineService,
                               ThinEventPipelineService thinEventPipelineService,
                               Producer producer,
                               NovuBridgeConfiguration config) {
        this.mapper = mapper;
        this.dispatchPipelineService = dispatchPipelineService;
        this.thinEventPipelineService = thinEventPipelineService;
        this.producer = producer;
        this.config = config;
    }

    @KafkaListener(topics = "#{'${novu.bridge.kafka.input.topics}'.split(',')}")
    public void listen(final HashMap<String, Object> record, @Header(KafkaHeaders.RECEIVED_TOPIC) String topic) {
        if (isThin(record)) {
            handleThin(mapper.convertValue(record, ThinEvent.class), topic);
            return;
        }
        handle(mapper.convertValue(record, NotificationEvent.class), topic);
    }

    /**
     * Whether the raw record declares itself a thin event. Case-insensitive and trimmed, because
     * a producer that shouts its discriminator is not making a different claim; anything other
     * than {@code THIN} — including the explicit {@code RENDERED}, a blank, and a value nobody
     * has ever defined — takes the envelope path, where the envelope validator is the one that
     * gets to refuse it.
     */
    private static boolean isThin(Map<String, Object> record) {
        Object kind = record == null ? null : record.get(KIND);
        return kind != null && ThinEvent.KIND.equalsIgnoreCase(kind.toString().trim());
    }

    /** Run one envelope through the pipeline; any failure is logged and DLQ'd with its code. */
    public void handle(NotificationEvent event, String topic) {
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

    /**
     * Run one thin event through the resolution path. Identical failure handling to the envelope
     * path, and deliberately so: the DLQ message shape is part of the published contract and does
     * not vary by kind. What differs is only what {@code event} holds — the thin event as
     * received, so a replay is possible once the cause is fixed.
     */
    public void handleThin(ThinEvent event, String topic) {
        try {
            thinEventPipelineService.process(event);
        } catch (CustomException ce) {
            log.error("Thin event processing failed for eventId={} topic={} code={}", event.getEventId(), topic, ce.getCode(), ce);
            publishDlq(event, event.getTenantId(), topic, ce.getCode(), ce.getMessage());
        } catch (Exception e) {
            log.error("Thin event processing failed for eventId={} topic={}", event.getEventId(), topic, e);
            publishDlq(event, event.getTenantId(), topic, "NB_PROCESSING_ERROR", e.getMessage());
        }
    }

    private void publishDlq(NotificationEvent event, String sourceTopic, String errorCode, String errorMessage) {
        publishDlq(event, event.getTenantId(), sourceTopic, errorCode, errorMessage);
    }

    private void publishDlq(Object event, String tenantId, String sourceTopic, String errorCode, String errorMessage) {
        Map<String, Object> dlq = new HashMap<>();
        dlq.put("event", event);
        dlq.put("sourceTopic", sourceTopic);
        dlq.put("errorCode", errorCode);
        dlq.put("errorMessage", errorMessage);
        producer.push(tenantId, config.getDlqTopic(), dlq);
    }
}
