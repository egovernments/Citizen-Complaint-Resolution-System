package org.egov.novubridge.service.account;

import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.service.NovuClient;
import org.egov.novubridge.service.policy.ChannelPolicyClient;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** What "a working provider for the channel" means in a tenant's own account. */
class ChannelReadinessTest {

    private final List<Map<String, Object>> integrations = new ArrayList<>();
    private ChannelPolicyClient policy;
    private NovuBridgeConfiguration config;
    private ChannelReadiness readiness;
    private final NovuAccount account = new NovuAccount("acme", "org", "env", "key");

    @BeforeEach
    void setUp() {
        NovuClient novu = mock(NovuClient.class);
        when(novu.listIntegrations(any(NovuAccount.class))).thenAnswer(inv -> NovuClient.NovuResponse.builder()
                .statusCode(200).response(Map.of("data", integrations)).build());
        policy = mock(ChannelPolicyClient.class);
        config = new NovuBridgeConfiguration();
        readiness = new ChannelReadiness(novu, policy, config);
        // Every new organization has Novu's own in-app integration: it is never a provider.
        integrations.add(Map.of("_id", "inapp", "providerId", "novu", "channel", "in_app", "active", true, "primary", true));
    }

    private static Map<String, Object> integration(String id, String identifier, String providerId, String channel,
                                                   boolean active, boolean primary) {
        return Map.of("_id", id, "identifier", identifier, "providerId", providerId, "channel", channel,
                "active", active, "primary", primary);
    }

    @Test
    void anOrganizationWithOnlyNovusBuiltIns_hasNoProviderForAnyChannel() {
        integrations.add(Map.of("_id", "demo", "providerId", "novu", "channel", "email", "active", true));
        readiness.evaluateAll(account, "acme").values().forEach(r -> {
            assertFalse(r.ready(), r.channel());
            assertTrue(r.reason().contains("no active " + r.channel()), r.reason());
        });
    }

    @Test
    void unpinned_thePrimaryActiveCandidateWins_andAWhatsappSenderNeverCarriesSms() {
        integrations.add(integration("w", "twilio-whatsapp-aa", "twilio", "sms", true, true));
        integrations.add(integration("j1", "jasmin-off", "jasmin", "sms", false, false));
        integrations.add(integration("j2", "jasmin-on", "jasmin", "sms", true, false));
        integrations.add(integration("t", "twilio-sms-main", "twilio", "sms", true, true));

        ChannelReadiness.Readiness sms = readiness.evaluate(account, "acme", "SMS");

        assertTrue(sms.ready());
        assertEquals("twilio-sms-main", sms.identifier());
        assertFalse(sms.pinned());
        ChannelReadiness.Readiness whatsapp = readiness.evaluate(account, "acme", "WHATSAPP");
        assertEquals("twilio-whatsapp-aa", whatsapp.identifier());
    }

    @Test
    void pinned_theChannelRowsChoiceIsHonouredExactly() {
        integrations.add(integration("j", "jasmin-a", "jasmin", "sms", true, false));
        integrations.add(integration("t", "twilio-sms-b", "twilio", "sms", true, true));
        when(policy.provider(anyString(), anyString())).thenReturn("jasmin-a");

        ChannelReadiness.Readiness sms = readiness.evaluate(account, "acme", "SMS");

        assertTrue(sms.ready());
        assertTrue(sms.pinned());
        assertEquals("jasmin-a", sms.identifier());
    }

    @Test
    void pinned_aMissingDisabledOrWrongChannelProvider_isNotReady_evenWithOthersAvailable() {
        integrations.add(integration("t", "twilio-sms-b", "twilio", "sms", true, true));
        integrations.add(integration("off", "jasmin-off", "jasmin", "sms", false, false));
        integrations.add(integration("m", "smtp-mail", "nodemailer", "email", true, false));

        when(policy.provider(anyString(), anyString())).thenReturn("gone-123");
        assertTrue(readiness.evaluate(account, "acme", "SMS").reason().contains("does not exist"));
        when(policy.provider(anyString(), anyString())).thenReturn("jasmin-off");
        assertTrue(readiness.evaluate(account, "acme", "SMS").reason().contains("disabled"));
        when(policy.provider(anyString(), anyString())).thenReturn("smtp-mail");
        assertTrue(readiness.evaluate(account, "acme", "SMS").reason().contains("does not carry SMS"));
    }

    @Test
    void withoutTheWorkerProviders_jasminIsNotAProvider() {
        integrations.add(integration("j", "jasmin-a", "jasmin", "sms", true, true));
        config.setDigitWorkerProviders(false);

        assertFalse(readiness.evaluate(account, "acme", "SMS").ready());
    }
}
