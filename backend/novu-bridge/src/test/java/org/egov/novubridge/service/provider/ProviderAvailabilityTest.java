package org.egov.novubridge.service.provider;

import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.repository.DispatchLogRepository;
import org.egov.novubridge.service.NovuClient;
import org.egov.novubridge.service.TwilioTemplateSyncService;
import org.egov.novubridge.service.delivery.DeliveryProviderRegistry;
import org.egov.novubridge.service.delivery.NovuDeliveryProvider;
import org.egov.novubridge.service.policy.ChannelPolicyClient;
import org.egov.novubridge.web.controllers.ProviderController;
import org.egov.tracer.model.CustomException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.nullable;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The bridge's view of "can Novu actually deliver through this integration", and the cache
 * that keeps it from costing a Novu round trip per event.
 */
class ProviderAvailabilityTest {

    private NovuClient novuClient;
    private NovuBridgeConfiguration config;
    private ProviderAvailability availability;
    /** What the next {@code GET /v1/integrations} answers; swapped mid-test. */
    private final AtomicReference<List<Map<String, Object>>> novuIntegrations = new AtomicReference<>(List.of());

    @BeforeEach
    void setUp() {
        novuClient = mock(NovuClient.class);
        config = new NovuBridgeConfiguration();
        config.setProviderAvailabilityCacheTtlMs(60_000L);
        config.setSmsCountryUrl("http://api.smscountry.com/SMSCwebservice_bulk.aspx");
        config.setSmsCountryAdapterUrl("http://novu-bridge:8080/novu-bridge/novu-adapter/v1/gateways/smscountry/send");
        when(novuClient.listIntegrations()).thenAnswer(inv -> {
            NovuClient.NovuResponse r = new NovuClient.NovuResponse();
            r.setStatusCode(200);
            r.setResponse(Map.of("data", novuIntegrations.get()));
            return r;
        });
        availability = new ProviderAvailability(novuClient, config);
    }

    private static Map<String, Object> integration(String identifier, boolean active, String channel) {
        Map<String, Object> m = new HashMap<>();
        m.put("_id", "novu-" + identifier);
        m.put("identifier", identifier);
        m.put("active", active);
        m.put("channel", channel);
        return m;
    }

    // ---- verdicts --------------------------------------------------------

    @Test
    void anActiveIntegrationOnTheRightChannelIsAvailable() {
        novuIntegrations.set(List.of(integration("twilio-sms-a", true, "sms")));

        ProviderAvailability.Result result = availability.check("twilio-sms-a", "SMS");

        assertEquals(ProviderAvailability.Status.AVAILABLE, result.getStatus());
        assertTrue(result.usable());
        assertNull(result.getMessage());
    }

    @Test
    void anIntegrationNovuDoesNotHaveIsMissing() {
        novuIntegrations.set(List.of(integration("twilio-sms-a", true, "sms")));

        ProviderAvailability.Result result = availability.check("twilio-sms-deleted", "SMS");

        assertEquals(ProviderAvailability.Status.MISSING, result.getStatus());
        assertFalse(result.usable());
        assertTrue(result.getMessage().contains("twilio-sms-deleted"));
    }

    @Test
    void aSwitchedOffIntegrationIsInactive() {
        novuIntegrations.set(List.of(integration("twilio-sms-a", false, "sms")));

        ProviderAvailability.Result result = availability.check("twilio-sms-a", "SMS");

        assertEquals(ProviderAvailability.Status.INACTIVE, result.getStatus());
        assertFalse(result.usable());
    }

    @Test
    void anIntegrationOnAnotherNovuChannelIsAMismatch() {
        novuIntegrations.set(List.of(integration("smtp-a", true, "email")));

        assertEquals(ProviderAvailability.Status.CHANNEL_MISMATCH,
                availability.check("smtp-a", "SMS").getStatus());
        // ... and the same integration is perfectly fine for EMAIL.
        assertEquals(ProviderAvailability.Status.AVAILABLE,
                availability.check("smtp-a", "EMAIL").getStatus());
    }

