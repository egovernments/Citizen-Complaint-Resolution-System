package org.egov.novubridge.service;

import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.repository.DispatchLogRepository;
import org.egov.novubridge.web.models.ComplaintsDomainEvent;
import org.egov.novubridge.web.models.Contact;
import org.egov.novubridge.web.models.DispatchLogEntry;
import org.egov.novubridge.web.models.DispatchResult;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * NB-1 / NB-2 (pipeline leg): the post-W1 channel gate. A KNOWN channel with no
 * enabled provider (WHATSAPP pre-onboarding, the default) and an UNKNOWN channel
 * (PIGEON) are both persisted as an explicit SKIPPED dispatch-log row and NEVER
 * reach Novu — in particular they never fall through to the SMS workflow. When
 * WHATSAPP is enabled in {@code novu.bridge.channels.enabled}, the event triggers
 * the WHATSAPP Novu workflow instead.
 *
 * <p>Complements {@code DispatchPipelinePassThroughTest} (which smoke-covers the
 * disabled-WHATSAPP and unknown-channel skips) with the gate-enabled path, the
 * strict "no interaction with Novu at all" no-fallback guarantee, and the
 * config-would-throw-but-pipeline-does-not invariant for the unknown channel.
 */
class DispatchPipelineWhatsappNoProviderTest {

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
        // Default enabled set ships SMS,EMAIL — WHATSAPP is deliberately absent.
        config.setChannelsEnabled(List.of("SMS", "EMAIL"));
        // @Value defaults only apply under Spring; set explicitly for this plain-POJO config.
        config.setNovuWorkflowWhatsapp("complaints-whatsapp");
        mdmsServiceClient = mock(MdmsServiceClient.class);

        when(preferenceServiceClient.isChannelAllowed(anyString(), any(), any(), anyString()))
                .thenReturn(true);
        when(novuClient.identifyThenTrigger(anyString(), any(), anyString(), anyString(), any(), anyString(), any()))
                .thenReturn(NovuClient.NovuResponse.builder().statusCode(201).response(Map.of("acknowledged", true)).build());
        when(novuClient.trigger(anyString(), anyString(), any(), any(), anyString(), any()))
                .thenReturn(NovuClient.NovuResponse.builder().statusCode(201).response(Map.of("acknowledged", true)).build());

