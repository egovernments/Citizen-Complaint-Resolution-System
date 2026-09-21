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
        // The resolution stage's own preconditions. They have non-blank defaults in
        // application.properties, so a real deployment only reaches these by setting them
        // empty — but this object is built by hand, so the healthy case must say them.
        config.setMdmsSearchPath("/mdms-v2/v2/_search");
        config.setNotificationConfigNamespace("NOTIFICATIONS");
        config.setNotificationConfigPageSize(200);
        config.setNotificationConfigMaxPages(50);
        config.setNotificationRecipientCap(1000);
        config.setUserHost("http://user");
        config.setUserSearchPath("/user/_search");
        config.setLocalizationHost("http://localization");
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
    void noMdmsHost_refusesToStart() {
        // Without MDMS there is no routing row, no template and no catalogue: every thin event
        // would be SKIPPED / NB_NO_ROUTING, which reads as "nobody configured this tenant"
        // rather than "this deployment cannot read its configuration".
        config.setMdmsHost("");
        IllegalStateException ex = assertThrows(IllegalStateException.class,
                () -> new ConfigurationSanityCheck(config).verify());
        assertTrue(ex.getMessage().contains("NB_NO_ROUTING"));
    }

    @Test
    void aZeroRecipientCap_refusesToStart() {
        config.setNotificationRecipientCap(0);
        assertThrows(IllegalStateException.class, () -> new ConfigurationSanityCheck(config).verify());
    }

    @Test
    void aBlankNotificationsNamespace_refusesToStart() {
        config.setNotificationConfigNamespace("");
        assertThrows(IllegalStateException.class, () -> new ConfigurationSanityCheck(config).verify());
    }

    @Test
    void noUserHostIsOnlyAWarning() {
        // A producer that puts contacts on the event itself still delivers; only ROLE audiences
        // and uuid-only actors stop working. That is a degraded deployment, not a dead one.
        config.setUserHost("");
        assertDoesNotThrow(() -> new ConfigurationSanityCheck(config).verify());
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
