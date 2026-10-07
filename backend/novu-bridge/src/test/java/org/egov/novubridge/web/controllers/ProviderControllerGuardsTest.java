package org.egov.novubridge.web.controllers;

import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.repository.DispatchLogRepository;
import org.egov.novubridge.service.NovuClient;
import org.egov.novubridge.service.TwilioTemplateSyncService;
import org.egov.novubridge.service.delivery.DeliveryProviderRegistry;
import org.egov.novubridge.service.delivery.NovuDeliveryProvider;
import org.egov.novubridge.service.policy.ChannelPolicyClient;
import org.egov.novubridge.service.provider.ProviderAvailability;
import org.egov.novubridge.service.provider.ProviderCatalog;
import org.egov.novubridge.service.provider.ProviderType;
import org.egov.tracer.model.CustomException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestTemplate;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.nullable;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The two guards a delete / disable / create has to pass beyond "a channel row pins it":
 * <ul>
 *   <li>the LAST active integration on a Novu channel is what every unpinned channel sends
 *       through (legacy rows without {@code provider}, the env allowlist, policy off);</li>
 *   <li>SMSCountry / Ozeki / Jasmin only exist when the worker loads DIGIT's providers
 *       ({@code novu.bridge.digit.worker.providers}).</li>
 * </ul>
 */
class ProviderControllerGuardsTest {

    private NovuClient novuClient;
    private RestTemplate mdms;
    private NovuBridgeConfiguration config;
    private final List<Map<String, Object>> integrations = new ArrayList<>();

    @BeforeEach
    @SuppressWarnings({"unchecked", "rawtypes"})
    void setUp() {
        novuClient = mock(NovuClient.class);
        mdms = mock(RestTemplate.class);
        config = new NovuBridgeConfiguration();
        config.setSmsCountryUrl("http://api.smscountry.com/SMSCwebservice_bulk.aspx");
        config.setChannelPolicyEnabled(true);
        config.setChannelPolicySchema("NOTIFICATIONS.Channel");
        config.setChannelPolicyLegacySchema("RAINMAKER-PGR.NotificationChannel");
        config.setMdmsHost("http://mdms");
        config.setMdmsSearchPath("/mdms-v2/v2/_search");
        config.setChannelsEnabled(List.of(""));
        config.setSmsProvider("");
        config.setCoreSmsDefaultTenant("ke");
        when(novuClient.listIntegrations()).thenAnswer(inv -> NovuClient.NovuResponse.builder()
                .statusCode(200).response(Map.of("data", integrations)).build());
        when(novuClient.deleteIntegration(anyString())).thenReturn(
                NovuClient.NovuResponse.builder().statusCode(200).response(Map.of()).build());
        when(novuClient.updateIntegration(anyString(), nullable(String.class), nullable(Map.class),
                nullable(Boolean.class))).thenReturn(
                NovuClient.NovuResponse.builder().statusCode(200).response(Map.of("data", Map.of("_id", "x"))).build());
        noRows();
    }

    private ProviderController controller() {
        ChannelPolicyClient policy = new ChannelPolicyClient(mdms, config);
        return new ProviderController(novuClient,
                new DeliveryProviderRegistry(config, policy, new NovuDeliveryProvider(novuClient), null),
                mock(DispatchLogRepository.class), mock(TwilioTemplateSyncService.class),
                new ProviderCatalog(config), policy, new ProviderAvailability(novuClient, config));
    }

    private void integration(String id, String identifier, String providerId, String channel, boolean active) {
        Map<String, Object> i = new LinkedHashMap<>();
        i.put("_id", id);
        i.put("identifier", identifier);
        i.put("providerId", providerId);
        i.put("channel", channel);
        i.put("active", active);
        integrations.add(i);
    }

    /** The state's channel rows, served for every schema (new and legacy alike). */
    @SuppressWarnings({"unchecked", "rawtypes"})
    private void rows(Map<String, Object>... data) {
        List<Map<String, Object>> mdmsRows = new ArrayList<>();
        for (Map<String, Object> d : data) {
            mdmsRows.add(Map.of("uniqueIdentifier", d.get("code"), "isActive", true, "data", d));
        }
        when(mdms.exchange(anyString(), eq(HttpMethod.POST), any(HttpEntity.class), eq(Map.class)))
                .thenReturn(new ResponseEntity(Map.of("mdms", mdmsRows), HttpStatus.OK));
    }

    private void noRows() {
        rows();
    }

    private static Map<String, Object> channel(String code, boolean enabled, String gateway, String provider) {
        Map<String, Object> d = new HashMap<>();
        d.put("code", code);
        d.put("enabled", enabled);
        d.put("active", true);
        if (gateway != null) d.put("gateway", gateway);
        if (provider != null) d.put("provider", provider);
        return d;
    }

