package org.egov.novubridge.consumer;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.producer.Producer;
import org.egov.novubridge.service.DispatchPipelineService;
import org.egov.novubridge.web.models.ComplaintsDomainEvent;
import org.egov.tracer.model.CustomException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Wiring test for {@link UserOtpSmsConsumer} — mirrors
 * {@link DomainEventConsumerWiringTest}'s shape: unit-tested without embedded
 * Kafka, the real risk being the Map -> UserOtpSmsMessage -> ComplaintsDomainEvent
 * adaptation and the DLQ-on-failure routing.
 */
class UserOtpSmsConsumerTest {

    private ObjectMapper mapper;
    private DispatchPipelineService pipeline;
    private Producer producer;
    private NovuBridgeConfiguration config;
    private UserOtpSmsConsumer consumer;

    @BeforeEach
    void setUp() {
        mapper = new ObjectMapper().configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
        pipeline = mock(DispatchPipelineService.class);
        producer = mock(Producer.class);
        config = new NovuBridgeConfiguration();
        config.setDlqTopic("novu-bridge.dlq");
        config.setUserOtpDefaultTenantId("mz");
        consumer = new UserOtpSmsConsumer(mapper, pipeline, producer, config);
    }

    private HashMap<String, Object> payload() {
        HashMap<String, Object> record = new HashMap<>();
        record.put("mobileNumber", "0821234567");
        record.put("message", "Dear Citizen, Your Login OTP is 123456.");
        record.put("category", "LOGIN");
        record.put("currentTime", 1788761899203L);
        record.put("countryCode", "+258");
        return record;
    }

    @Test
    void listen_adaptsToPreRenderedEvent_withLeadingZeroTrimmed() {
        consumer.listen(payload(), "user-otp.sms.dispatch");

        ArgumentCaptor<ComplaintsDomainEvent> captor = ArgumentCaptor.forClass(ComplaintsDomainEvent.class);
        verify(pipeline).process(captor.capture(), eq(true), isNull());

        ComplaintsDomainEvent event = captor.getValue();
        assertEquals("USER_OTP.SEND", event.getEventName());
        assertEquals("USER-OTP", event.getModule());
        assertEquals("mz", event.getTenantId());
        assertEquals("SMS", event.getChannel());
        assertEquals("Dear Citizen, Your Login OTP is 123456.", event.getRenderedBody());
        // leading '0' trimmed from the national number, then country code prepended
        assertEquals("+258821234567", event.getContact().getPhone());
        assertEquals("mz:+258821234567", event.getSubscriberId());
        assertEquals("CITIZEN", event.getContact().getType());
        assertNull(event.getSubject());
    }

    @Test
    void listen_missingLeadingZero_stillFormatsCorrectly() {
        HashMap<String, Object> record = payload();
        record.put("mobileNumber", "821234567");

        consumer.listen(record, "user-otp.sms.dispatch");

        ArgumentCaptor<ComplaintsDomainEvent> captor = ArgumentCaptor.forClass(ComplaintsDomainEvent.class);
        verify(pipeline).process(captor.capture(), eq(true), isNull());
        assertEquals("+258821234567", captor.getValue().getContact().getPhone());
    }

    @Test
    void processingThrowsCustomException_publishesDlq_withErrorCode() {
        when(pipeline.process(any(), anyBoolean(), any()))
                .thenThrow(new CustomException("NB_NOVU_TRIGGER_FAILED", "boom"));

        consumer.listen(payload(), "user-otp.sms.dispatch");

        ArgumentCaptor<Map<String, Object>> dlq = captureDlq();
        assertEquals("NB_NOVU_TRIGGER_FAILED", dlq.getValue().get("errorCode"));
        assertEquals("boom", dlq.getValue().get("errorMessage"));
    }

    @Test
    void processingThrowsGenericException_publishesDlq_withProcessingErrorCode() {
        when(pipeline.process(any(), anyBoolean(), any()))
                .thenThrow(new RuntimeException("kaboom"));

        consumer.listen(payload(), "user-otp.sms.dispatch");

        ArgumentCaptor<Map<String, Object>> dlq = captureDlq();
        assertEquals("NB_PROCESSING_ERROR", dlq.getValue().get("errorCode"));
    }

    @SuppressWarnings("unchecked")
    private ArgumentCaptor<Map<String, Object>> captureDlq() {
        ArgumentCaptor<Map<String, Object>> dlq = ArgumentCaptor.forClass(Map.class);
        verify(producer).push(eq("mz"), eq("novu-bridge.dlq"), dlq.capture());
        return dlq;
    }
}