    @Test
    void novusOwnIdIsAcceptedTooBecauseAChannelRowMayCarryEither() {
        novuIntegrations.set(List.of(integration("twilio-sms-a", true, "sms")));

        assertEquals(ProviderAvailability.Status.AVAILABLE,
                availability.check("novu-twilio-sms-a", "SMS").getStatus());
    }

    @Test
    void noProviderPinnedMeansNothingToCheckAndNoNovuCall() {
        assertEquals(ProviderAvailability.Status.AVAILABLE, availability.check(null, "SMS").getStatus());
        assertEquals(ProviderAvailability.Status.AVAILABLE, availability.check("  ", "SMS").getStatus());

        verify(novuClient, never()).listIntegrations();
    }

    // ---- cache -----------------------------------------------------------

    @Test
    void theIntegrationListIsFetchedOncePerTtl() {
        novuIntegrations.set(List.of(integration("twilio-sms-a", true, "sms")));

        for (int i = 0; i < 5; i++) {
            assertTrue(availability.check("twilio-sms-a", "SMS").usable());
        }

        verify(novuClient, times(1)).listIntegrations();
    }

    @Test
    void aZeroTtlDisablesTheCache() {
        config.setProviderAvailabilityCacheTtlMs(0L);
        novuIntegrations.set(List.of(integration("twilio-sms-a", true, "sms")));

        availability.check("twilio-sms-a", "SMS");
        availability.check("twilio-sms-a", "SMS");

        verify(novuClient, times(2)).listIntegrations();
    }

    @Test
    void invalidateMakesTheNextCheckSeeNovuAgain() {
        novuIntegrations.set(List.of(integration("twilio-sms-a", false, "sms")));
        assertEquals(ProviderAvailability.Status.INACTIVE,
                availability.check("twilio-sms-a", "SMS").getStatus());

        // An operator switches it back on. Without the invalidate, the pipeline would keep
        // skipping for up to a full TTL after the fix.
        novuIntegrations.set(List.of(integration("twilio-sms-a", true, "sms")));
        assertEquals(ProviderAvailability.Status.INACTIVE,
                availability.check("twilio-sms-a", "SMS").getStatus(), "cached until invalidated");

        availability.invalidate();

        assertEquals(ProviderAvailability.Status.AVAILABLE,
                availability.check("twilio-sms-a", "SMS").getStatus());
        verify(novuClient, times(2)).listIntegrations();
    }

    // ---- fail open -------------------------------------------------------

    @Test
    void aListFailureIsUnknownAndUsable_andIsNotRetriedEveryEvent() {
        when(novuClient.listIntegrations())
                .thenThrow(new CustomException("NB_NOVU_INTEGRATIONS_FAILED", "connection refused"));

        for (int i = 0; i < 5; i++) {
            ProviderAvailability.Result result = availability.check("twilio-sms-a", "SMS");
            assertEquals(ProviderAvailability.Status.UNKNOWN, result.getStatus());
            assertTrue(result.usable(), "a gate that cannot see must not block delivery");
        }
        // One failing call per TTL, not one per event: every one of these runs on the Kafka
        // listener thread with a 10s read timeout.
        verify(novuClient, times(1)).listIntegrations();
    }

    @Test
    void anUnreadableResponseIsAlsoFailOpen() {
        NovuClient.NovuResponse empty = new NovuClient.NovuResponse();
        empty.setStatusCode(200);
        empty.setResponse(Map.of("message", "unauthorized"));
        when(novuClient.listIntegrations()).thenReturn(empty);

        // An answer we cannot parse is not evidence that the provider is gone.
        assertEquals(ProviderAvailability.Status.UNKNOWN,
                availability.check("twilio-sms-a", "SMS").getStatus());
    }

    @Test
    void afterAFailureTheCacheRecoversOnceInvalidated() {
        org.mockito.Mockito.doThrow(new CustomException("NB_NOVU_INTEGRATIONS_FAILED", "down"))
                .when(novuClient).listIntegrations();
        assertEquals(ProviderAvailability.Status.UNKNOWN,
                availability.check("twilio-sms-a", "SMS").getStatus());

        novuIntegrations.set(List.of(integration("twilio-sms-a", true, "sms")));
        org.mockito.Mockito.doAnswer(inv -> {
            NovuClient.NovuResponse r = new NovuClient.NovuResponse();
            r.setStatusCode(200);
            r.setResponse(Map.of("data", novuIntegrations.get()));
            return r;
        }).when(novuClient).listIntegrations();
        availability.invalidate();

        assertEquals(ProviderAvailability.Status.AVAILABLE,
                availability.check("twilio-sms-a", "SMS").getStatus());
    }

