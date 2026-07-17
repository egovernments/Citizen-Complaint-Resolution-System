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
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * NB-8: the Kafka glue in {@link DomainEventConsumer#listen}. Unit-tested without
 * embedded Kafka — the actual risk is the {@code Map -> ComplaintsDomainEvent}
 * deserialization and the DLQ-on-failure routing, both covered here directly.
 */
class DomainEventConsumerWiringTest {

    private ObjectMapper mapper;
    private DispatchPipelineService pipeline;
    private Producer producer;
    private NovuBridgeConfiguration config;
    private DomainEventConsumer consumer;

    @BeforeEach
    void setUp() {
        mapper = new ObjectMapper().configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
        pipeline = mock(DispatchPipelineService.class);
        producer = mock(Producer.class);
        config = new NovuBridgeConfiguration();
        config.setDlqTopic("novu-bridge.dlq");
        consumer = new DomainEventConsumer(mapper, pipeline, producer, config);
    }

    private HashMap<String, Object> payload() {
        HashMap<String, Object> record = new HashMap<>();
        record.put("eventId", "evt-1");
        record.put("eventType", "COMPLAINTS_WORKFLOW_TRANSITIONED");
        record.put("eventName", "COMPLAINTS.WORKFLOW.ASSIGN");
        record.put("module", "Complaints");
        record.put("entityType", "COMPLAINT");
        record.put("entityId", "PGR-001");
        record.put("tenantId", "ke.bomet");
        record.put("channel", "SMS");
        record.put("subscriberId", "ke.bomet:uuid-123");
        record.put("renderedBody", "Dear Jane, your complaint PGR-001 is assigned.");
        record.put("transactionId", "PGR-001:ASSIGN:PENDINGATLME:ke.bomet:uuid-123:SMS");

        Map<String, Object> contact = new HashMap<>();
        contact.put("userId", "uuid-123");
        contact.put("type", "CITIZEN");
        contact.put("name", "Jane Doe");
        contact.put("phone", "+254712345678");
        contact.put("email", "jane@example.com");
        contact.put("locale", "en_IN");
        record.put("contact", contact);

        Map<String, Object> data = new HashMap<>();
        data.put("complaintNo", "PGR-001");
        record.put("data", data);
        return record;
    }

    @Test
    void mapPayload_deserializesToEvent_withAllFieldsSurviving() {
        consumer.listen(payload(), "complaints.domain.events");

        ArgumentCaptor<ComplaintsDomainEvent> captor = ArgumentCaptor.forClass(ComplaintsDomainEvent.class);
        verify(pipeline).process(captor.capture(), eq(true), isNull());

        ComplaintsDomainEvent event = captor.getValue();
        assertEquals("evt-1", event.getEventId());
        assertEquals("COMPLAINTS_WORKFLOW_TRANSITIONED", event.getEventType());
        assertEquals("COMPLAINTS.WORKFLOW.ASSIGN", event.getEventName());
        assertEquals("Complaints", event.getModule());
        assertEquals("PGR-001", event.getEntityId());
        assertEquals("ke.bomet", event.getTenantId());
        assertEquals("SMS", event.getChannel());
        assertEquals("ke.bomet:uuid-123", event.getSubscriberId());
        assertEquals("Dear Jane, your complaint PGR-001 is assigned.", event.getRenderedBody());
        assertEquals("PGR-001:ASSIGN:PENDINGATLME:ke.bomet:uuid-123:SMS", event.getTransactionId());
        // Nested contact survived the map->POJO conversion.
        assertEquals("uuid-123", event.getContact().getUserId());
        assertEquals("CITIZEN", event.getContact().getType());
        assertEquals("+254712345678", event.getContact().getPhone());
        assertEquals("jane@example.com", event.getContact().getEmail());
        assertEquals("en_IN", event.getContact().getLocale());
        // Structured data map survived.
        assertEquals("PGR-001", event.getData().get("complaintNo"));
    }

    @Test
    void processingThrowsCustomException_publishesDlq_withErrorCode() {
        when(pipeline.process(any(), anyBoolean(), any()))
                .thenThrow(new CustomException("NB_NOVU_TRIGGER_FAILED", "boom"));

        consumer.listen(payload(), "complaints.domain.events");

        ArgumentCaptor<Map<String, Object>> dlq = captureDlq();
        assertEquals("NB_NOVU_TRIGGER_FAILED", dlq.getValue().get("errorCode"));
        assertEquals("boom", dlq.getValue().get("errorMessage"));
    }

    @Test
    void processingThrowsGenericException_publishesDlq_withProcessingErrorCode() {
        when(pipeline.process(any(), anyBoolean(), any()))
                .thenThrow(new RuntimeException("kaboom"));

        consumer.listen(payload(), "complaints.domain.events");

        ArgumentCaptor<Map<String, Object>> dlq = captureDlq();
        assertEquals("NB_PROCESSING_ERROR", dlq.getValue().get("errorCode"));
    }

    @SuppressWarnings("unchecked")
    private ArgumentCaptor<Map<String, Object>> captureDlq() {
        ArgumentCaptor<Map<String, Object>> dlq = ArgumentCaptor.forClass(Map.class);
        verify(producer).push(eq("ke.bomet"), eq("novu-bridge.dlq"), dlq.capture());
        return dlq;
    }
}