    private static Map<String, Object> delete(String id) {
        return new LinkedHashMap<>(Map.of("id", id, "tenantId", "ke"));
    }

    private static Map<String, Object> disable(String id) {
        return new LinkedHashMap<>(Map.of("id", id, "tenantId", "ke", "active", false));
    }

    private void assertRefusedInUse(Runnable call, String... inMessage) {
        ProviderController.Refusal refusal = assertThrows(ProviderController.Refusal.class, call::run);
        assertEquals(HttpStatus.CONFLICT, refusal.status());
        assertEquals("NB_PROVIDER_IN_USE", refusal.code());
        for (String s : inMessage) {
            assertTrue(refusal.getMessage().contains(s), refusal.getMessage());
        }
        verify(novuClient, never()).deleteIntegration(anyString());
        verify(novuClient, never()).updateIntegration(anyString(), nullable(String.class), nullable(Map.class),
                nullable(Boolean.class));
    }

    // ---- M3: the last active integration behind unpinned channels ----------------

    @Test
    void deletingTheLastActiveSmsIntegration_isRefused_whileALegacyUnpinnedSmsRowIsOn() {
        integration("i1", "twilio-sms-aa", "twilio", "sms", true);
        integration("i2", "smtp-bb", "nodemailer", "email", true);   // another channel does not count
        rows(channel("SMS", true, "novu", null));                    // legacy row: no `provider` field

        assertRefusedInUse(() -> controller().deleteProvider(delete("i1")),
                "last active SMS integration", "ke:SMS");
        assertRefusedInUse(() -> controller().updateProvider(disable("i1")), "ke:SMS");
    }

    // Review (4): Novu stores Twilio WhatsApp as an `sms` integration, but it cannot carry SMS.
    @Test
    void aWhatsappIntegrationIsNoSubstituteForSms() {
        integration("i1", "twilio-sms-aa", "twilio", "sms", true);
        integration("i2", "twilio-whatsapp-bb", "twilio", "sms", true);
        integration("i3", "whatsapp-cc", "twilio", "sms", true);      // pre-catalog WhatsApp marker
        rows(channel("SMS", true, "novu", null));

        assertRefusedInUse(() -> controller().deleteProvider(delete("i1")),
                "last active SMS integration", "ke:SMS");
        assertRefusedInUse(() -> controller().updateProvider(disable("i1")), "ke:SMS");
    }

    @Test
    void norAnSmsIntegrationForWhatsapp_andAnSmsOneServesNoUnpinnedWhatsapp() {
        integration("i1", "twilio-sms-aa", "twilio", "sms", true);
        integration("i2", "twilio-whatsapp-bb", "twilio", "sms", true);
        rows(channel("WHATSAPP", true, null, null));

        assertRefusedInUse(() -> controller().deleteProvider(delete("i2")),
                "last active WHATSAPP integration", "ke:WHATSAPP");

        controller().deleteProvider(delete("i1"));   // no SMS channel is on; WhatsApp never needed it
        verify(novuClient).deleteIntegration("i1");
    }

    @Test
    void theIntegrationTheWhatsappEnvVarNames_isInUse_whileUnpinnedWhatsappIsOn() {
        config.setWhatsappIntegrationId("twilio-whatsapp-bb");
        integration("i1", "twilio-sms-aa", "twilio", "sms", true);
        integration("i2", "twilio-whatsapp-bb", "twilio", "sms", true);
        integration("i3", "twilio-whatsapp-cc", "twilio", "sms", true);  // another WhatsApp one remains
        rows(channel("WHATSAPP", true, null, null));

        assertRefusedInUse(() -> controller().deleteProvider(delete("i2")),
                "NOVU_BRIDGE_INTEGRATION_ID_WHATSAPP", "ke:WHATSAPP");
        assertRefusedInUse(() -> controller().updateProvider(disable("i2")), "NOVU_BRIDGE_INTEGRATION_ID_WHATSAPP");

        // Unpinned WhatsApp names i2 alone, so i3 is no one's default even though it is WhatsApp.
        controller().deleteProvider(delete("i3"));
        verify(novuClient).deleteIntegration("i3");
    }

    @Test
    void theEnvVarMayNameTheNovuId_andAPinNobodyRidesMayGo() {
        config.setWhatsappIntegrationId("i2");
        integration("i2", "twilio-whatsapp-bb", "twilio", "sms", true);
        rows(channel("WHATSAPP", true, null, null));
        assertRefusedInUse(() -> controller().deleteProvider(delete("twilio-whatsapp-bb")),
                "NOVU_BRIDGE_INTEGRATION_ID_WHATSAPP");

        rows(channel("WHATSAPP", true, null, "twilio-whatsapp-bb"));   // pinned on the row instead
        assertRefusedInUse(() -> controller().deleteProvider(delete("i2")), "still selected");

        rows(channel("WHATSAPP", false, null, null));                  // WhatsApp off everywhere
        controller().deleteProvider(delete("i2"));
        verify(novuClient).deleteIntegration("i2");
    }

