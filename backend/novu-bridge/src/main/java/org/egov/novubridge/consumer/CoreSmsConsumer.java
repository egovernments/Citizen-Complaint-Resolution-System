package org.egov.novubridge.consumer;

import lombok.extern.slf4j.Slf4j;
import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.producer.Producer;
import org.egov.novubridge.service.core.CoreSmsTranslator;
import org.egov.novubridge.util.PiiMask;
import org.egov.novubridge.web.models.NotificationEvent;
import org.egov.tracer.model.CustomException;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.support.KafkaHeaders;
import org.springframework.messaging.handler.annotation.Header;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Consumes DIGIT core's {@code egov.core.notification.sms} (login OTPs from user-otp, password
 * resets, …), translates each {@code SMSRequest} into the v1 envelope and hands it to the same
 * pipeline as every other event. Replaces the separate egov-notification-sms service.
 */
@Component
@Slf4j
@ConditionalOnProperty(name = "novu.bridge.core.sms.enabled", havingValue = "true", matchIfMissing = true)
public class CoreSmsConsumer {

    private final CoreSmsTranslator translator;
    private final DomainEventConsumer domainEventConsumer;
    private final Producer producer;
    private final NovuBridgeConfiguration config;

    public CoreSmsConsumer(CoreSmsTranslator translator, DomainEventConsumer domainEventConsumer,
                           Producer producer, NovuBridgeConfiguration config) {
        this.translator = translator;
        this.domainEventConsumer = domainEventConsumer;
        this.producer = producer;
        this.config = config;
    }

    /**
     * {@code auto.offset.reset=latest} for THIS listener only. It shares the {@code novu-bridge}
     * group with the domain-event listener, and on a box upgraded from egov-notification-sms that
     * group has never committed an offset on this topic, so the factory-wide {@code earliest} would
     * replay the topic's whole retention (7 days on Redpanda): old OTPs, password resets, HRMS
     * credentials. Starting at the end loses at most what was published between the old service
     * stopping and this listener's first poll; a user whose OTP falls in that gap asks for another.
     * Once an offset is committed, restarts resume from it as usual.
     *
     * <p>Partition, offset and timestamp identify the record ({@link CoreSmsTranslator#recordKey}),
     * so a redelivery after a crash or rebalance is the same transaction and the replay guard does
     * not send the OTP twice.
     */
    @KafkaListener(topics = "${novu.bridge.kafka.core.sms.topic}", properties = "auto.offset.reset=latest")
    public void listen(final HashMap<String, Object> record,
                       @Header(KafkaHeaders.RECEIVED_TOPIC) String topic,
                       @Header(KafkaHeaders.RECEIVED_PARTITION) int partition,
                       @Header(KafkaHeaders.OFFSET) long offset,
                       @Header(KafkaHeaders.RECEIVED_TIMESTAMP) long timestamp) {
        // A stale OTP is useless and misleading; egov-notification-sms dropped it too. No ledger row
        // and no DLQ: nothing is wrong with it, it is just late. The log names neither the phone
        // nor the text, which is the OTP itself.
        long expiredFor = CoreSmsTranslator.expiredForMs(record, System.currentTimeMillis());
        if (expiredFor >= 0) {
            log.info("Core SMS on {} not sent: OTP expired {} ms before it was consumed", topic, expiredFor);
            return;
        }
        NotificationEvent event;
        try {
            event = translator.translate(record, CoreSmsTranslator.recordKey(topic, partition, offset, timestamp));
        } catch (CustomException ce) {
            log.error("Core SMS on {} could not be translated: {}", topic, ce.getMessage());
            publishDlq(record, topic, ce);
            return;
        }
        // handleCoreSms, not handle: this path, and only this one, carries the consent exemption.
        domainEventConsumer.handleCoreSms(event, topic);
    }

    /**
     * The one call that must work after translation already failed, so it never throws: a throw
     * here would have Kafka redeliver the same malformed record and stall the partition. The
     * record's own tenant first (a blank default must not decide a central instance's topic
     * prefix), then the default, then the unprefixed DLQ topic ({@link Producer#push}). The record
     * goes out redacted ({@link CoreSmsTranslator#redactForDlq}): no text, masked phone.
     */
    private void publishDlq(Map<String, Object> record, String topic, CustomException ce) {
        String tenant = config.getCoreSmsDefaultTenant();
        for (String key : new String[] {"tenantId", "tenant"}) {
            Object own = record == null ? null : record.get(key);
            if (own != null && StringUtils.hasText(own.toString())) {
                tenant = own.toString().trim();
                break;
            }
        }
        try {
            List<String> redacted = new ArrayList<>();
            Map<String, Object> dlq = new HashMap<>();
            dlq.put("event", CoreSmsTranslator.redactForDlq(record, redacted));
            dlq.put("redacted", redacted);
            dlq.put("sourceTopic", topic);
            dlq.put("errorCode", ce.getCode());
            dlq.put("errorMessage", PiiMask.maskEmbedded(ce.getMessage()));
            producer.push(tenant, config.getDlqTopic(), dlq);
        } catch (Exception e) {
            // Neither phone nor text: the text is the OTP itself.
            log.error("Core SMS on {} ({}) could not be dead-lettered either, and is dropped: {}",
                    topic, ce.getCode(), e.getMessage());
        }
    }
}
