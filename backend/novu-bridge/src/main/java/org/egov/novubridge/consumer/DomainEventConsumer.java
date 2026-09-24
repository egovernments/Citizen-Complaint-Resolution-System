package org.egov.novubridge.consumer;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.producer.Producer;
import org.egov.novubridge.service.DispatchPipelineService;
import org.egov.novubridge.service.core.CoreSmsTranslator;
import org.egov.novubridge.service.thin.ThinEventPipelineService;
import org.egov.novubridge.util.PiiMask;
import org.egov.novubridge.web.models.NotificationEvent;
import org.egov.novubridge.web.models.ThinEvent;
import org.egov.tracer.model.CustomException;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.support.KafkaHeaders;
import org.springframework.messaging.handler.annotation.Header;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * One consumer for every producer topic ({@code novu.bridge.kafka.input.topics}). The {@code kind}
 * discriminator, read off the raw map before binding, picks the contract: absent or
 * {@code RENDERED} = a pre-rendered {@link NotificationEvent} (the historical default, forever),
 * {@code THIN} = a {@link ThinEvent}. Anything else binds as an envelope and is refused by the
 * envelope validator, so it lands in the ledger and the DLQ with a code.
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

    /** Case-insensitive and trimmed; anything but THIN takes the envelope path. */
    private static boolean isThin(Map<String, Object> record) {
        Object kind = record == null ? null : record.get(KIND);
        return kind != null && ThinEvent.KIND.equalsIgnoreCase(kind.toString().trim());
    }

    /** Run one envelope through the pipeline; any failure is logged and DLQ'd with its code. */
    public void handle(NotificationEvent event, String topic) {
        handle(event, topic, false);
    }

    /**
     * {@link #handle} for an envelope {@link CoreSmsConsumer} translated in this process: the only
     * caller that may reach {@link DispatchPipelineService#processCoreSms} and its consent exemption.
     */
    public void handleCoreSms(NotificationEvent event, String topic) {
        handle(event, topic, true);
    }

    private void handle(NotificationEvent event, String topic, boolean coreSms) {
        try {
            if (coreSms) {
                dispatchPipelineService.processCoreSms(event);
            } else {
                dispatchPipelineService.process(event, true, null);
            }
        } catch (CustomException ce) {
            log.error("Domain event processing failed for eventId={} topic={} code={}", event.getEventId(), topic, ce.getCode(), ce);
            publishDlq(event, topic, ce.getCode(), ce.getMessage());
        } catch (Exception e) {
            log.error("Domain event processing failed for eventId={} topic={}", event.getEventId(), topic, e);
            publishDlq(event, topic, "NB_PROCESSING_ERROR", e.getMessage());
        }
    }

    /** Same failure handling as the envelope path: the DLQ shape is published contract. {@code event} is the thin event as received, so it can be replayed. */
    public void handleThin(ThinEvent event, String topic) {
        try {
            thinEventPipelineService.process(event);
        } catch (CustomException ce) {
            log.error("Thin event processing failed for eventId={} topic={} code={}", event.getEventId(), topic, ce.getCode(), ce);
            publishDlq(event, event.getTenantId(), topic, ce.getCode(), ce.getMessage(), null);
        } catch (Exception e) {
            log.error("Thin event processing failed for eventId={} topic={}", event.getEventId(), topic, e);
            publishDlq(event, event.getTenantId(), topic, "NB_PROCESSING_ERROR", e.getMessage(), null);
        }
    }

    /**
     * A {@code CORE_SMS} envelope, whichever path it came by, is dead-lettered redacted
     * ({@link CoreSmsTranslator#redactForDlq}): its body is an OTP or a password, the DLQ keeps it
     * for days, and a replay would skip the expiry check. Everything else goes as received, so it
     * can be replayed.
     */
    @SuppressWarnings("unchecked")
    private void publishDlq(NotificationEvent event, String sourceTopic, String errorCode, String errorMessage) {
        if (event.getEventType() == null
                || !CoreSmsTranslator.EVENT_TYPE.equalsIgnoreCase(event.getEventType().trim())) {
            publishDlq(event, event.getTenantId(), sourceTopic, errorCode, errorMessage, null);
            return;
        }
        List<String> redacted = new ArrayList<>();
        Map<String, Object> copy = CoreSmsTranslator.redactForDlq(mapper.convertValue(event, Map.class), redacted);
        publishDlq(copy, event.getTenantId(), sourceTopic, errorCode, PiiMask.maskEmbedded(errorMessage), redacted);
    }

    /** @param redacted the fields {@link CoreSmsTranslator#redactForDlq} changed, or null: nothing was */
    private void publishDlq(Object event, String tenantId, String sourceTopic, String errorCode, String errorMessage,
                            List<String> redacted) {
        Map<String, Object> dlq = new HashMap<>();
        dlq.put("event", event);
        if (redacted != null) {
            dlq.put("redacted", redacted);
        }
        dlq.put("sourceTopic", sourceTopic);
        dlq.put("errorCode", errorCode);
        dlq.put("errorMessage", errorMessage);
        producer.push(tenantId, config.getDlqTopic(), dlq);
    }
}
