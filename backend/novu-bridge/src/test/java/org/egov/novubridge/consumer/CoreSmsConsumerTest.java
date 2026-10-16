package org.egov.novubridge.consumer;

import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.producer.Producer;
import org.egov.novubridge.service.core.CoreSmsTranslator;
import org.egov.novubridge.web.models.NotificationEvent;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class CoreSmsConsumerTest {

    private static final String TOPIC = "egov.core.notification.sms";
    private static final long TIMESTAMP = 1790000000000L;

    @Test
    void translatedSms_goesThroughTheSharedHandler_onTheCoreSmsPath() {
        NovuBridgeConfiguration config = new NovuBridgeConfiguration();
        config.setDefaultLocale("en_IN"); config.setCoreSmsDefaultTenant("ke"); config.setDlqTopic("novu-bridge.dlq");
        DomainEventConsumer shared = mock(DomainEventConsumer.class);
        Producer producer = mock(Producer.class);
        CoreSmsConsumer consumer = new CoreSmsConsumer(new CoreSmsTranslator(config), shared, producer, config);

        HashMap<String, Object> sms = new HashMap<>(Map.of("mobileNumber", "+254712345678", "message", "OTP 1234", "category", "OTP"));
        consumer.listen(sms, TOPIC, 0, 42L, TIMESTAMP);

        ArgumentCaptor<NotificationEvent> ev = ArgumentCaptor.forClass(NotificationEvent.class);
        // handleCoreSms, never handle: only this path may carry the consent exemption.
        verify(shared).handleCoreSms(ev.capture(), eq(TOPIC));
        verify(shared, never()).handle(any(), any());
        assertEquals("CORE.SMS.OTP", ev.getValue().getEventName());
        verifyNoInteractions(producer);
    }

    @Test
    void aRedeliveredRecordCarriesTheSameIds_andTheNextRecordDoesNot() {
        NovuBridgeConfiguration config = new NovuBridgeConfiguration();
        config.setDefaultLocale("en_IN"); config.setCoreSmsDefaultTenant("ke");
        DomainEventConsumer shared = mock(DomainEventConsumer.class);
        CoreSmsConsumer consumer = new CoreSmsConsumer(new CoreSmsTranslator(config), shared, mock(Producer.class), config);
        Map<String, Object> sms = Map.of("mobileNumber", "+254712345678", "message", "OTP 1234", "category", "OTP");

        consumer.listen(new HashMap<>(sms), TOPIC, 0, 42L, TIMESTAMP);
        consumer.listen(new HashMap<>(sms), TOPIC, 0, 42L, TIMESTAMP);   // crash/rebalance redelivery
        consumer.listen(new HashMap<>(sms), TOPIC, 0, 43L, TIMESTAMP);   // the user asked again

        ArgumentCaptor<NotificationEvent> ev = ArgumentCaptor.forClass(NotificationEvent.class);
        verify(shared, times(3)).handleCoreSms(ev.capture(), eq(TOPIC));
        List<NotificationEvent> sent = ev.getAllValues();
        assertEquals(sent.get(0).getTransactionId(), sent.get(1).getTransactionId());
        assertEquals(sent.get(0).getEventId(), sent.get(1).getEventId());
        assertFalse(sent.get(0).getTransactionId().equals(sent.get(2).getTransactionId()));
    }

    @Test
    @SuppressWarnings("unchecked")
    void untranslatableSms_goesToTheDlqWithoutItsText_andWithAMaskedPhone() {
        NovuBridgeConfiguration config = new NovuBridgeConfiguration();
        config.setDlqTopic("novu-bridge.dlq");   // no default tenant: translation fails on the tenant
        DomainEventConsumer shared = mock(DomainEventConsumer.class);
        Producer producer = mock(Producer.class);
        CoreSmsConsumer consumer = new CoreSmsConsumer(new CoreSmsTranslator(config), shared, producer, config);

        consumer.listen(new HashMap<>(Map.of("mobileNumber", "0712345678", "message", "Your password is Xy12!pq",
                "category", "PASSWORD_RESET")), TOPIC, 0, 42L, TIMESTAMP);

        verifyNoInteractions(shared);
        ArgumentCaptor<Map<String, Object>> dlq = ArgumentCaptor.forClass(Map.class);
        verify(producer).push(isNull(), eq("novu-bridge.dlq"), dlq.capture());
        assertEquals("NB_INVALID_CORE_SMS", dlq.getValue().get("errorCode"));
        Map<String, Object> event = (Map<String, Object>) dlq.getValue().get("event");
        assertFalse(event.containsKey("message"), "the text must not reach the DLQ: " + event);
        assertEquals("***678", event.get("mobileNumber"));
        assertEquals("PASSWORD_RESET", event.get("category"));
        assertEquals(List.of("message", "mobileNumber"), ((List<String>) dlq.getValue().get("redacted")).stream().sorted().toList());
    }

    @Test
    void untranslatableSms_isDlqdWithItsCode_andNeverReachesThePipeline() {
        NovuBridgeConfiguration config = new NovuBridgeConfiguration();
        config.setCoreSmsDefaultTenant("ke"); config.setDlqTopic("novu-bridge.dlq");
        DomainEventConsumer shared = mock(DomainEventConsumer.class);
        Producer producer = mock(Producer.class);
        CoreSmsConsumer consumer = new CoreSmsConsumer(new CoreSmsTranslator(config), shared, producer, config);

        consumer.listen(new HashMap<>(Map.of("message", "no phone")), TOPIC, 0, 42L, TIMESTAMP);

        verifyNoInteractions(shared);
        @SuppressWarnings("unchecked") ArgumentCaptor<Map<String, Object>> dlq = ArgumentCaptor.forClass(Map.class);
        verify(producer).push(eq("ke"), eq("novu-bridge.dlq"), dlq.capture());
        assertEquals("NB_INVALID_CORE_SMS", dlq.getValue().get("errorCode"));
    }
}
