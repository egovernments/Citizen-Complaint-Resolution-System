package org.egov.novubridge.service.provider;

import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.service.NovuClient;
import org.egov.novubridge.service.account.NovuAccount;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Merging #2342 into #2343: the availability check keeps only the integrations of the API key's
 * own Novu environment. For a workspace's own organization that is the WORKSPACE key's
 * environment. Asking with the shared key would name the shared organization's environment, match
 * none of the workspace's integrations, and turn every workspace send into
 * {@code SKIPPED / NB_PROVIDER_UNAVAILABLE}.
 */
class ProviderAvailabilityTenantEnvironmentTest {

    private static final NovuAccount ACME = new NovuAccount("acme", "org-acme", "env-acme-dev", "acme-key");

    private NovuClient novuClient;
    private ProviderAvailability acme;

    private static Map<String, Object> integration(String identifier, String channel, String environment) {
        Map<String, Object> i = new LinkedHashMap<>();
        i.put("_id", "id-" + identifier);
        i.put("identifier", identifier);
        i.put("providerId", "jasmin");
        i.put("channel", channel);
        i.put("active", true);
        i.put("primary", true);
        i.put("_environmentId", environment);
        return i;
    }

    private static NovuClient.NovuResponse environment(String id) {
        return NovuClient.NovuResponse.builder().statusCode(200)
                .response(Map.of("data", Map.of("_id", id, "name", "Development"))).build();
    }

    @BeforeEach
    void setUp() {
        novuClient = mock(NovuClient.class);
        NovuBridgeConfiguration config = new NovuBridgeConfiguration();
        config.setProviderAvailabilityCacheTtlMs(60_000L);
        // The workspace organization: its Development integration (the key's) and a Production one.
        when(novuClient.listIntegrations(ACME)).thenReturn(NovuClient.NovuResponse.builder().statusCode(200)
                .response(Map.of("data", List.of(integration("jasmin-acme", "sms", "env-acme-dev"),
                        integration("jasmin-acme-prod", "sms", "env-acme-prod")))).build());
        when(novuClient.currentEnvironment()).thenReturn(environment("env-shared-dev"));
        when(novuClient.currentEnvironment(ACME)).thenReturn(environment("env-acme-dev"));
        acme = new ProviderAvailability(novuClient, config, ACME);
    }

    @Test
    void aWorkspacesProviders_areJudgedInItsOwnKeysEnvironment_notTheSharedOnes() {
        ProviderAvailability.Result pinned = acme.check("jasmin-acme", "SMS");
        assertEquals(ProviderAvailability.Status.AVAILABLE, pinned.status(), pinned.message());
        ProviderAvailability.Result unpinned = acme.checkUnpinned("SMS");
        assertTrue(unpinned.usable(), unpinned.message());
        verify(novuClient).currentEnvironment(ACME);
        verify(novuClient, never()).currentEnvironment();
    }

    @Test
    void theWorkspacesOtherEnvironment_stillDoesNotCount() {
        assertEquals(ProviderAvailability.Status.MISSING, acme.check("jasmin-acme-prod", "SMS").status());
    }
}
