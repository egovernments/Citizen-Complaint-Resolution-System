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
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Review of #2342: the pinned check ({@link ProviderAvailability#check}) compared Novu's channel
 * only, and SMS and WhatsApp share Novu's {@code sms} channel; integrations of another Novu
 * environment were counted; and test-send's fresh read dropped dispatch's failure back-off.
 */
class ProviderAvailabilityPinnedTest {

    private static final String PRODUCTION = "env-prod";
    private static final String DEVELOPMENT = "env-dev";

    private NovuClient novuClient;
    private NovuBridgeConfiguration config;
    private ProviderAvailability availability;
    private final List<Map<String, Object>> integrations = new ArrayList<>();

    @BeforeEach
    void setUp() {
        novuClient = mock(NovuClient.class);
        config = new NovuBridgeConfiguration();
        config.setProviderAvailabilityCacheTtlMs(60_000L);
        when(novuClient.listIntegrations()).thenAnswer(inv -> NovuClient.NovuResponse.builder()
                .statusCode(200).response(Map.of("data", new ArrayList<>(integrations))).build());
        when(novuClient.currentEnvironment()).thenReturn(NovuClient.NovuResponse.builder()
                .statusCode(200).response(Map.of("data", Map.of("_id", PRODUCTION, "name", "Production"))).build());
        availability = new ProviderAvailability(novuClient, config);
    }

    private Map<String, Object> integration(String identifier, String providerId, String channel, boolean active,
                                            String environment) {
        Map<String, Object> i = new LinkedHashMap<>();
        i.put("_id", "id-" + identifier + "-" + environment);
        i.put("identifier", identifier);
        i.put("providerId", providerId);
        i.put("channel", channel);
        i.put("active", active);
        i.put("_environmentId", environment);
        integrations.add(i);
        return i;
    }

    // ---- SMS and WhatsApp share Novu's sms channel ------------------------------------------

    @Test
    void aTwilioSmsIntegrationPinnedOnWhatsApp_isAChannelMismatch() {
        integration("twilio-sms-aa", "twilio", "sms", true, PRODUCTION);

        ProviderAvailability.Result result = availability.check("twilio-sms-aa", "WHATSAPP");

        assertEquals(ProviderAvailability.Status.CHANNEL_MISMATCH, result.status());
        assertFalse(result.usable());
        assertTrue(result.message().contains("delivers SMS, not WHATSAPP"), result.message());
        assertTrue(result.message().contains("Nothing was sent"), result.message());
    }

    @Test
    void aTwilioWhatsAppIntegrationPinnedOnSms_isAChannelMismatch() {
        integration("twilio-whatsapp-aa", "twilio", "sms", true, PRODUCTION);

        ProviderAvailability.Result result = availability.check("twilio-whatsapp-aa", "SMS");

        assertEquals(ProviderAvailability.Status.CHANNEL_MISMATCH, result.status());
        assertTrue(result.message().contains("delivers WHATSAPP, not SMS"), result.message());
    }

    @Test
    void anSmsOnlyGatewayPinnedOnWhatsApp_isAChannelMismatch_byItsNovuProvider() {
        // A hand-named SMSCountry integration: no catalog marker, but SMSCountry only sends SMS.
        integration("bulk-gateway", "smscountry", "sms", true, PRODUCTION);

        assertEquals(ProviderAvailability.Status.CHANNEL_MISMATCH, availability.check("bulk-gateway", "WHATSAPP").status());
    }

    @Test
    void eachPinnedOnItsOwnChannel_isAvailable_andAnUnidentifiableOneIsNeverRefused() {
        integration("twilio-sms-aa", "twilio", "sms", true, PRODUCTION);
        integration("twilio-whatsapp-bb", "twilio", "sms", true, PRODUCTION);
        integration("hand-made", "twilio", "sms", true, PRODUCTION);

        assertEquals(ProviderAvailability.Status.AVAILABLE, availability.check("twilio-sms-aa", "SMS").status());
        assertEquals(ProviderAvailability.Status.AVAILABLE, availability.check("twilio-whatsapp-bb", "WHATSAPP").status());
        assertEquals(ProviderAvailability.Status.AVAILABLE, availability.check("hand-made", "WHATSAPP").status());
        assertEquals(ProviderAvailability.Status.AVAILABLE, availability.check("hand-made", "SMS").status());
    }

