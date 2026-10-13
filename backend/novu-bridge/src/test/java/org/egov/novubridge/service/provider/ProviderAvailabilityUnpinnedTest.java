package org.egov.novubridge.service.provider;

import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.service.NovuClient;
import org.egov.tracer.model.CustomException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Review (9): with {@code NOVU_BRIDGE_DIGIT_WORKER_PROVIDERS=false} a channel that pins nothing is
 * sent through Novu's default, which can be a leftover SMSCountry / Ozeki / Jasmin integration the
 * worker has no handler for.
 */
class ProviderAvailabilityUnpinnedTest {

    private NovuClient novuClient;
    private NovuBridgeConfiguration config;
    private ProviderAvailability availability;
    private final List<Map<String, Object>> integrations = new ArrayList<>();

    @BeforeEach
    void setUp() {
        novuClient = mock(NovuClient.class);
        config = new NovuBridgeConfiguration();
        config.setProviderAvailabilityCacheTtlMs(60_000L);
        config.setDigitWorkerProviders(false);
        when(novuClient.listIntegrations()).thenAnswer(inv -> NovuClient.NovuResponse.builder()
                .statusCode(200).response(Map.of("data", integrations)).build());
        availability = new ProviderAvailability(novuClient, config);
    }

    private void integration(String identifier, String providerId, String channel, boolean active, boolean primary) {
        Map<String, Object> i = new LinkedHashMap<>();
        i.put("_id", "id-" + identifier);
        i.put("identifier", identifier);
        i.put("providerId", providerId);
        i.put("channel", channel);
        i.put("active", active);
        if (primary) {
            i.put("primary", true);   // Novu omits it when false
        }
        integrations.add(i);
    }

    @Test
    void aWorkerProviderThatIsNovusPrimary_isMissing() {
        integration("jasmin-aa", "jasmin", "sms", true, true);
        integration("twilio-sms-bb", "twilio", "sms", true, false);

        ProviderAvailability.Result result = availability.checkUnpinned("SMS");

        assertEquals(ProviderAvailability.Status.WORKER_PROVIDER_MISSING, result.status());
        assertTrue(result.message().contains("jasmin-aa"), result.message());
        assertTrue(result.message().contains("NOVU_BRIDGE_DIGIT_WORKER_PROVIDERS=false"), result.message());
        assertNull(result.identifier(), "nothing new is pinned on the trigger");
    }

    @Test
    void aNovuPrimary_orAnyNonWorkerCandidateWithoutAPrimary_isAvailable() {
        integration("twilio-sms-bb", "twilio", "sms", true, true);
        integration("jasmin-aa", "jasmin", "sms", true, false);
        assertEquals(ProviderAvailability.Status.AVAILABLE, availability.checkUnpinned("SMS").status());

        integrations.clear();
        availability.invalidate();
        integration("jasmin-aa", "jasmin", "sms", true, false);
        integration("twilio-sms-bb", "twilio", "sms", true, false);
        assertEquals(ProviderAvailability.Status.AVAILABLE, availability.checkUnpinned("SMS").status(),
                "no primary flagged and a non-worker candidate: cannot tell, so do not refuse");
    }

    @Test
    void withNoPrimary_everyActiveCandidateBeingAWorkerProvider_isMissing() {
        integration("ozeki-aa", "ozeki", "sms", true, false);
        integration("smscountry-bb", "smscountry", "sms", true, false);
        integration("twilio-sms-cc", "twilio", "sms", false, false);   // inactive: Novu never picks it
        integration("smtp-dd", "nodemailer", "email", true, true);     // another Novu channel

        assertEquals(ProviderAvailability.Status.WORKER_PROVIDER_MISSING, availability.checkUnpinned("SMS").status());
        assertEquals(ProviderAvailability.Status.AVAILABLE, availability.checkUnpinned("EMAIL").status());
    }

    @Test
    void unpinnedWhatsapp_checksTheIntegrationTheEnvVarNames() {
        config.setWhatsappIntegrationId("jasmin-aa");
        integration("jasmin-aa", "jasmin", "sms", true, false);
        integration("twilio-sms-bb", "twilio", "sms", true, true);

        ProviderAvailability.Result whatsapp = availability.checkUnpinned("WHATSAPP");
        assertEquals(ProviderAvailability.Status.WORKER_PROVIDER_MISSING, whatsapp.status());
        assertTrue(whatsapp.message().contains("NOVU_BRIDGE_INTEGRATION_ID_WHATSAPP"), whatsapp.message());
        // SMS does not use the WhatsApp env pin: its default is the Twilio primary.
        assertEquals(ProviderAvailability.Status.AVAILABLE, availability.checkUnpinned("SMS").status());
    }

    @Test
    void withTheFlagOn_aWorkerPrimaryIsFine_andNovuIsListedOncePerTtl() {
        config.setDigitWorkerProviders(true);
        integration("jasmin-aa", "jasmin", "sms", true, true);

        for (int i = 0; i < 5; i++) {
            assertEquals(ProviderAvailability.Status.AVAILABLE, availability.checkUnpinned("SMS").status());
        }
        verify(novuClient, times(1)).listIntegrations();
    }

