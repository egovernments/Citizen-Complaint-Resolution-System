package org.egov.novubridge.config;

import org.egov.tracer.model.CustomException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

/**
 * NB-2: {@link NovuBridgeConfiguration#getNovuWorkflowId(String)} maps known
 * channels case-insensitively to their per-channel workflow id, and throws
 * {@code CustomException(NB_UNSUPPORTED_CHANNEL)} for unknown/null channels —
 * it NEVER silently defaults to the SMS workflow (the pre-W1 regression).
 */
class NovuBridgeConfigurationChannelMapTest {

    private NovuBridgeConfiguration config;

    @BeforeEach
    void setUp() {
        config = new NovuBridgeConfiguration();
        config.setNovuWorkflowSms("complaints-sms");
        config.setNovuWorkflowWhatsapp("complaints-whatsapp");
        config.setNovuWorkflowEmail("complaints-email");
    }

    @Test
    void getNovuWorkflowId_unknownChannel_throwsUnsupported() {
        CustomException ex = assertThrows(CustomException.class, () -> config.getNovuWorkflowId("PIGEON"));
        assertEquals("NB_UNSUPPORTED_CHANNEL", ex.getCode());
    }

    @Test
    void getNovuWorkflowId_nullChannel_throwsUnsupported() {
        CustomException ex = assertThrows(CustomException.class, () -> config.getNovuWorkflowId(null));
        assertEquals("NB_UNSUPPORTED_CHANNEL", ex.getCode());
    }

    @Test
    void getNovuWorkflowId_knownChannels_mapCorrectly() {
        assertEquals("complaints-sms", config.getNovuWorkflowId("SMS"));
        assertEquals("complaints-whatsapp", config.getNovuWorkflowId("WHATSAPP"));
        assertEquals("complaints-email", config.getNovuWorkflowId("EMAIL"));
    }

    @Test
    void getNovuWorkflowId_isCaseInsensitive() {
        assertEquals("complaints-sms", config.getNovuWorkflowId("sms"));
        assertEquals("complaints-whatsapp", config.getNovuWorkflowId("WhatsApp"));
        assertEquals("complaints-email", config.getNovuWorkflowId("email"));
    }

    @Test
    void isChannelEnabled_matchesConfiguredSetCaseInsensitively_defaultsFalseForNull() {
        config.setChannelsEnabled(java.util.List.of("SMS", "EMAIL"));
        org.junit.jupiter.api.Assertions.assertTrue(config.isChannelEnabled("sms"));
        org.junit.jupiter.api.Assertions.assertTrue(config.isChannelEnabled("EMAIL"));
        org.junit.jupiter.api.Assertions.assertFalse(config.isChannelEnabled("WHATSAPP"));
        org.junit.jupiter.api.Assertions.assertFalse(config.isChannelEnabled(null));
    }
}
