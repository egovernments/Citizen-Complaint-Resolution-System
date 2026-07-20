package org.egov.novubridge.service;

import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.repository.DispatchLogRepository;
import org.egov.novubridge.web.models.ComplaintsDomainEvent;
import org.egov.novubridge.web.models.Contact;
import org.egov.novubridge.web.models.DispatchLogEntry;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * NB-3 (item 1): transactionId redelivery. Read against the CURRENT
 * {@code DispatchPipelineService.process()} — W2 did NOT add a pre-send
 * SENT-row skip, so a Kafka redelivery of the same event re-triggers Novu on
 * both passes. This is safe only because Novu itself dedupes on transactionId,
 * and because both upserts carry the identical
 * {@code (transactionId, channel, recipientValue)} key so they collapse onto a
 * single {@code nb_dispatch_log} row (the extended unique key from
 * {@code V20260701000000__extend_dispatch_unique_key.sql}, pinned separately in
 * {@link org.egov.novubridge.repository.DispatchLogRepositoryUpsertKeyTest}).
 */
class DispatchPipelineIdempotencyTest {

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
        when(novuClient.identifyThenTrigger(anyString(), any(), anyString(), anyString(), any(), anyString(), any(), any(), any()))
                .thenReturn(NovuClient.NovuResponse.builder().statusCode(201).response(Map.of("acknowledged", true)).build());

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

    @Test
    void redelivery_sameEventTwice_retriggersNovu_andUpsertsSameKey() {
        ComplaintsDomainEvent event = smsEvent();
        service.process(event, true, null);
        service.process(event, true, null);

        // Current behavior: no pre-send SENT-row dedupe in process(); both passes trigger.
        verify(novuClient, times(2))
                .identifyThenTrigger(anyString(), any(), anyString(), anyString(), any(), anyString(), any(), any(), any());

        ArgumentCaptor<DispatchLogEntry> captor = ArgumentCaptor.forClass(DispatchLogEntry.class);
        verify(dispatchLogRepository, times(2)).upsert(captor.capture());

        List<DispatchLogEntry> rows = captor.getAllValues();
        assertEquals(2, rows.size());
        // Both upserts collapse onto the same idempotency triple → one physical row.
        for (DispatchLogEntry row : rows) {
            assertEquals("PGR-001:ASSIGN:PENDINGATLME:ke.bomet:uuid-123:SMS", row.getTransactionId());
            assertEquals("SMS", row.getChannel());
            assertEquals("ke.bomet:uuid-123", row.getRecipientValue());
            assertEquals("SENT", row.getStatus());
        }
    }
}
