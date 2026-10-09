package org.egov.novubridge.web.controllers;

import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.repository.DispatchLogRepository;
import org.egov.novubridge.service.NovuClient;
import org.egov.novubridge.service.SmsCountryClient;
import org.egov.novubridge.service.TwilioTemplateSyncService;
import org.egov.novubridge.service.delivery.DeliveryProviderRegistry;
import org.egov.novubridge.service.delivery.NovuDeliveryProvider;
import org.egov.novubridge.service.delivery.SmsCountryDeliveryProvider;
import org.egov.novubridge.service.policy.ChannelPolicyClient;
import org.egov.novubridge.service.provider.ProviderAvailability;
import org.egov.novubridge.service.provider.ProviderCatalog;
import org.egov.novubridge.web.models.DispatchLogEntry;
import org.egov.tracer.model.CustomException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.nullable;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Test-send runs dispatch's availability check before it triggers: Novu accepts a trigger nothing
 * can deliver and fails it inside, so a test through a missing, disabled or wrong-channel provider,
 * or on a channel Novu has no active integration for, read {@code ok:true} for a message that never
 * left (seen live). Each refusal is {@code 409 NB_PROVIDER_UNAVAILABLE} with nothing sent and no row.
 */
class ProviderControllerTestSendAvailabilityTest {

    private NovuClient novuClient;
    private DispatchLogRepository dispatchLog;
    private NovuBridgeConfiguration config;
    private ProviderAvailability availability;
    private final List<Map<String, Object>> integrations = new ArrayList<>();

    @BeforeEach
    void setUp() {
        novuClient = mock(NovuClient.class);
        dispatchLog = mock(DispatchLogRepository.class);
        config = new NovuBridgeConfiguration();
        config.setSmsCountryUrl("http://api.smscountry.com/SMSCwebservice_bulk.aspx");
        config.setProviderAvailabilityCacheTtlMs(60_000L);
        when(novuClient.listIntegrations()).thenAnswer(inv -> NovuClient.NovuResponse.builder()
                .statusCode(200).response(Map.of("data", new ArrayList<>(integrations))).build());
        when(novuClient.applyWhatsappIntegrationOverride(nullable(Map.class), anyString()))
                .thenAnswer(inv -> inv.getArgument(0));
        when(novuClient.trigger(anyString(), anyString(), nullable(String.class), nullable(String.class),
                anyMap(), anyString(), nullable(Map.class)))
                .thenReturn(NovuClient.NovuResponse.builder().statusCode(201)
                        .response(Map.of("acknowledged", true)).build());
        availability = new ProviderAvailability(novuClient, config);
    }

    private ProviderController controller() {
        return controller(new DeliveryProviderRegistry(config, new ChannelPolicyClient(null, config),
                new NovuDeliveryProvider(novuClient), null));
    }

    private ProviderController controller(DeliveryProviderRegistry registry) {
        return new ProviderController(novuClient, registry, dispatchLog, mock(TwilioTemplateSyncService.class),
                new ProviderCatalog(config), new ChannelPolicyClient(null, config), availability);
    }

    private Map<String, Object> integration(String id, String identifier, String providerId, String channel,
                                            boolean active) {
        Map<String, Object> i = new LinkedHashMap<>();
        i.put("_id", id);
        i.put("identifier", identifier);
        i.put("providerId", providerId);
        i.put("channel", channel);
        i.put("active", active);
        integrations.add(i);
        return i;
    }

    private static Map<String, Object> sms(String id) {
        Map<String, Object> body = new LinkedHashMap<>();
        if (id != null) {
            body.put("id", id);
        }
        body.put("channel", "SMS");
        body.put("to", Map.of("phone", "+15550100"));
        body.put("body", "hello");
        return body;
    }

    private void assertUnavailable(Map<String, Object> request, String... inMessage) {
        ProviderController.Refusal refusal = assertThrows(ProviderController.Refusal.class,
                () -> controller().testSend(request));
        assertEquals(HttpStatus.CONFLICT, refusal.status());
        assertEquals("NB_PROVIDER_UNAVAILABLE", refusal.code());
        assertTrue(refusal.getMessage().contains("Nothing was sent"), refusal.getMessage());
        for (String s : inMessage) {
            assertTrue(refusal.getMessage().contains(s), refusal.getMessage());
        }
        // The body the Configurator reads: Errors[0].code / .message.
        @SuppressWarnings("unchecked")
        Map<String, Object> error = ((List<Map<String, Object>>) refusal.toResponse().getBody().get("Errors")).get(0);
        assertEquals("NB_PROVIDER_UNAVAILABLE", error.get("code"));
        assertEquals(refusal.getMessage(), error.get("message"));
        assertNothingSent();
    }

    private void assertNothingSent() {
        verify(novuClient, never()).trigger(any(), any(), any(), any(), any(), any(), any());
        verify(dispatchLog, never()).upsert(any());
    }

    // ---- a named provider ------------------------------------------------------------

    @Test
    void pinnedMissing_isRefusedBeforeTheCheck_asNotFound() {
        integration("i1", "twilio-sms-aa", "twilio", "sms", true);

        CustomException ex = assertThrows(CustomException.class, () -> controller().testSend(sms("gone")));
        assertEquals("NB_PROVIDER_NOT_FOUND", ex.getCode());
        assertNothingSent();
    }

