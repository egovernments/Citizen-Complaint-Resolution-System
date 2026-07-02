package org.egov.novubridge.service;

import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.repository.DispatchLogRepository;
import org.egov.novubridge.web.models.ComplaintsDomainEvent;
import org.egov.novubridge.web.models.Contact;
import org.egov.novubridge.web.models.DispatchResult;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Proves the pass-through inversion: novu-bridge consumes the pre-rendered event
 * verbatim — it never resolves templates/providers/localization and forwards
 * PGR's renderedBody straight through to delivery.
 */
class DispatchPipelinePassThroughTest {

    private EnvelopeValidator envelopeValidator;
    private PreferenceServiceClient preferenceServiceClient;
    private NovuClient novuClient;
    private BaileysSendClient baileysSendClient;
    private DispatchLogRepository dispatchLogRepository;
    private NovuBridgeConfiguration config;
    private MdmsServiceClient mdmsServiceClient;

    private DispatchPipelineService service;

    @BeforeEach
    void setUp() {
        envelopeValidator = new EnvelopeValidator(); // real — validates the contract
        preferenceServiceClient = mock(PreferenceServiceClient.class);
        novuClient = mock(NovuClient.class);
        baileysSendClient = mock(BaileysSendClient.class);
        dispatchLogRepository = mock(DispatchLogRepository.class);
        config = new NovuBridgeConfiguration();
        config.setChannel("SMS");
        config.setDefaultLocale("en_IN");
        mdmsServiceClient = mock(MdmsServiceClient.class);

        when(preferenceServiceClient.isChannelAllowed(anyString(), any(), any(), anyString()))
                .thenReturn(true);
        when(novuClient.identifyThenTrigger(anyString(), any(), anyString(), anyString(), any(), anyString(), any()))
                .thenReturn(NovuClient.NovuResponse.builder().statusCode(201).response(Map.of("acknowledged", true)).build());

        service = new DispatchPipelineService(envelopeValidator, preferenceServiceClient, novuClient,
                baileysSendClient, dispatchLogRepository, config, mdmsServiceClient);
    }

    private ComplaintsDomainEvent smsEvent() {
        Contact contact = Contact.builder()
                .userId("uuid-123").type("CITIZEN").name("Jane Doe")
                .phone("+254712345678").email("jane@example.com").locale("en_IN")
                .build();
        Map<String, Object> data = new HashMap<>();
        data.put("complaintNo", "PGR-001");
        data.put("status", "PENDINGATLME");
        data.put("action", "ASSIGN");
        data.put("toState", "PENDINGATLME");
        return ComplaintsDomainEvent.builder()
                .eventId("evt-1").eventType("COMPLAINTS_WORKFLOW_TRANSITIONED")
                .eventName("COMPLAINTS.WORKFLOW.ASSIGN").module("Complaints")
                .entityType("COMPLAINT").entityId("PGR-001").tenantId("ke.bomet")
                .channel("SMS").subscriberId("ke.bomet:uuid-123").contact(contact)
                .renderedBody("Dear Jane, your complaint PGR-001 is assigned.")
                .subject(null)
                .transactionId("PGR-001:ASSIGN:PENDINGATLME:ke.bomet:uuid-123:SMS")
                .data(data)
                .build();
    }

    @Test
    void smsEvent_isPassedThroughVerbatim_andNeverResolvesTemplate() {
        DispatchResult result = service.process(smsEvent(), true, null);

        assertTrue(result.getNovuTriggered());
        assertEquals(201, result.getNovuStatusCode());
        // No template/provider resolution surfaces in the result anymore.
        assertNull(result.getResolvedTemplate());
        assertNull(result.getResolvedProvider());

        ArgumentCaptor<String> subId = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<Contact> contact = ArgumentCaptor.forClass(Contact.class);
        ArgumentCaptor<String> body = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> txn = ArgumentCaptor.forClass(String.class);
        verify(novuClient).identifyThenTrigger(subId.capture(), contact.capture(), eq("SMS"),
                body.capture(), any(), txn.capture(), any());

        // subscriberId, contact profile, renderedBody, transactionId all come straight from the event.
        assertEquals("ke.bomet:uuid-123", subId.getValue());
        assertEquals("+254712345678", contact.getValue().getPhone());
        assertEquals("jane@example.com", contact.getValue().getEmail());
        assertEquals("Dear Jane, your complaint PGR-001 is assigned.", body.getValue());
        assertEquals("PGR-001:ASSIGN:PENDINGATLME:ke.bomet:uuid-123:SMS", txn.getValue());

        // Baileys is NOT used for SMS.
        verify(baileysSendClient, never()).send(anyString(), anyString());
    }

    @Test
    void whatsappEvent_routesToBaileys_notNovu() {
        ComplaintsDomainEvent event = smsEvent();
        event.setChannel("WHATSAPP");
        event.setTransactionId("PGR-001:ASSIGN:PENDINGATLME:ke.bomet:uuid-123:WHATSAPP");
        when(baileysSendClient.send(anyString(), anyString()))
                .thenReturn(NovuClient.NovuResponse.builder().statusCode(200).response(Map.of("sent", true)).build());

        DispatchResult result = service.process(event, true, null);

        assertTrue(result.getNovuTriggered());
        // WHATSAPP -> Baileys with bare E.164 (no "whatsapp:" prefix) + verbatim body.
        verify(baileysSendClient).send(eq("+254712345678"),
                eq("Dear Jane, your complaint PGR-001 is assigned."));
        // Novu trigger is NOT used for the Baileys WhatsApp path.
        verify(novuClient, never()).identifyThenTrigger(anyString(), any(), anyString(), anyString(), any(), anyString(), any());
    }

    @Test
    void emailEvent_isDispatchedViaNovu_withRenderedBodyAndSubject() {
        ComplaintsDomainEvent event = smsEvent();
        event.setChannel("EMAIL");
        event.setSubject("Your complaint PGR-001");
        event.setTransactionId("PGR-001:ASSIGN:PENDINGATLME:ke.bomet:uuid-123:EMAIL");

        DispatchResult result = service.process(event, true, null);

        assertTrue(result.getNovuTriggered());
        ArgumentCaptor<String> body = ArgumentCaptor.forClass(String.class);
        verify(novuClient).identifyThenTrigger(eq("ke.bomet:uuid-123"), any(), eq("EMAIL"),
                body.capture(), any(), eq("PGR-001:ASSIGN:PENDINGATLME:ke.bomet:uuid-123:EMAIL"), any());
        assertEquals("Dear Jane, your complaint PGR-001 is assigned.", body.getValue());
        // EMAIL is delivered via Novu, not Baileys.
        verify(baileysSendClient, never()).send(anyString(), anyString());
    }

    @Test
    void preferenceDenied_skipsDelivery_andLogsSkipped() {
        when(preferenceServiceClient.isChannelAllowed(anyString(), any(), any(), anyString()))
                .thenReturn(false);

        DispatchResult result = service.process(smsEvent(), true, null);

        assertEquals(Boolean.FALSE, result.getPreferenceAllowed());
        assertEquals(Boolean.FALSE, result.getNovuTriggered());
        verify(novuClient, never()).identifyThenTrigger(anyString(), any(), anyString(), anyString(), any(), anyString(), any());
        verify(baileysSendClient, never()).send(anyString(), anyString());
    }
}