    // ---- only the API key's own Novu environment counts ---------------------------------------

    @Test
    void anIntegrationOnlyInAnotherEnvironment_isMissing() {
        integration("twilio-sms-dev", "twilio", "sms", true, DEVELOPMENT);

        assertEquals(ProviderAvailability.Status.MISSING, availability.check("twilio-sms-dev", "SMS").status());
        assertEquals(ProviderAvailability.Status.NO_ACTIVE_INTEGRATION, availability.checkUnpinned("SMS").status(),
                "Development's active integration does not deliver a Production trigger");
    }

    @Test
    void theSameIdentifierInTwoEnvironments_isJudgedByTheKeysOwn() {
        integration("twilio-sms-aa", "twilio", "sms", false, PRODUCTION);
        integration("twilio-sms-aa", "twilio", "sms", true, DEVELOPMENT);   // listed after: used to win

        assertEquals(ProviderAvailability.Status.INACTIVE, availability.check("twilio-sms-aa", "SMS").status());
    }

    @Test
    void whenNovuDoesNotNameTheEnvironment_everyEnvironmentCounts_asBefore() {
        when(novuClient.currentEnvironment()).thenThrow(new CustomException("NB_NOVU_INTEGRATIONS_FAILED", "404"));
        integration("twilio-sms-dev", "twilio", "sms", true, DEVELOPMENT);

        assertEquals(ProviderAvailability.Status.AVAILABLE, availability.check("twilio-sms-dev", "SMS").status());
    }

    @Test
    void theEnvironmentIsAskedOnce() {
        integration("twilio-sms-aa", "twilio", "sms", true, PRODUCTION);
        for (int i = 0; i < 3; i++) {
            availability.checkFresh("twilio-sms-aa", "SMS");
        }
        verify(novuClient, times(3)).listIntegrations();
        verify(novuClient, times(1)).currentEnvironment();
    }

    // ---- test-send's fresh read keeps the failure back-off --------------------------------------

    @Test
    void aFreshCheck_readsNovuAgain_evenWithASnapshotInsideItsTtl() {
        Map<String, Object> i1 = integration("twilio-sms-aa", "twilio", "sms", true, PRODUCTION);
        assertTrue(availability.check("twilio-sms-aa", "SMS").usable());
        i1.put("active", false);

        assertEquals(ProviderAvailability.Status.AVAILABLE, availability.check("twilio-sms-aa", "SMS").status(),
                "dispatch still answers from its snapshot");
        assertEquals(ProviderAvailability.Status.INACTIVE, availability.checkFresh("twilio-sms-aa", "SMS").status());
        assertEquals(ProviderAvailability.Status.INACTIVE, availability.check("twilio-sms-aa", "SMS").status(),
                "the fresh read now serves dispatch too");
    }

    @Test
    void duringANovuOutage_repeatedFreshChecksCostOneListCall_andKeepDispatchsBackoff() {
        when(novuClient.listIntegrations()).thenThrow(new CustomException("NB_NOVU_INTEGRATIONS_FAILED", "down"));

        for (int i = 0; i < 5; i++) {
            ProviderAvailability.Result result = availability.checkFresh("twilio-sms-aa", "SMS");
            assertEquals(ProviderAvailability.Status.UNKNOWN, result.status());
            assertEquals(ProviderAvailability.Status.UNKNOWN, availability.checkUnpinnedFresh("SMS").status());
            assertEquals(ProviderAvailability.Status.UNKNOWN, availability.check("twilio-sms-aa", "SMS").status());
        }
        verify(novuClient, times(1)).listIntegrations();
    }

    @Test
    void invalidate_stillClearsTheBackoff_forTheBridgesOwnProviderWrites() {
        when(novuClient.listIntegrations()).thenThrow(new CustomException("NB_NOVU_INTEGRATIONS_FAILED", "down"));
        availability.check("twilio-sms-aa", "SMS");
        reset(novuClient);
        integration("twilio-sms-aa", "twilio", "sms", true, PRODUCTION);
        when(novuClient.listIntegrations()).thenAnswer(inv -> NovuClient.NovuResponse.builder()
                .statusCode(200).response(Map.of("data", new ArrayList<>(integrations))).build());

        availability.invalidate();   // a provider create/_update/_delete just reached Novu

        assertEquals(ProviderAvailability.Status.AVAILABLE, availability.check("twilio-sms-aa", "SMS").status());
    }
}