    @Test
    void pinnedMissing_whenItVanishesBetweenTheLookupAndTheCheck_isUnavailable() {
        Map<String, Object> listed = integration("i1", "twilio-sms-aa", "twilio", "sms", true);
        // The lookup sees it; by the availability read it has been deleted in Novu.
        when(novuClient.listIntegrations())
                .thenReturn(NovuClient.NovuResponse.builder().statusCode(200)
                        .response(Map.of("data", List.of(listed))).build())
                .thenReturn(NovuClient.NovuResponse.builder().statusCode(200)
                        .response(Map.of("data", List.of())).build());

        assertUnavailable(sms("i1"), "is missing");
    }

    @Test
    void pinnedInactive_isUnavailable() {
        integration("i1", "twilio-sms-aa", "twilio", "sms", false);
        integration("i2", "twilio-sms-bb", "twilio", "sms", true);

        assertUnavailable(sms("twilio-sms-aa"), "twilio-sms-aa", "disabled");
    }

    @Test
    void pinnedOnAnotherChannel_isUnavailable() {
        integration("i1", "smtp-aa", "nodemailer", "email", true);

        assertUnavailable(sms("i1"), "'email' integration", "SMS");
    }

    @Test
    void pinnedAndAvailable_triggersThroughIt() {
        integration("i1", "twilio-sms-aa", "twilio", "sms", true);

        Map<String, Object> out = controller().testSend(sms("i1")).getBody();

        assertEquals(true, out.get("ok"));
        assertFalse(out.containsKey("warning"), String.valueOf(out));
        verify(novuClient).trigger(eq("complaints-sms"), anyString(), eq("+15550100"), nullable(String.class),
                anyMap(), anyString(), eq(Map.of("sms", Map.of("integrationIdentifier", "twilio-sms-aa"))));
        verify(dispatchLog).upsert(any(DispatchLogEntry.class));
    }

    @Test
    void theCheckReadsNovuFresh_notTheSnapshotDispatchCachedBeforeTheProviderWasDisabled() {
        Map<String, Object> i1 = integration("i1", "twilio-sms-aa", "twilio", "sms", true);
        assertTrue(availability.check("twilio-sms-aa", "SMS").usable());   // dispatch cached it active
        i1.put("active", false);                                          // then disabled in Novu's dashboard

        assertUnavailable(sms("i1"), "disabled");
    }

    // ---- no provider named -------------------------------------------------------------

    @Test
    void unpinned_withNoActiveIntegrationForTheChannel_isUnavailable() {
        integration("i1", "twilio-sms-aa", "twilio", "sms", false);
        integration("i2", "smtp-bb", "nodemailer", "email", true);
        // Novu's sms channel, but WhatsApp's provider: no substitute for SMS.
        integration("i3", "twilio-whatsapp-cc", "twilio", "sms", true);

        assertUnavailable(sms(null), "SMS has no provider selected", "no active integration");
    }

    @Test
    void unpinned_whenNovusDefaultIsAWorkerProviderTheWorkerLacks_isUnavailable() {
        config.setDigitWorkerProviders(false);
        integration("i1", "ozeki-aa", "ozeki", "sms", true);

        assertUnavailable(sms(null), "ozeki", "NOVU_BRIDGE_DIGIT_WORKER_PROVIDERS=false");
    }

    @Test
    void unpinnedAndAvailable_triggersThroughNovusDefault() {
        integration("i1", "twilio-sms-aa", "twilio", "sms", true);

        Map<String, Object> out = controller().testSend(sms(null)).getBody();

        assertEquals(true, out.get("ok"));
        assertFalse(out.containsKey("warning"), String.valueOf(out));
        verify(novuClient).trigger(eq("complaints-sms"), anyString(), eq("+15550100"), nullable(String.class),
                anyMap(), anyString(), nullable(Map.class));
    }

    @Test
    void unpinned_onTheLegacyDirectGateway_isNotJudgedByNovusIntegrations() {
        // No Novu SMS integration at all: SMS goes straight to SMSCountry's bulk API.
        config.setSmsProvider("smscountry");
        ChannelPolicyClient policy = new ChannelPolicyClient(null, config);
        SmsCountryClient smsCountry = mock(SmsCountryClient.class);
        when(smsCountry.send(anyString(), anyString(), anyString(), any())).thenReturn(NovuClient.NovuResponse
                .builder().statusCode(200).response(Map.of("jobId", "4689")).build());
        DeliveryProviderRegistry registry = new DeliveryProviderRegistry(config, policy,
                new NovuDeliveryProvider(novuClient), new SmsCountryDeliveryProvider(smsCountry, policy));

        Map<String, Object> out = controller(registry).testSend(sms(null)).getBody();

        assertEquals(true, out.get("ok"));
        verify(smsCountry).send(eq("+15550100"), eq("hello"), anyString(), any());
        verify(novuClient, never()).listIntegrations();
    }

    // ---- Novu's integration list unreadable: fails open, like dispatch ------------------

    @Test
    void whenNovuCannotBeListed_theTestIsSent_andSaysItWasNotChecked() {
        when(novuClient.listIntegrations()).thenThrow(new IllegalStateException("connection refused"));

        Map<String, Object> out = controller().testSend(sms(null)).getBody();

        assertEquals(true, out.get("ok"));
        assertTrue(String.valueOf(out.get("warning")).contains("could not be listed"), String.valueOf(out));
        verify(novuClient).trigger(eq("complaints-sms"), anyString(), eq("+15550100"), nullable(String.class),
                anyMap(), anyString(), nullable(Map.class));
    }
}
