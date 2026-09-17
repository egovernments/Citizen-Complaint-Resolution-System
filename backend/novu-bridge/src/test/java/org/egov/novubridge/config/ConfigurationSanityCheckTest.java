package org.egov.novubridge.config;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class ConfigurationSanityCheckTest {

    private NovuBridgeConfiguration config;

    @BeforeEach
    void healthy() {
        config = new NovuBridgeConfiguration();
        config.setSmsProvider("");
        config.setPreferenceEnabled(false);
        config.setChannelPolicyEnabled(true);
        config.setMdmsHost("http://mdms");
        config.setChannelsEnabled(List.of("SMS"));
        config.setNovuApiKey("real-key");
        config.setProxyAuthEnabled(true);
    }

    @Test
    void healthyConfigStarts() {
        assertDoesNotThrow(() -> new ConfigurationSanityCheck(config).verify());
    }

    @Test
    void smscountryWithoutCredentials_refusesToStart() {
        config.setSmsProvider("smscountry");
        config.setSmsCountryUser("");
        config.setSmsCountryPassword("");
        IllegalStateException ex = assertThrows(IllegalStateException.class, () -> new ConfigurationSanityCheck(config).verify());
        assertTrue(ex.getMessage().contains("smscountry"));
    }

    @Test
    void consentGateWithoutHost_refusesToStart() {
        config.setPreferenceEnabled(true);
        config.setPreferenceHost("");
        assertThrows(IllegalStateException.class, () -> new ConfigurationSanityCheck(config).verify());
    }

    @Test
    void warningsDoNotBlockStartup() {
        config.setChannelsEnabled(List.of("WHATSAPP"));
        config.setWhatsappIntegrationId("");
        config.setNovuApiKey("test-api-key");
        config.setProxyAuthEnabled(false);
        assertDoesNotThrow(() -> new ConfigurationSanityCheck(config).verify());
    }
}
