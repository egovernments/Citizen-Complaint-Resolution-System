package org.egov.novubridge.consumer;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.producer.Producer;
import org.egov.novubridge.service.DispatchPipelineService;
import org.egov.novubridge.service.thin.ThinEventPipelineService;
import org.egov.novubridge.service.thin.ThinEventResult;
import org.egov.novubridge.web.models.NotificationEvent;
import org.egov.novubridge.web.models.ThinEvent;
import org.egov.tracer.model.CustomException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * The {@code kind} discriminator, at the one place it is read: {@link DomainEventConsumer#listen}.
 *
 * <p>Two kinds share every input topic, so this branch is the entire mechanism by which a message
 * reaches the right contract. What matters is that it is decided by ONE declared field and never
 * by the payload's shape — a bridge that sniffed would silently reclassify a producer the day it
 * added a field — and that an unrecognised value goes down the path where something refuses it
 * out loud rather than a path where it is quietly dropped.
 */
class DomainEventConsumerKindDispatchTest {

    private static final String TOPIC = "notifications.events";

    private DispatchPipelineService pipeline;
    private ThinEventPipelineService thinPipeline;
    private Producer producer;
    private DomainEventConsumer consumer;

    @BeforeEach
    void setUp() {
        ObjectMapper mapper = new ObjectMapper()
                .configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
        pipeline = mock(DispatchPipelineService.class);
        thinPipeline = mock(ThinEventPipelineService.class);
        producer = mock(Producer.class);
        NovuBridgeConfiguration config = new NovuBridgeConfiguration();
        config.setDlqTopic("novu-bridge.dlq");
        when(thinPipeline.process(any())).thenReturn(ThinEventResult.builder().build());
        consumer = new DomainEventConsumer(mapper, pipeline, thinPipeline, producer, config);
    }

    // ---- the two kinds -----------------------------------------------------

    @Test
    @DisplayName("kind=THIN goes to the thin pipeline, bound as a ThinEvent, and never to the envelope path")
    void thinKindGoesToTheThinPipeline() {
        consumer.listen(thinRecord(), TOPIC);

        ArgumentCaptor<ThinEvent> captor = ArgumentCaptor.forClass(ThinEvent.class);
        verify(thinPipeline).process(captor.capture());
        verifyNoInteractions(pipeline);

        ThinEvent event = captor.getValue();
        assertEquals("THIN", event.getKind());
        assertEquals("evt-thin-1", event.getEventId());
        assertEquals("Complaints", event.getModule());
        assertEquals("COMPLAINTS.WORKFLOW.ASSIGN.PENDINGATLME", event.getEventName());
        assertEquals("PGR-001:ASSIGN:PENDINGATLME", event.getTransactionSeed());
        // The nested structures survive the map -> POJO conversion, which is the real risk here.
        assertEquals("uuid-assignee", event.getActors().get("assignee").getUserId());
        assertEquals("Streetlight", event.getData().get("complaint_type"));
        assertEquals(List.of("CS_COMMON_PENDINGATLME"), event.localizationCodes("status"));
    }

    @Test
    @DisplayName("no kind at all — the legacy shape — goes to the envelope path, as it always has")
    void absentKindGoesToTheEnvelopePath() {
        consumer.listen(envelopeRecord(), TOPIC);

        ArgumentCaptor<NotificationEvent> captor = ArgumentCaptor.forClass(NotificationEvent.class);
        verify(pipeline).process(captor.capture(), eq(true), any());
        verifyNoInteractions(thinPipeline);
        assertEquals("evt-1", captor.getValue().getEventId());
        assertEquals("Dear Jane, your complaint PGR-001 is assigned.", captor.getValue().getRenderedBody());
    }

    @Test
    @DisplayName("an explicit kind=RENDERED goes to the envelope path too")
    void explicitRenderedKindGoesToTheEnvelopePath() {
        HashMap<String, Object> record = envelopeRecord();
        record.put("kind", "RENDERED");

        consumer.listen(record, TOPIC);

        verify(pipeline).process(any(), eq(true), any());
        verifyNoInteractions(thinPipeline);
    }

    @Test
    @DisplayName("the discriminator is read case-insensitively and trimmed — shouting is not a different claim")
    void thinKindIsMatchedLoosely() {
        for (String spelling : List.of("thin", " Thin ", "THIN")) {
            setUp();
            HashMap<String, Object> record = thinRecord();
            record.put("kind", spelling);
            consumer.listen(record, TOPIC);
            verify(thinPipeline).process(any());
            verifyNoInteractions(pipeline);
        }
    }

    @Test
    @DisplayName("an unrecognised kind takes the envelope path, where something refuses it out loud")
    void unknownKindFallsToTheEnvelopePath() {
        // Never guessed at, and never silently dropped: it binds as an envelope and the envelope
        // validator gets to reject it, which means a ledger row and a DLQ message rather than a
        // log line. A consumer that tried to be clever here would swallow the one signal an
        // operator has.
        HashMap<String, Object> record = envelopeRecord();
        record.put("kind", "SOMETHING_NOBODY_DEFINED");

        consumer.listen(record, TOPIC);

        verify(pipeline).process(any(), eq(true), any());
        verifyNoInteractions(thinPipeline);
    }

    @Test
    @DisplayName("a thin-SHAPED payload with no kind is still an envelope — the field decides, not the shape")
    void shapeNeverDecides() {
        HashMap<String, Object> record = thinRecord();
        record.remove("kind");

        consumer.listen(record, TOPIC);

        verify(pipeline).process(any(), eq(true), any());
        verifyNoInteractions(thinPipeline);
    }

    // ---- failure routing ---------------------------------------------------

    @Test
    @DisplayName("a thin event that throws is DLQ'd with its code, keyed by its tenant")
    void thinFailureIsDlqdWithItsCode() {
        when(thinPipeline.process(any()))
                .thenThrow(new CustomException("NB_INVALID_THIN_EVENT", "module is required"));

        consumer.listen(thinRecord(), TOPIC);

        Map<String, Object> dlq = captureDlq();
        assertEquals("NB_INVALID_THIN_EVENT", dlq.get("errorCode"));
        assertEquals("module is required", dlq.get("errorMessage"));
        assertEquals(TOPIC, dlq.get("sourceTopic"));
        // The DLQ carries the THIN EVENT as received, so a fix-then-replay is possible.
        assertEquals("evt-thin-1", ((ThinEvent) dlq.get("event")).getEventId());
    }

    @Test
    @DisplayName("a thin event that throws something uncoded is DLQ'd as NB_PROCESSING_ERROR")
    void thinUncodedFailureIsDlqdAsProcessingError() {
        when(thinPipeline.process(any())).thenThrow(new RuntimeException("kaboom"));

        consumer.listen(thinRecord(), TOPIC);

        assertEquals("NB_PROCESSING_ERROR", captureDlq().get("errorCode"));
    }

    @Test
    @DisplayName("a thin event that resolves cleanly is not DLQ'd")
    void aCleanThinEventIsNotDlqd() {
        consumer.listen(thinRecord(), TOPIC);
        verify(producer, never()).push(any(), any(), any());
    }

    // ---- fixtures ----------------------------------------------------------

    private static HashMap<String, Object> thinRecord() {
        HashMap<String, Object> record = new HashMap<>();
        record.put("kind", "THIN");
        record.put("schemaVersion", "1");
        record.put("eventId", "evt-thin-1");
        record.put("eventType", "COMPLAINTS_WORKFLOW_TRANSITIONED");
        record.put("module", "Complaints");
        record.put("eventName", "COMPLAINTS.WORKFLOW.ASSIGN.PENDINGATLME");
        record.put("entityType", "COMPLAINT");
        record.put("entityId", "PGR-001");
        record.put("tenantId", "ke.bomet");
        record.put("transactionSeed", "PGR-001:ASSIGN:PENDINGATLME");
        record.put("actors", Map.of(
                "citizen", Map.of("userId", "uuid-citizen", "type", "CITIZEN"),
                "assignee", Map.of("userId", "uuid-assignee", "type", "EMPLOYEE")));
        record.put("data", Map.of("id", "PGR-001", "complaint_type", "Streetlight"));
        record.put("localized", Map.of("status", List.of("CS_COMMON_PENDINGATLME")));
        record.put("localizationModules", List.of("rainmaker-pgr"));
        return record;
    }

    private static HashMap<String, Object> envelopeRecord() {
        HashMap<String, Object> record = new HashMap<>();
        record.put("eventId", "evt-1");
        record.put("eventType", "COMPLAINTS_WORKFLOW_TRANSITIONED");
        record.put("eventName", "COMPLAINTS.WORKFLOW.ASSIGN");
        record.put("module", "Complaints");
        record.put("tenantId", "ke.bomet");
        record.put("channel", "SMS");
        record.put("subscriberId", "ke.bomet:uuid-123");
        record.put("renderedBody", "Dear Jane, your complaint PGR-001 is assigned.");
        return record;
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> captureDlq() {
        ArgumentCaptor<Map<String, Object>> dlq = ArgumentCaptor.forClass(Map.class);
        verify(producer).push(eq("ke.bomet"), eq("novu-bridge.dlq"), dlq.capture());
        return dlq.getValue();
    }
}
