package org.egov.novubridge.consumer;

import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.producer.Producer;
import org.egov.novubridge.service.core.CoreSmsTranslator;
import org.egov.novubridge.web.models.NotificationEvent;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class CoreSmsConsumerTest {

    @Test
    void translatedSms_goesThroughTheSharedHandler() {
        NovuBridgeConfiguration config = new NovuBridgeConfiguration();
        config.setDefaultLocale("en_IN"); config.setCoreSmsDefaultTenant("ke"); config.setDlqTopic("novu-bridge.dlq");
        DomainEventConsumer shared = mock(DomainEventConsumer.class);
        Producer producer = mock(Producer.class);
        CoreSmsConsumer consumer = new CoreSmsConsumer(new CoreSmsTranslator(config), shared, producer, config);

        HashMap<String, Object> sms = new HashMap<>(Map.of("mobileNumber", "+254712345678", "message", "OTP 1234", "category", "OTP"));
        consumer.listen(sms, "egov.core.notification.sms");

        ArgumentCaptor<NotificationEvent> ev = ArgumentCaptor.forClass(NotificationEvent.class);
        verify(shared).handle(ev.capture(), eq("egov.core.notification.sms"));
        assertEquals("CORE.SMS.OTP", ev.getValue().getEventName());
        verifyNoInteractions(producer);
    }

    @Test
    void untranslatableSms_isDlqdWithItsCode_andNeverReachesThePipeline() {
        NovuBridgeConfiguration config = new NovuBridgeConfiguration();
        config.setCoreSmsDefaultTenant("ke"); config.setDlqTopic("novu-bridge.dlq");
        DomainEventConsumer shared = mock(DomainEventConsumer.class);
        Producer producer = mock(Producer.class);
        CoreSmsConsumer consumer = new CoreSmsConsumer(new CoreSmsTranslator(config), shared, producer, config);

        consumer.listen(new HashMap<>(Map.of("message", "no phone")), "egov.core.notification.sms");

        verifyNoInteractions(shared);
        @SuppressWarnings("unchecked") ArgumentCaptor<Map<String, Object>> dlq = ArgumentCaptor.forClass(Map.class);
        verify(producer).push(eq("ke"), eq("novu-bridge.dlq"), dlq.capture());
        assertEquals("NB_INVALID_CORE_SMS", dlq.getValue().get("errorCode"));
    }
}