    @Test
    void theEnvAllowlistCounts_forAStateWithNoRows_andForEveryTenantWithThePolicyOff() {
        integration("i1", "twilio-sms-aa", "twilio", "sms", true);
        config.setChannelsEnabled(List.of("SMS"));

        assertRefusedInUse(() -> controller().deleteProvider(delete("i1")), "ke:SMS");

        config.setChannelPolicyEnabled(false);
        assertRefusedInUse(() -> controller().deleteProvider(delete("i1")), "all tenants:SMS");
    }

    @Test
    void theLastActiveIntegrationMayGo_whenNothingSendsThroughTheDefault() {
        integration("i1", "twilio-sms-aa", "twilio", "sms", true);
        // SMS pinned elsewhere, SMS on the direct SMSCountry route, EMAIL is another Novu channel,
        // a disabled row: none of them uses Novu's default sms integration.
        rows(channel("SMS", true, "smscountry", null), channel("EMAIL", true, null, null),
                channel("WHATSAPP", false, null, null));

        controller().deleteProvider(delete("i1"));

        verify(novuClient).deleteIntegration("i1");
    }

    @Test
    void anotherActiveIntegrationOnTheSameChannel_orAnInactiveTarget_isNotTheLastActive() {
        integration("i1", "twilio-sms-aa", "twilio", "sms", true);
        integration("i2", "twilio-sms-cc", "twilio", "sms", true);
        integration("i3", "ozeki-dd", "ozeki", "sms", false);
        rows(channel("SMS", true, null, null));

        controller().deleteProvider(delete("i1"));   // i2 still serves the unpinned SMS
        verify(novuClient).deleteIntegration("i1");

        // Alone on its channel, but disabled: Novu never selects it, so removing it changes nothing.
        integrations.removeIf(i -> !"i3".equals(i.get("_id")));
        controller().deleteProvider(delete("i3"));
        verify(novuClient).deleteIntegration("i3");
    }

    @Test
    void failsClosed_whenTheChannelRowsCannotBeRead_orNovuCannotBeListed() {
        integration("i1", "twilio-sms-aa", "twilio", "sms", true);
        when(mdms.exchange(anyString(), eq(HttpMethod.POST), any(HttpEntity.class), eq(Map.class)))
                .thenThrow(new ResourceAccessException("mdms down"));
        assertRefusedInUse(() -> controller().deleteProvider(delete("i1")), "unreadable");

        when(novuClient.listIntegrations()).thenThrow(
                new CustomException("NB_NOVU_INTEGRATIONS_FAILED", "Novu down"));
        CustomException ex = assertThrows(CustomException.class, () -> controller().deleteProvider(delete("i1")));
        assertEquals("NB_NOVU_INTEGRATIONS_FAILED", ex.getCode());
        verify(novuClient, never()).deleteIntegration(anyString());
    }

    @Test
    void theOwningStatesRowsAreCheckedEvenWhenTheCallerNamesAnotherState_rightAfterARestart() {
        integration("i1", "twilio-sms-aa", "twilio", "sms", true);
        config.setProviderAdminTenants(List.of("acme"));
        // Only acme's (the explicit owning state's) rows lean on the default; the request names ke.
        when(mdms.exchange(anyString(), eq(HttpMethod.POST), any(HttpEntity.class), eq(Map.class)))
                .thenAnswer(inv -> {
                    @SuppressWarnings("unchecked")
                    Map<String, Object> body = (Map<String, Object>) ((HttpEntity<?>) inv.getArgument(2)).getBody();
                    @SuppressWarnings("unchecked")
                    Map<String, Object> criteria = (Map<String, Object>) body.get("MdmsCriteria");
                    List<Object> mdmsRows = "acme".equals(criteria.get("tenantId"))
                            ? List.of(Map.of("uniqueIdentifier", "SMS", "isActive", true,
                                    "data", channel("SMS", true, null, null)))
                            : List.of();
                    return new ResponseEntity<>(Map.of("mdms", mdmsRows), HttpStatus.OK);
                });

        assertRefusedInUse(() -> controller().deleteProvider(delete("i1")), "acme:SMS");
    }

    // ---- M1: DIGIT's worker providers on a worker without them ------------------

