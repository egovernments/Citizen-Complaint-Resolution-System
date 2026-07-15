package org.egov.novubridge.service;

import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.repository.DispatchLogRepository;
import org.egov.novubridge.web.models.ComplaintsDomainEvent;
import org.egov.novubridge.web.models.Contact;
import org.egov.novubridge.web.models.DispatchLogEntry;
import org.egov.novubridge.web.models.DispatchResult;
import org.egov.tracer.model.CustomException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * NB-4 (post-W2): delivery failure is always recorded in {@code nb_dispatch_log}
 * before the outcome is returned/rethrown — the Notification Logs screen no
 * longer shows nothing for failed sends.
 *
 * <p>Two failure shapes, read from the CURRENT {@code process()}:
 * <ul>
 *   <li>the provider THROWS — a FAILED row is upserted (carrying the propagated
 *       error code) and the exception is rethrown so the consumer still DLQs;</li>
 *   <li>the provider returns a NON-2xx or {@code null} {@link NovuClient.NovuResponse}
 *       — a FAILED/{@code NB_NOVU_TRIGGER_FAILED} row is upserted and the pipeline
 *       returns {@code novuTriggered=false} (no rethrow — Novu answered, just not OK).</li>
 * </ul>
 *
 * <p>The exact-{@code NB_NOVU_TRIGGER_FAILED} throw-and-persist case lives in
 * {@code DispatchPipelinePassThroughTest.novuTriggerThrows_persistsFailed_thenRethrows};
 * this file adds the non-2xx/null variants, a generic (non-CustomException) throw,
 * and a distinct-code throw to prove the code is propagated, not hardcoded.
 */
class DispatchPipelineFailureRowTest {

    private EnvelopeValidator envelopeValidator;
    private PreferenceServiceClient preferenceServiceClient;
    private NovuClient novuClient;
    private DispatchLogRepository dispatchLogRepository;
    private NovuBridgeConfiguration config;
    private MdmsServiceClient mdmsServiceClient;

    private DispatchPipelineService service;

    @BeforeEach
    void setUp() {
        envelopeValidator = new EnvelopeValidator();
        preferenceServiceClient = mock(PreferenceServiceClient.class);
        novuClient = mock(NovuClient.class);
        dispatchLogRepository = mock(DispatchLogRepository.class);
        config = new NovuBridgeConfiguration();
        config.setChannel("SMS");
        config.setDefaultLocale("en_IN");
        config.setChannelsEnabled(List.of("SMS", "EMAIL"));
        mdmsServiceClient = mock(MdmsServiceClient.class);

        when(preferenceServiceClient.isChannelAllowed(anyString(), any(), any(), anyString()))
                .thenReturn(true);

        service = new DispatchPipelineService(envelopeValidator, preferenceServiceClient, novuClient,
                dispatchLogRepository, config, mdmsServiceClient);
    }

    private ComplaintsDomainEvent smsEvent() {
        Contact contact = Contact.builder()
                .userId("uuid-123").type("CITIZEN").name("Jane Doe")
                .phone("+254712345678").email("jane@example.com").locale("en_IN")
                .build();
        Map<String, Object> data = new HashMap<>();
        data.put("complaintNo", "PGR-001");
        return ComplaintsDomainEvent.builder()
                .eventId("evt-1").eventType("COMPLAINTS_WORKFLOW_TRANSITIONED")
                .eventName("COMPLAINTS.WORKFLOW.ASSIGN").module("Complaints")
                .entityType("COMPLAINT").entityId("PGR-001").tenantId("ke.bomet")
                .channel("SMS").subscriberId("ke.bomet:uuid-123").contact(contact)
                .renderedBody("Dear Jane, your complaint PGR-001 is assigned.")
                .transactionId("PGR-001:ASSIGN:PENDINGATLME:ke.bomet:uuid-123:SMS")
                .data(data)
                .build();
    }

    private DispatchLogEntry captureSingleUpsert() {
        ArgumentCaptor<DispatchLogEntry> captor = ArgumentCaptor.forClass(DispatchLogEntry.class);
        verify(dispatchLogRepository, times(1)).upsert(captor.capture());
        return captor.getValue();
    }

    @Test
    void providerThrowsCustomException_persistsFailedWithPropagatedCode_thenRethrows() {
        when(novuClient.identifyThenTrigger(anyString(), any(), anyString(), anyString(), any(), anyString(), any()))
                .thenThrow(new CustomException("NB_NOVU_RATE_LIMITED", "429 from Novu"));

        CustomException ex = assertThrows(CustomException.class, () -> service.process(smsEvent(), true, null));
        assertEquals("NB_NOVU_RATE_LIMITED", ex.getCode());

        DispatchLogEntry row = captureSingleUpsert();
        assertEquals("FAILED", row.getStatus());
        // The propagated code, not a hardcoded NB_NOVU_TRIGGER_FAILED.
        assertEquals("NB_NOVU_RATE_LIMITED", row.getLastErrorCode());
    }

    @Test
    void providerThrowsGenericException_persistsFailedWithDeliveryError_thenRethrows() {
        when(novuClient.identifyThenTrigger(anyString(), any(), anyString(), anyString(), any(), anyString(), any()))
                .thenThrow(new RuntimeException("connection reset"));

        assertThrows(RuntimeException.class, () -> service.process(smsEvent(), true, null));

        DispatchLogEntry row = captureSingleUpsert();
        assertEquals("FAILED", row.getStatus());
        assertEquals("NB_DELIVERY_ERROR", row.getLastErrorCode());
    }

    @Test
    void novuNon2xxResponse_recordsFailed_noRethrow() {
        when(novuClient.identifyThenTrigger(anyString(), any(), anyString(), anyString(), any(), anyString(), any()))
                .thenReturn(NovuClient.NovuResponse.builder().statusCode(500)
                        .response(Map.of("message", "internal error")).build());

        DispatchResult result = service.process(smsEvent(), true, null);

        assertFalse(result.getNovuTriggered());
        assertEquals(500, result.getNovuStatusCode());
        DispatchLogEntry row = captureSingleUpsert();
        assertEquals("FAILED", row.getStatus());
        assertEquals("NB_NOVU_TRIGGER_FAILED", row.getLastErrorCode());
    }

    @Test
    void novuNullResponse_recordsFailed_noRethrow() {
        when(novuClient.identifyThenTrigger(anyString(), any(), anyString(), anyString(), any(), anyString(), any()))
                .thenReturn(null);

        DispatchResult result = service.process(smsEvent(), true, null);

        assertFalse(result.getNovuTriggered());
        DispatchLogEntry row = captureSingleUpsert();
        assertEquals("FAILED", row.getStatus());
        assertEquals("NB_NOVU_TRIGGER_FAILED", row.getLastErrorCode());
    }
}
