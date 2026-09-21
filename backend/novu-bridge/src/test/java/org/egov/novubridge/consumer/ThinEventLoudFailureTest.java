package org.egov.novubridge.consumer;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.producer.Producer;
import org.egov.novubridge.repository.DispatchLogRepository;
import org.egov.novubridge.service.DispatchPipelineService;
import org.egov.novubridge.service.EnvelopeValidator;
import org.egov.novubridge.service.thin.ThinEventPipelineService;
import org.egov.novubridge.service.thin.ThinEventValidator;
import org.egov.novubridge.service.thin.RecordingThinEventHandler;
import org.egov.novubridge.web.models.DispatchLogEntry;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/**
 * The rollout property, end to end: <b>a thin event this deployment does not accept fails LOUD.</b>
 *
 * <p>There is no flag that turns the thin path on. Which path a deployment is on is a compile-time
 * fact about the producer image it runs, which is the whole point — a setting can be dropped with
 * a compose overlay, and one was, and a live server went quiet for days. So the one failure mode
 * that must be impossible is a quiet one: a thin event whose {@code eventType} is not on
 * {@code novu.bridge.event.types} has to produce <b>a ledger row AND a DLQ message, per message</b>,
 * so the symptom is a screen full of red rows rather than silence.
 *
 * <p>Wired with the real validator, the real pipeline and the real default handler — only the
 * repository, the producer and the envelope pipeline are mocks — because this is a claim about how
 * the pieces behave together, and mocking the piece under test would prove nothing.
 */
class ThinEventLoudFailureTest {

    private static final String TOPIC = "notifications.events";

    private DispatchLogRepository repository;
    private Producer producer;
    private DomainEventConsumer consumer;

    @BeforeEach
    void setUp() {
        repository = mock(DispatchLogRepository.class);
        producer = mock(Producer.class);
        NovuBridgeConfiguration config = new NovuBridgeConfiguration();
        config.setDlqTopic("novu-bridge.dlq");
        // A deployment that allows only the pre-rendered complaint producer — the state a box is
        // in before anybody onboards a thin one.
        config.setEventTypes(List.of("COMPLAINTS_WORKFLOW_TRANSITIONED"));

        ThinEventPipelineService thinPipeline = new ThinEventPipelineService(
                new ThinEventValidator(new EnvelopeValidator(config)),
                new RecordingThinEventHandler(repository),
                repository);
        consumer = new DomainEventConsumer(
                new ObjectMapper().configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false),
                mock(DispatchPipelineService.class), thinPipeline, producer, config);
    }

    private static HashMap<String, Object> thinRecord(String eventType) {
        HashMap<String, Object> record = new HashMap<>();
        record.put("kind", "THIN");
        record.put("eventId", "evt-thin-1");
        record.put("eventType", eventType);
        record.put("module", "XYZ");
        record.put("eventName", "XYZ.LICENCE.RENEWED");
        record.put("entityId", "XYZ-LIC-2026-0042");
        record.put("tenantId", "ke.bomet");
        record.put("transactionSeed", "XYZ-LIC-2026-0042:RENEWED");
        return record;
    }

    private DispatchLogEntry theRow() {
        ArgumentCaptor<DispatchLogEntry> captor = ArgumentCaptor.forClass(DispatchLogEntry.class);
        verify(repository).upsert(captor.capture());
        return captor.getValue();
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> theDlqMessage() {
        ArgumentCaptor<Map<String, Object>> dlq = ArgumentCaptor.forClass(Map.class);
        verify(producer).push(eq("ke.bomet"), eq("novu-bridge.dlq"), dlq.capture());
        return dlq.getValue();
    }

    @Test
    @DisplayName("an unallowed thin eventType writes a REJECTED ledger row")
    void anUnallowedTypeWritesALedgerRow() {
        consumer.listen(thinRecord("XYZ_LICENCE_EVENT"), TOPIC);

        DispatchLogEntry row = theRow();
        assertEquals("REJECTED", row.getStatus());
        assertEquals("NB_UNSUPPORTED_EVENT_TYPE", row.getLastErrorCode());
        assertEquals("ke.bomet", row.getTenantId());
        assertEquals("XYZ", row.getModule());
        assertEquals("XYZ.LICENCE.RENEWED", row.getEventName());
        assertEquals("XYZ-LIC-2026-0042", row.getReferenceNumber(),
                "the row must be findable by the case it is about, not only by its event id");
        assertEquals("RESOLVED", row.getSourcePath(),
                "the row must say which path the message came in on — that IS the rollout signal");
        assertTrue(row.getLastErrorMessage().contains("XYZ_LICENCE_EVENT"),
                "the message must name the type that was refused, so the fix is obvious");
    }

    @Test
    @DisplayName("and DLQs the event, so the payload survives the fix")
    void anUnallowedTypeAlsoDlqs() {
        consumer.listen(thinRecord("XYZ_LICENCE_EVENT"), TOPIC);

        Map<String, Object> dlq = theDlqMessage();
        assertEquals("NB_UNSUPPORTED_EVENT_TYPE", dlq.get("errorCode"));
        assertEquals(TOPIC, dlq.get("sourceTopic"));
        assertEquals("evt-thin-1",
                ((org.egov.novubridge.web.models.ThinEvent) dlq.get("event")).getEventId());
    }

    @Test
    @DisplayName("the consumer does not rethrow — one bad producer must not stall the partition")
    void theConsumerSwallowsAfterRecordingAndDlqing() {
        // Both halves of the record are already down by the time this returns. Rethrowing would
        // hand the message back to Kafka and replay it forever, which is how a single
        // mis-provisioned producer takes the topic down for every other one.
        consumer.listen(thinRecord("XYZ_LICENCE_EVENT"), TOPIC);
        verify(repository).upsert(any());
        verify(producer).push(any(), any(), any());
    }

    @Test
    @DisplayName("once the type IS allowed, the same event is recorded, not rejected, and not DLQ'd")
    void onboardingTheTypeIsTheWholeFix() {
        // The onboarding step, and the rollback: a type is added to (or removed from)
        // novu.bridge.event.types. Nothing else changes, and the difference is visible in the
        // ledger rather than in a log.
        NovuBridgeConfiguration config = new NovuBridgeConfiguration();
        config.setDlqTopic("novu-bridge.dlq");
        config.setEventTypes(List.of("COMPLAINTS_WORKFLOW_TRANSITIONED", "XYZ_LICENCE_EVENT"));
        DomainEventConsumer onboarded = new DomainEventConsumer(
                new ObjectMapper().configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false),
                mock(DispatchPipelineService.class),
                new ThinEventPipelineService(
                        new ThinEventValidator(new EnvelopeValidator(config)),
                        new RecordingThinEventHandler(repository), repository),
                producer, config);

        onboarded.listen(thinRecord("XYZ_LICENCE_EVENT"), TOPIC);

        DispatchLogEntry row = theRow();
        assertEquals("SKIPPED", row.getStatus());
        assertEquals(RecordingThinEventHandler.CODE, row.getLastErrorCode(),
                "the event was accepted and handed to the handler; what it decided is the handler's business");
        verify(producer, never()).push(any(), any(), any());
    }
}
