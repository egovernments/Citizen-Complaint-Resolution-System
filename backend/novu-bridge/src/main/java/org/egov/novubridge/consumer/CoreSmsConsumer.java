package org.egov.novubridge.consumer;

import lombok.extern.slf4j.Slf4j;
import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.producer.Producer;
import org.egov.novubridge.service.core.CoreSmsTranslator;
import org.egov.novubridge.web.models.NotificationEvent;
import org.egov.tracer.model.CustomException;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.support.KafkaHeaders;
import org.springframework.messaging.handler.annotation.Header;
import org.springframework.stereotype.Component;

import java.util.HashMap;
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
     */
    @KafkaListener(topics = "${novu.bridge.kafka.core.sms.topic}", properties = "auto.offset.reset=latest")
    public void listen(final HashMap<String, Object> record, @Header(KafkaHeaders.RECEIVED_TOPIC) String topic) {
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
            event = translator.translate(record);
        } catch (CustomException ce) {
            log.error("Core SMS on {} could not be translated: {}", topic, ce.getMessage());
            Map<String, Object> dlq = new HashMap<>();
            dlq.put("event", record);
            dlq.put("sourceTopic", topic);
            dlq.put("errorCode", ce.getCode());
            dlq.put("errorMessage", ce.getMessage());
            producer.push(config.getCoreSmsDefaultTenant(), config.getDlqTopic(), dlq);
            return;
        }
        domainEventConsumer.handle(event, topic);
    }
}