        service = new DispatchPipelineService(envelopeValidator, preferenceServiceClient, novuClient,
                dispatchLogRepository, config, mdmsServiceClient);
    }

    private ComplaintsDomainEvent whatsappEvent() {
        Contact contact = Contact.builder()
                .userId("uuid-123").type("CITIZEN").name("Jane Doe")
                .phone("+254712345678").email("jane@example.com").locale("en_IN")
                .build();
        Map<String, Object> data = new HashMap<>();
        data.put("complaintNo", "PGR-001");
        return ComplaintsDomainEvent.builder()
                .eventId("evt-wa").eventType("COMPLAINTS_WORKFLOW_TRANSITIONED")
                .eventName("COMPLAINTS.WORKFLOW.ASSIGN").module("Complaints")
                .entityType("COMPLAINT").entityId("PGR-001").tenantId("ke.bomet")
                .channel("WHATSAPP").subscriberId("ke.bomet:uuid-123").contact(contact)
                .renderedBody("Dear Jane, your complaint PGR-001 is assigned.")
                .transactionId("PGR-001:ASSIGN:PENDINGATLME:ke.bomet:uuid-123:WHATSAPP")
                .data(data)
                .build();
    }

    @Test
    void whatsappEvent_channelDisabled_skipsWithNoProvider_neverTriggersNovu_noException() {
        DispatchResult result = assertDoesNotThrow(() -> service.process(whatsappEvent(), true, null));

        assertFalse(result.getNovuTriggered());
        // Never reaches Novu at all — the disabled channel is short-circuited before delivery,
        // so it can never smuggle a WhatsApp body through the SMS (or any) workflow.
        verifyNoInteractions(novuClient);

        ArgumentCaptor<DispatchLogEntry> captor = ArgumentCaptor.forClass(DispatchLogEntry.class);
        verify(dispatchLogRepository, times(1)).upsert(captor.capture());
        assertEquals("SKIPPED", captor.getValue().getStatus());
        assertEquals("NB_NO_PROVIDER", captor.getValue().getLastErrorCode());
        assertEquals("WHATSAPP", captor.getValue().getChannel());
    }

    @Test
    void whatsappEvent_gateEnabled_noSenderConfigured_triggersNovuWithoutOverrides() {
        config.setChannelsEnabled(List.of("SMS", "EMAIL", "WHATSAPP"));
        // No ProviderDetail configured for this tenant: getWhatsappSenderNumber() returns null.
        when(mdmsServiceClient.getWhatsappSenderNumber(anyString())).thenReturn(null);

        DispatchResult result = service.process(whatsappEvent(), true, null);

        assertTrue(result.getNovuTriggered());
        // WHATSAPP now goes through identify() + the pass-through trigger() overload
        // (rather than identifyThenTrigger) because it needs the option to attach a
        // per-tenant "from" override — with no senderNumber configured, overrides is null
        // and Novu falls back to the integration's own credentials.from.
        verify(novuClient).identify(eq("ke.bomet:uuid-123"), any());
        ArgumentCaptor<Map> payload = ArgumentCaptor.forClass(Map.class);
        ArgumentCaptor<Map> overrides = ArgumentCaptor.forClass(Map.class);
        // formatRecipientPhone() also normalizes the recipient's "to" phone for WHATSAPP:
        // it is already E.164, so it is only prefixed with "whatsapp:".
        verify(novuClient).trigger(eq("complaints-whatsapp"), eq("ke.bomet:uuid-123"), eq("whatsapp:+254712345678"),
                payload.capture(), eq("PGR-001:ASSIGN:PENDINGATLME:ke.bomet:uuid-123:WHATSAPP"),
                overrides.capture());
        assertEquals("Dear Jane, your complaint PGR-001 is assigned.", payload.getValue().get("body"));
        assertEquals(null, overrides.getValue());
        verify(novuClient, never()).identifyThenTrigger(any(), any(), any(), any(), any(), any(), any());
    }

    @Test
    void whatsappEvent_gateEnabled_senderConfigured_triggersNovuWithFromOverride() {
        config.setChannelsEnabled(List.of("SMS", "EMAIL", "WHATSAPP"));
        // ProviderDetail in MDMS carries a raw (unprefixed) Twilio WhatsApp sender number.
        when(mdmsServiceClient.getWhatsappSenderNumber("ke.bomet")).thenReturn("+14155550123");

        DispatchResult result = service.process(whatsappEvent(), true, null);

        assertTrue(result.getNovuTriggered());
        ArgumentCaptor<Map> overrides = ArgumentCaptor.forClass(Map.class);
        // formatRecipientPhone() also normalizes the recipient's "to" phone for WHATSAPP:
        // it is already E.164, so it is only prefixed with "whatsapp:".
        verify(novuClient).trigger(eq("complaints-whatsapp"), eq("ke.bomet:uuid-123"), eq("whatsapp:+254712345678"),
                any(), eq("PGR-001:ASSIGN:PENDINGATLME:ke.bomet:uuid-123:WHATSAPP"), overrides.capture());

        Map<String, Object> providers = (Map<String, Object>) overrides.getValue().get("providers");
        Map<String, Object> twilio = (Map<String, Object>) providers.get("twilio");
        // The bare MDMS number is prefixed with "whatsapp:" before being sent as the override.
        assertEquals("whatsapp:+14155550123", twilio.get("from"));
    }

    @Test
    void whatsappEvent_gateEnabled_senderAlreadyPrefixed_isNotDoublePrefixed() {
        config.setChannelsEnabled(List.of("SMS", "EMAIL", "WHATSAPP"));
        when(mdmsServiceClient.getWhatsappSenderNumber("ke.bomet")).thenReturn("whatsapp:+14155550123");

        service.process(whatsappEvent(), true, null);

        ArgumentCaptor<Map> overrides = ArgumentCaptor.forClass(Map.class);
        verify(novuClient).trigger(anyString(), anyString(), any(), any(), anyString(), overrides.capture());
        Map<String, Object> providers = (Map<String, Object>) overrides.getValue().get("providers");
        Map<String, Object> twilio = (Map<String, Object>) providers.get("twilio");
        assertEquals("whatsapp:+14155550123", twilio.get("from"));
    }

    @Test
    void pigeonChannel_pipelineSkips_neverThrows_eventThoughConfigWouldThrow() {
        // W1 decision, read from process(): an UNKNOWN channel is gated to a SKIPPED
        // NB_UNSUPPORTED_CHANNEL row BEFORE NovuClient/getNovuWorkflowId is ever consulted.
        // getNovuWorkflowId("PIGEON") throws NB_UNSUPPORTED_CHANNEL (see the config unit test),
        // but the pipeline never reaches it — so process() itself does NOT throw and does NOT DLQ.
        ComplaintsDomainEvent event = whatsappEvent();
        event.setChannel("PIGEON");
        event.setTransactionId("PGR-001:ASSIGN:PENDINGATLME:ke.bomet:uuid-123:PIGEON");

        DispatchResult result = assertDoesNotThrow(() -> service.process(event, true, null));

        assertFalse(result.getNovuTriggered());
        verifyNoInteractions(novuClient);
        ArgumentCaptor<DispatchLogEntry> captor = ArgumentCaptor.forClass(DispatchLogEntry.class);
        verify(dispatchLogRepository, times(1)).upsert(captor.capture());
        assertEquals("SKIPPED", captor.getValue().getStatus());
        assertEquals("NB_UNSUPPORTED_CHANNEL", captor.getValue().getLastErrorCode());
        assertEquals("PIGEON", captor.getValue().getChannel());
    }
}
