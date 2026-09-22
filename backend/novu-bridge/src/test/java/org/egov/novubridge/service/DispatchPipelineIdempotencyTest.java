package org.egov.novubridge.service;

import org.egov.novubridge.service.policy.ChannelPolicyClient;
import org.egov.novubridge.service.provider.ProviderAvailability;

import org.egov.novubridge.service.delivery.DeliveryProviderRegistry;
import org.egov.novubridge.service.delivery.NovuDeliveryProvider;

import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.repository.DispatchLogRepository;
import org.egov.novubridge.web.models.NotificationEvent;
import org.egov.novubridge.web.models.Contact;
import org.egov.novubridge.web.models.DispatchLogEntry;
import org.egov.novubridge.web.models.DispatchResult;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * transactionId redelivery (Kafka redelivery, DLQ replay): the pipeline looks the row up by the
 * ledger's unique key {@code (transactionId, channel, recipientValue)} before sending, and a row
 * already SENT or DELIVERED is neither re-sent nor rewritten.
 */
class DispatchPipelineIdempotencyTest {

    private EnvelopeValidator envelopeValidator;
    private PreferenceServiceClient preferenceServiceClient;
    private NovuClient novuClient;
    private DispatchLogRepository dispatchLogRepository;
    private NovuBridgeConfiguration config;

    private DispatchPipelineService service;

    @BeforeEach
    void setUp() {
        envelopeValidator = new EnvelopeValidator();
        preferenceServiceClient = mock(PreferenceServiceClient.class);
        novuClient = mock(NovuClient.class);
        dispatchLogRepository = mock(DispatchLogRepository.class);
        config = new NovuBridgeConfiguration();
        config.setDefaultLocale("en_IN");
        config.setChannelsEnabled(List.of("SMS", "EMAIL"));

        when(preferenceServiceClient.isChannelAllowed(anyString(), any(), any(), anyString()))
                .thenReturn(true);
        when(novuClient.identifyThenTrigger(anyString(), any(), anyString(), anyString(), any(), anyString(), any(), any(), any(), any(), any()))
                .thenReturn(NovuClient.NovuResponse.builder().statusCode(201).response(Map.of("acknowledged", true)).build());

        service = new DispatchPipelineService(envelopeValidator, preferenceServiceClient,
                new DeliveryProviderRegistry(config, new ChannelPolicyClient(null, config), new NovuDeliveryProvider(novuClient), null),
                new ChannelPolicyClient(null, config), dispatchLogRepository, config,
                new ProviderAvailability(novuClient, config));
    }

    private NotificationEvent smsEvent() {
        Contact contact = Contact.builder()
                .userId("uuid-123").type("CITIZEN").name("Jane Doe")
                .phone("+254712345678").email("jane@example.com").locale("en_IN")
                .build();
        Map<String, Object> data = new HashMap<>();
        data.put("complaintNo", "PGR-001");
        return NotificationEvent.builder()
                .eventId("evt-1").eventType("COMPLAINTS_WORKFLOW_TRANSITIONED")
                .eventName("COMPLAINTS.WORKFLOW.ASSIGN").module("Complaints")
                .entityType("COMPLAINT").entityId("PGR-001").tenantId("ke.bomet")
                .channel("SMS").subscriberId("ke.bomet:uuid-123").contact(contact)
                .renderedBody("Dear Jane, your complaint PGR-001 is assigned.")
                .transactionId("PGR-001:ASSIGN:PENDINGATLME:ke.bomet:uuid-123:SMS")
                .data(data)
                .build();
    }

    private static final String TXN = "PGR-001:ASSIGN:PENDINGATLME:ke.bomet:uuid-123:SMS";

    @Test
    void redelivery_ofASentMessage_isNotResent_andTheRowIsLeftAlone() {
        // First pass finds no row; the redelivery finds the SENT row the first pass wrote.
        when(dispatchLogRepository.findStatus(TXN, "SMS", "ke.bomet:uuid-123")).thenReturn(null, "SENT");
        NotificationEvent event = smsEvent();
        service.process(event, true, null);
        DispatchResult second = service.process(event, true, null);

        verify(novuClient, times(1))
                .identifyThenTrigger(anyString(), any(), anyString(), anyString(), any(), anyString(), any(), any(), any(), any(), any());
        assertFalse(second.getNovuTriggered());

        ArgumentCaptor<DispatchLogEntry> captor = ArgumentCaptor.forClass(DispatchLogEntry.class);
        verify(dispatchLogRepository, times(1)).upsert(captor.capture());
        DispatchLogEntry row = captor.getValue();
        assertEquals(TXN, row.getTransactionId());
        assertEquals("SMS", row.getChannel());
        assertEquals("ke.bomet:uuid-123", row.getRecipientValue());
        assertEquals("SENT", row.getStatus());
    }
}