    // ---- wired to the management endpoints --------------------------------

    @Test
    void anOperatorsUpdateThroughTheBridgeTakesEffectOnTheNextEvent() {
        ProviderController controller = controller();
        novuIntegrations.set(new ArrayList<>(List.of(integration("twilio-sms-a", false, "sms"))));

        assertEquals(ProviderAvailability.Status.INACTIVE,
                availability.check("twilio-sms-a", "SMS").getStatus());

        // The operator re-enables it on the Providers screen. Novu now reports it active…
        when(novuClient.updateIntegration(any(), nullable(String.class), nullable(Map.class), any()))
                .thenAnswer(inv -> {
                    novuIntegrations.set(List.of(integration("twilio-sms-a", true, "sms")));
                    NovuClient.NovuResponse r = new NovuClient.NovuResponse();
                    r.setStatusCode(200);
                    r.setResponse(Map.of("data", integration("twilio-sms-a", true, "sms")));
                    return r;
                });
        controller.updateProvider(Map.of("id", "twilio-sms-a", "active", true));

        // …and the very next dispatch sees it, without waiting out the TTL.
        assertEquals(ProviderAvailability.Status.AVAILABLE,
                availability.check("twilio-sms-a", "SMS").getStatus());
    }

    @Test
    void aDeleteThroughTheBridgeAlsoInvalidates() {
        ProviderController controller = controller();
        novuIntegrations.set(List.of(integration("twilio-sms-a", true, "sms")));
        assertEquals(ProviderAvailability.Status.AVAILABLE,
                availability.check("twilio-sms-a", "SMS").getStatus());

        when(novuClient.deleteIntegration(any())).thenAnswer(inv -> {
            novuIntegrations.set(List.of());
            NovuClient.NovuResponse r = new NovuClient.NovuResponse();
            r.setStatusCode(200);
            r.setResponse(Map.of("data", Map.of("acknowledged", true)));
            return r;
        });
        controller.deleteProvider(Map.of("id", "twilio-sms-a"));

        assertEquals(ProviderAvailability.Status.MISSING,
                availability.check("twilio-sms-a", "SMS").getStatus());
    }

    @Test
    void aCreateThroughTheBridgeAlsoInvalidates() {
        ProviderController controller = controller();
        novuIntegrations.set(List.of());
        assertEquals(ProviderAvailability.Status.MISSING,
                availability.check("smtp-x", "EMAIL").getStatus());

        when(novuClient.createIntegration(nullable(String.class), nullable(String.class),
                nullable(String.class), nullable(String.class), any(), anyBoolean()))
                .thenAnswer(inv -> {
                    novuIntegrations.set(List.of(integration("smtp-x", true, "email")));
                    NovuClient.NovuResponse r = new NovuClient.NovuResponse();
                    r.setStatusCode(201);
                    r.setResponse(Map.of("data", integration("smtp-x", true, "email")));
                    return r;
                });
        controller.createProvider(new HashMap<>(Map.of(
                "type", ProviderCatalog.SMTP,
                "identifier", "smtp-x",
                "name", "Mail",
                "credentials", Map.of("host", "smtp.example.org", "port", "587", "user", "u",
                        "password", "p", "from", "no-reply@example.org", "senderName", "Desk"))));

        assertEquals(ProviderAvailability.Status.AVAILABLE,
                availability.check("smtp-x", "EMAIL").getStatus());
    }

    private ProviderController controller() {
        ChannelPolicyClient policy = new ChannelPolicyClient(null, config);
        return new ProviderController(novuClient,
                new DeliveryProviderRegistry(config, policy, new NovuDeliveryProvider(novuClient, config), null),
                mock(DispatchLogRepository.class), mock(TwilioTemplateSyncService.class),
                new ProviderCatalog(config), policy, availability);
    }
}