    @Test
    void withTheWorkerProvidersOff_theCatalogHidesThem() {
        config.setDigitWorkerProviders(false);
        @SuppressWarnings("unchecked")
        List<ProviderType> types = (List<ProviderType>) controller().catalog().getBody().get("data");
        assertEquals(List.of("twilio-sms", "twilio-whatsapp", "smtp"), types.stream().map(ProviderType::getType).toList());

        config.setDigitWorkerProviders(true);
        @SuppressWarnings("unchecked")
        List<ProviderType> all = (List<ProviderType>) controller().catalog().getBody().get("data");
        assertEquals(6, all.size(), "the stock deployment mounts them");
    }

    @Test
    void withTheWorkerProvidersOff_creatingOne_isRefused_inBothForms() {
        config.setDigitWorkerProviders(false);
        // Novu itself would accept them: the refusal has to be the bridge's own.
        NovuClient.NovuResponse created = NovuClient.NovuResponse.builder().statusCode(201)
                .response(Map.of("data", Map.of("_id", "new"))).build();
        when(novuClient.createIntegration(nullable(String.class), nullable(String.class), anyString(), anyString(),
                nullable(Map.class))).thenReturn(created);
        when(novuClient.createIntegration(nullable(String.class), nullable(String.class), anyString(), anyString(),
                nullable(Map.class), anyBoolean())).thenReturn(created);
        for (String type : List.of("smscountry", "ozeki", "jasmin")) {
            Map<String, Object> req = new LinkedHashMap<>();
            req.put("type", type);
            req.put("credentials", Map.of("baseUrl", "http://gw", "user", "u", "password", "p", "from", "X"));
            CustomException ex = assertThrows(CustomException.class, () -> controller().createProvider(req), type);
            assertEquals("NB_PROVIDER_TYPE_UNAVAILABLE", ex.getCode(), type);
            assertTrue(ex.getMessage().contains("NOVU_BRIDGE_DIGIT_WORKER_PROVIDERS"), ex.getMessage());
        }
        Map<String, Object> legacy = new LinkedHashMap<>(Map.of("channel", "SMS", "providerId", "Ozeki",
                "credentials", Map.of("user", "u")));
        CustomException ex = assertThrows(CustomException.class, () -> controller().createProvider(legacy));
        assertEquals("NB_PROVIDER_TYPE_UNAVAILABLE", ex.getCode());
        verify(novuClient, never()).createIntegration(nullable(String.class), nullable(String.class),
                anyString(), anyString(), nullable(Map.class));
        verify(novuClient, never()).createIntegration(nullable(String.class), nullable(String.class),
                anyString(), anyString(), nullable(Map.class), anyBoolean());
    }

    @Test
    void withTheWorkerProvidersOff_rotatingReEnablingOrTestingOne_isRefused_butRenameAndDeleteStillWork() {
        config.setDigitWorkerProviders(false);
        integration("i1", "smscountry-aa", "smscountry", "sms", false);

        Map<String, Object> rotate = new LinkedHashMap<>(Map.of("id", "i1",
                "credentials", Map.of("user", "u", "password", "p", "from", "KEGOV")));
        assertEquals("NB_PROVIDER_TYPE_UNAVAILABLE",
                assertThrows(CustomException.class, () -> controller().updateProvider(rotate)).getCode());
        Map<String, Object> enable = new LinkedHashMap<>(Map.of("id", "i1", "active", true));
        assertEquals("NB_PROVIDER_TYPE_UNAVAILABLE",
                assertThrows(CustomException.class, () -> controller().updateProvider(enable)).getCode());
        Map<String, Object> test = new LinkedHashMap<>(Map.of("id", "i1", "channel", "SMS",
                "to", Map.of("phone", "+15550100"), "body", "hi"));
        assertEquals("NB_PROVIDER_TYPE_UNAVAILABLE",
                assertThrows(CustomException.class, () -> controller().testSend(test)).getCode());
        verify(novuClient, never()).updateIntegration(anyString(), nullable(String.class), nullable(Map.class),
                nullable(Boolean.class));
        verify(novuClient, never()).trigger(anyString(), anyString(), nullable(String.class),
                nullable(String.class), anyMap(), anyString(), nullable(Map.class));

        // Cleaning up after the flag was turned off must stay possible.
        controller().updateProvider(new LinkedHashMap<>(Map.of("id", "i1", "name", "old gateway")));
        controller().deleteProvider(delete("i1"));
        verify(novuClient).deleteIntegration("i1");
    }

    @Test
    void withTheWorkerProvidersOn_nothingChanges() {
        integration("i1", "smscountry-aa", "smscountry", "sms", false);
        Map<String, Object> rotate = new LinkedHashMap<>(Map.of("id", "i1",
                "credentials", Map.of("user", "u", "password", "p", "from", "KEGOV")));
        controller().updateProvider(rotate);
        verify(novuClient).updateIntegration(eq("i1"), nullable(String.class), anyMap(), nullable(Boolean.class));
        assertFalse(new ProviderCatalog(config).isUnavailable("smscountry"));
    }
}
