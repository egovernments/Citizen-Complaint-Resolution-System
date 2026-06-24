package org.egov.novubridge.consumer;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.producer.Producer;
import org.egov.novubridge.service.DispatchPipelineService;
import org.egov.novubridge.web.models.ComplaintsDomainEvent;
import org.egov.tracer.model.CustomException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.MockitoAnnotations;

import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * Verifies the bounded retry -> DLQ wiring in the Kafka consumer: success goes nowhere, a failure is
 * re-queued on the retry topic with an incremented attempt, and once attempts are exhausted it lands
 * in the DLQ. (Backoff disabled via retryDelayMs=0 so the test doesn't sleep.)
 */
public class DomainEventConsumerTest {

    private static final String INPUT = "complaints.domain.events";
    private static final String RETRY = "novu-bridge.retry";
    private static final String DLQ = "novu-bridge.dlq";
    private static final String TENANT = "pb.amritsar";

    @Mock private DispatchPipelineService dispatch;
    @Mock private Producer producer;

    private final ObjectMapper mapper = new ObjectMapper();
    private NovuBridgeConfiguration config;
    private DomainEventConsumer consumer;

    @BeforeEach
    void setUp() {
        MockitoAnnotations.openMocks(this);
        config = new NovuBridgeConfiguration();
        config.setRetryTopic(RETRY);
        config.setDlqTopic(DLQ);
        config.setMaxRetries(3);
        config.setRetryDelayMs(0);   // no sleeping in tests
        consumer = new DomainEventConsumer(mapper, dispatch, producer, config);
    }

    private ComplaintsDomainEvent event() {
        return ComplaintsDomainEvent.builder()
                .eventId("evt-1").tenantId(TENANT).eventName("complaint-resolved").build();
    }

    @SuppressWarnings("unchecked")
    private HashMap<String, Object> asInputRecord(ComplaintsDomainEvent e) {
        return mapper.convertValue(e, HashMap.class);
    }

    @SuppressWarnings("unchecked")
    private HashMap<String, Object> asRetryRecord(ComplaintsDomainEvent e, int attempt) {
        HashMap<String, Object> r = new HashMap<>();
        r.put("event", mapper.convertValue(e, Map.class));
        r.put("attempt", attempt);
        return r;
    }

    private void failProcessing() {
        when(dispatch.processEnabledChannels(any(ComplaintsDomainEvent.class), anyBoolean(), any()))
                .thenThrow(new CustomException("NB_CHANNEL_CONFIG_SEARCH_FAILED", "config-service down"));
    }

    @Test
    void success_neitherRetriesNorDlqs() {
        consumer.listen(asInputRecord(event()), INPUT);
        verifyNoInteractions(producer);
    }

    @Test
    void inputFailure_requeuedToRetryWithAttemptOne() {
        failProcessing();

        consumer.listen(asInputRecord(event()), INPUT);

        ArgumentCaptor<Object> payload = ArgumentCaptor.forClass(Object.class);
        verify(producer).push(eq(TENANT), eq(RETRY), payload.capture());
        verify(producer, never()).push(eq(TENANT), eq(DLQ), any());
        assertEquals(1, ((Map<String, Object>) payload.getValue()).get("attempt"));
    }

    @Test
    void retryFailureBelowMax_requeuedWithIncrementedAttempt() {
        failProcessing();

        consumer.listen(asRetryRecord(event(), 1), RETRY);

        ArgumentCaptor<Object> payload = ArgumentCaptor.forClass(Object.class);
        verify(producer).push(eq(TENANT), eq(RETRY), payload.capture());
        assertEquals(2, ((Map<String, Object>) payload.getValue()).get("attempt"));
    }

    @Test
    void retryFailureAtMax_routedToDlq() {
        failProcessing();

        // attempt 3 == maxRetries -> next would be 4 (> 3) -> DLQ, not another retry
        consumer.listen(asRetryRecord(event(), 3), RETRY);

        verify(producer).push(eq(TENANT), eq(DLQ), any());
        verify(producer, never()).push(eq(TENANT), eq(RETRY), any());
    }
}