    // Field finding (dev deployment, 2026-10-07): SMS switched on with no provider selected and no
    // Novu integration at all. With the stock flag (true) every message was recorded SENT while
    // Novu failed each job with "Subscriber does not have an active integration".
    @Test
    void withTheFlagOn_anUnpinnedChannelWithNoNovuIntegration_isRefused() {
        config.setDigitWorkerProviders(true);

        ProviderAvailability.Result result = availability.checkUnpinned("SMS");

        assertEquals(ProviderAvailability.Status.NO_ACTIVE_INTEGRATION, result.status());
        assertFalse(result.usable(), "nothing can deliver it, so it must not be triggered");
        assertTrue(result.message().contains("no provider selected"), result.message());
        assertTrue(result.message().contains("no active integration"), result.message());
        assertNull(result.identifier());
    }

    @Test
    void anInactiveIntegration_orOneOnAnotherNovuChannel_doesNotCount() {
        config.setDigitWorkerProviders(true);
        integration("twilio-sms-aa", "twilio", "sms", false, true);       // disabled: Novu never picks it
        integration("smtp-bb", "nodemailer", "email", true, true);         // delivers email only

        assertEquals(ProviderAvailability.Status.NO_ACTIVE_INTEGRATION, availability.checkUnpinned("SMS").status());
        assertEquals(ProviderAvailability.Status.AVAILABLE, availability.checkUnpinned("EMAIL").status());
        assertEquals(ProviderAvailability.Status.NO_ACTIVE_INTEGRATION, availability.checkUnpinned("WHATSAPP").status());
    }

    @Test
    void anIntegrationKnownToDeliverAnotherDigitChannel_doesNotStandIn() {
        config.setDigitWorkerProviders(true);
        // Both on Novu's sms channel, each positively one DIGIT channel by its catalog marker.
        integration("twilio-whatsapp-aa", "twilio", "sms", true, true);
        integration("smscountry-bb", "smscountry", "sms", true, false);

        assertEquals(ProviderAvailability.Status.AVAILABLE, availability.checkUnpinned("SMS").status());
        assertEquals(ProviderAvailability.Status.AVAILABLE, availability.checkUnpinned("WHATSAPP").status());

        integrations.clear();
        availability.invalidate();
        integration("twilio-whatsapp-aa", "twilio", "sms", true, true);
        ProviderAvailability.Result sms = availability.checkUnpinned("SMS");
        assertEquals(ProviderAvailability.Status.NO_ACTIVE_INTEGRATION, sms.status());
        assertTrue(sms.message().contains("deliver another channel"), sms.message());
        assertEquals(ProviderAvailability.Status.AVAILABLE, availability.checkUnpinned("WHATSAPP").status());

        integrations.clear();
        availability.invalidate();
        integration("jasmin-aa", "jasmin", "sms", true, true);   // SMS-only provider
        assertEquals(ProviderAvailability.Status.NO_ACTIVE_INTEGRATION, availability.checkUnpinned("WHATSAPP").status());
    }

    @Test
    void anIntegrationTheBridgeCannotIdentify_isGivenTheBenefitOfTheDoubt() {
        config.setDigitWorkerProviders(true);
        integration("generic-sms-aa", "generic-sms", "sms", true, false);   // hand-made in Novu, no marker

        assertEquals(ProviderAvailability.Status.AVAILABLE, availability.checkUnpinned("SMS").status());
        assertEquals(ProviderAvailability.Status.AVAILABLE, availability.checkUnpinned("WHATSAPP").status());
    }

    @Test
    void anEnvPinNovuCannotUse_isJudgedLikeNoPin() {
        config.setDigitWorkerProviders(true);
        config.setWhatsappIntegrationId("whatsapp-gone");

        assertEquals(ProviderAvailability.Status.NO_ACTIVE_INTEGRATION, availability.checkUnpinned("WHATSAPP").status(),
                "the env var names nothing Novu has and nothing else delivers WhatsApp");

        integrations.clear();
        availability.invalidate();
        integration("whatsapp-gone", "twilio", "sms", true, false);
        assertEquals(ProviderAvailability.Status.AVAILABLE, availability.checkUnpinned("WHATSAPP").status());
    }

    @Test
    void failsOpen_whenNovuCannotBeListed_andTheCostIsOneListPerTtl() {
        when(novuClient.listIntegrations()).thenThrow(new CustomException("NB_NOVU_INTEGRATIONS_FAILED", "down"));
        for (int i = 0; i < 5; i++) {
            ProviderAvailability.Result result = availability.checkUnpinned("SMS");
            assertEquals(ProviderAvailability.Status.UNKNOWN, result.status());
            assertTrue(result.usable(), "an outage of Novu's list must not stop OTPs");
        }
        verify(novuClient, times(1)).listIntegrations();
    }

    @Test
    void theSnapshotIsSharedWithThePinnedCheck() {
        integration("jasmin-aa", "jasmin", "sms", true, true);
        for (int i = 0; i < 5; i++) {
            availability.checkUnpinned("SMS");
            availability.check("jasmin-aa", "SMS");
        }
        verify(novuClient, times(1)).listIntegrations();
    }
}
