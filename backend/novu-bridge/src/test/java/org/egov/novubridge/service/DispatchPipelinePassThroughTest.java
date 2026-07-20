package org.egov.novubridge.service;

import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.repository.DispatchLogRepository;
import org.egov.novubridge.service.provider.WhatsAppBusinessApiProviderStrategy;
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
 * PGR's renderedBody straight through to delivery. Also pins the channel-enable
 * gate: known-but-disabled channels (WHATSAPP pre-provider) and unknown channels
 * persist an explicit SKIPPED row and NEVER fall back to the SMS workflow.
 */
class DispatchPipelinePassThroughTest {

    private EnvelopeValidator envelopeValidator;
    private PreferenceServiceClient preferenceServiceClient;
    private NovuClient novuClient;
    private DispatchLogRepository dispatchLogRepository;
    private NovuBridgeConfiguration config;
    private MdmsServiceClient mdmsServiceClient;

    private DispatchPipelineService service;

    @BeforeEach
    void setUp() {
        envelopeValidator = new EnvelopeValidator(); // real — validates the contract
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
        // No template/provider resolution happens anymore — DispatchResult no
        // longer even carries resolvedTemplate/resolvedProvider fields.

        ArgumentCaptor<String> subId = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<Contact> contact = ArgumentCaptor.forClass(Contact.class);
        ArgumentCaptor<String> body = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> txn = ArgumentCaptor.forClass(String.class);
        verify(novuClient).identifyThenTrigger(subId.capture(), contact.capture(), eq("SMS"),
                body.capture(), any(), txn.capture(), any(), any(), any());

        // subscriberId, contact profile, renderedBody, transactionId all come straight from the event.
        assertEquals("ke.bomet:uuid-123", subId.getValue());
        assertEquals("+254712345678", contact.getValue().getPhone());
        assertEquals("jane@example.com", contact.getValue().getEmail());
        assertEquals("Dear Jane, your complaint PGR-001 is assigned.", body.getValue());
        assertEquals("PGR-001:ASSIGN:PENDINGATLME:ke.bomet:uuid-123:SMS", txn.getValue());
    }

    @Test
    void sentRow_carriesTemplateKey_derivedFromEventRoutingSegments() {
        // Fix: real dispatch rows previously persisted template_key = NULL (only the
        // ProviderController test-send wrote "TEST"). Until pgr-services emits an
        // explicit templateKey, the row carries the routing key reconstructed from
        // event segments: audience.action.toState.channel.locale.
        service.process(smsEvent(), true, null);

        ArgumentCaptor<DispatchLogEntry> captor = ArgumentCaptor.forClass(DispatchLogEntry.class);
        verify(dispatchLogRepository).upsert(captor.capture());
        assertEquals("SENT", captor.getValue().getStatus());
        assertEquals("CITIZEN.ASSIGN.PENDINGATLME.SMS.en_IN", captor.getValue().getTemplateKey());
    }

    @Test
    void explicitTemplateKeyOnTheWire_winsOverDerivedRoutingKey() {
        // Forward-compat: once pgr-services publishes the actual MDMS
        // NotificationTemplate uid on the event, it is persisted verbatim.
        ComplaintsDomainEvent event = smsEvent();
        event.setTemplateKey("CITIZEN.ASSIGN.PENDINGATLME.SMS.sw_KE");

        service.process(event, true, null);

        ArgumentCaptor<DispatchLogEntry> captor = ArgumentCaptor.forClass(DispatchLogEntry.class);
        verify(dispatchLogRepository).upsert(captor.capture());
        assertEquals("CITIZEN.ASSIGN.PENDINGATLME.SMS.sw_KE", captor.getValue().getTemplateKey());
    }

    @Test
    void whatsappEvent_noEnabledProvider_persistsSkippedNoProvider_neverFallsBackToSms() {
        ComplaintsDomainEvent event = smsEvent();
        event.setChannel("WHATSAPP");
        event.setTransactionId("PGR-001:ASSIGN:PENDINGATLME:ke.bomet:uuid-123:WHATSAPP");

        DispatchResult result = service.process(event, true, null);

        assertFalse(result.getNovuTriggered());
        // No Novu trigger at all — in particular NOT the SMS workflow.
        verify(novuClient, never()).identifyThenTrigger(any(), any(), any(), any(), any(), any(), any(), any(), any());
        // Explicit SKIPPED/NB_NO_PROVIDER dispatch row.
        ArgumentCaptor<DispatchLogEntry> captor = ArgumentCaptor.forClass(DispatchLogEntry.class);
        verify(dispatchLogRepository).upsert(captor.capture());
        assertEquals("SKIPPED", captor.getValue().getStatus());
        assertEquals("NB_NO_PROVIDER", captor.getValue().getLastErrorCode());
        assertEquals("WHATSAPP", captor.getValue().getChannel());
    }

