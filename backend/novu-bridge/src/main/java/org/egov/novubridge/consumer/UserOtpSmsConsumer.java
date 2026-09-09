package org.egov.novubridge.consumer;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.producer.Producer;
import org.egov.novubridge.service.DispatchPipelineService;
import org.egov.novubridge.web.models.ComplaintsDomainEvent;
import org.egov.novubridge.web.models.Contact;
import org.egov.novubridge.web.models.UserOtpSmsMessage;
import org.egov.tracer.model.CustomException;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.support.KafkaHeaders;
import org.springframework.messaging.handler.annotation.Header;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/**
 * Bridges the real, unmodified DIGIT-Core {@code user-otp} service's own
 * SMS-dispatch topic into the pre-rendered pass-through pipeline PGR complaint
 * notifications already use. See docs/notifications-guide/06-otp-flow.md §6.8.
 *
 * <p>{@code user-otp} publishes a flat, ALREADY-RENDERED message
 * ({@link UserOtpSmsMessage} — mirrors its own {@code SMSRequest}) to its
 * {@code sms.topic} property (env {@code SMS_TOPIC}), because that's the shape
 * {@code egov-notification-sms} expects. Pointing that env var at
 * {@link NovuBridgeConfiguration#getUserOtpSmsTopic()} instead is the ONLY
 * change required on the user-otp side — no fork, no source change there, and
 * PGR's own {@code complaints.domain.events} traffic is never touched, since
 * this listens on a dedicated topic.
 *
 * <p>This adapts that flat message into a pre-rendered {@link ComplaintsDomainEvent}
 * (channel + contact + renderedBody + subscriberId) so it flows through
 * {@link DispatchPipelineService#process}'s existing pass-through path — the
 * same one PGR uses — rather than the OTP-specific {@code processOtp()} branch.
 * That branch is otp-publisher's path: it expects a raw, unrendered OTP value
 * and builds its own hardcoded body. Here the message is already fully
 * rendered and localized by user-otp, so it must not be re-templated.
 */
@Component
@Slf4j
public class UserOtpSmsConsumer {

    private final ObjectMapper mapper;
    private final DispatchPipelineService dispatchPipelineService;
    private final Producer producer;
    private final NovuBridgeConfiguration config;

    public UserOtpSmsConsumer(ObjectMapper mapper,
                               DispatchPipelineService dispatchPipelineService,
                               Producer producer,
                               NovuBridgeConfiguration config) {
        this.mapper = mapper;
        this.dispatchPipelineService = dispatchPipelineService;
        this.producer = producer;
        this.config = config;
    }

    @KafkaListener(topics = "${novu.bridge.kafka.user-otp.sms.topic:egov.core.notification.sms.otp}")
    public void listen(final HashMap<String, Object> record, @Header(KafkaHeaders.RECEIVED_TOPIC) String topic) {
        UserOtpSmsMessage message = mapper.convertValue(record, UserOtpSmsMessage.class);
        ComplaintsDomainEvent event = adapt(message);
        try {
            dispatchPipelineService.process(event, true, null);
        } catch (CustomException ce) {
            log.error("user-otp SMS dispatch failed for eventId={} code={}", event.getEventId(), ce.getCode(), ce);
            publishDlq(event, ce.getCode(), ce.getMessage());
        } catch (Exception e) {
            log.error("user-otp SMS dispatch failed for eventId={} topic={}", event.getEventId(), topic, e);
            publishDlq(event, "NB_PROCESSING_ERROR", e.getMessage());
        }
    }

    private ComplaintsDomainEvent adapt(UserOtpSmsMessage message) {
        // SMSRequest carries no tenantId (see UserOtpSmsMessage javadoc) — fall back
        // to the configured default and make that visible, rather than silently
        // mis-tagging every dispatch-log row in a deployment that ever becomes
        // genuinely multi-tenant.
        String tenantId = config.getUserOtpDefaultTenantId();
        log.warn("user-otp SMS message carries no tenantId; using configured default tenantId={}", tenantId);

        String countryCode = StringUtils.hasText(message.getCountryCode()) ? message.getCountryCode() : "";
        String mobile = trimLeadingZero(message.getMobileNumber());
        String phone = countryCode + mobile;

        String eventId = UUID.randomUUID().toString();
        String subscriberId = tenantId + ":" + phone;

        Contact contact = Contact.builder()
                .type("CITIZEN")
                .phone(phone)
                .build();

        return ComplaintsDomainEvent.builder()
                .eventId(eventId)
                .eventType("OTP")
                .eventName("USER_OTP.SEND")
                .module("USER-OTP")
                .entityType("OTP_CODE")
                .entityId(eventId)
                .tenantId(tenantId)
                .channel("SMS")
                .subscriberId(subscriberId)
                .contact(contact)
                .renderedBody(message.getMessage())
                .transactionId(eventId)
                .build();
    }

    private static String trimLeadingZero(String mobile) {
        return StringUtils.hasText(mobile) && mobile.startsWith("0") ? mobile.substring(1) : mobile;
    }

    private void publishDlq(ComplaintsDomainEvent event, String errorCode, String errorMessage) {
        Map<String, Object> dlq = new HashMap<>();
        dlq.put("event", event);
        dlq.put("errorCode", errorCode);
        dlq.put("errorMessage", errorMessage);
        producer.push(event.getTenantId(), config.getDlqTopic(), dlq);
    }
}