    @Test
    void unknownChannel_isSkippedWithUnsupportedChannel_notDefaultedToSms() {
        ComplaintsDomainEvent event = smsEvent();
        event.setChannel("PIGEON");
        event.setTransactionId("PGR-001:ASSIGN:PENDINGATLME:ke.bomet:uuid-123:PIGEON");

        DispatchResult result = service.process(event, true, null);

        assertFalse(result.getNovuTriggered());
        verify(novuClient, never()).identifyThenTrigger(any(), any(), any(), any(), any(), any(), any(), any(), any());
        ArgumentCaptor<DispatchLogEntry> captor = ArgumentCaptor.forClass(DispatchLogEntry.class);
        verify(dispatchLogRepository).upsert(captor.capture());
        assertEquals("SKIPPED", captor.getValue().getStatus());
        assertEquals("NB_UNSUPPORTED_CHANNEL", captor.getValue().getLastErrorCode());
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
                body.capture(), any(), eq("PGR-001:ASSIGN:PENDINGATLME:ke.bomet:uuid-123:EMAIL"), any(), any(), any());
        assertEquals("Dear Jane, your complaint PGR-001 is assigned.", body.getValue());
    }

    @Test
    void novuTriggerThrows_persistsFailed_thenRethrows() {
        when(novuClient.identifyThenTrigger(anyString(), any(), anyString(), anyString(), any(), anyString(), any(), any(), any()))
                .thenThrow(new CustomException("NB_NOVU_TRIGGER_FAILED", "boom"));

        assertThrows(CustomException.class, () -> service.process(smsEvent(), true, null));

        // A FAILED row must land in the log BEFORE the exception propagates to the DLQ consumer.
        ArgumentCaptor<DispatchLogEntry> captor = ArgumentCaptor.forClass(DispatchLogEntry.class);
        verify(dispatchLogRepository).upsert(captor.capture());
        assertEquals("FAILED", captor.getValue().getStatus());
        assertEquals("NB_NOVU_TRIGGER_FAILED", captor.getValue().getLastErrorCode());
    }

    @Test
    void emailEvent_withoutEmail_skippedContactMissing() {
        ComplaintsDomainEvent event = smsEvent();
        event.setChannel("EMAIL");
        // Contact carries a phone but no email — an EMAIL row must not phantom-SEND.
        event.setContact(Contact.builder()
                .userId("uuid-123").type("CITIZEN").name("Jane Doe")
                .phone("+254712345678").email(null).locale("en_IN").build());
        event.setTransactionId("PGR-001:ASSIGN:PENDINGATLME:ke.bomet:uuid-123:EMAIL");

        DispatchResult result = service.process(event, true, null);

        assertFalse(result.getNovuTriggered());
        verify(novuClient, never()).identifyThenTrigger(any(), any(), any(), any(), any(), any(), any(), any(), any());
        ArgumentCaptor<DispatchLogEntry> captor = ArgumentCaptor.forClass(DispatchLogEntry.class);
        verify(dispatchLogRepository).upsert(captor.capture());
        assertEquals("SKIPPED", captor.getValue().getStatus());
        assertEquals("NB_CONTACT_MISSING", captor.getValue().getLastErrorCode());
    }

    @Test
    void preferenceDenied_skipsDelivery_andLogsSkipped() {
        when(preferenceServiceClient.isChannelAllowed(anyString(), any(), any(), anyString()))
                .thenReturn(false);

        DispatchResult result = service.process(smsEvent(), true, null);

        assertEquals(Boolean.FALSE, result.getPreferenceAllowed());
        assertEquals(Boolean.FALSE, result.getNovuTriggered());
        verify(novuClient, never()).identifyThenTrigger(anyString(), any(), anyString(), anyString(), any(), anyString(), any(), any(), any());
    }

    @Test
    void whatsAppBusinessApiStrategy_ownsBareWhatsappAlias() {
        // Durable concern carried over from the deleted BaileysProviderStrategyTest:
        // with Baileys gone, the Meta strategy owns the bare "whatsapp" alias again.
        assertTrue(new WhatsAppBusinessApiProviderStrategy().supports("whatsapp"));
    }
}
