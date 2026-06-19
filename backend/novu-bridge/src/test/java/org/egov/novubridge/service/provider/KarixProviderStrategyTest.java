package org.egov.novubridge.service.provider;

import org.egov.novubridge.web.models.ResolvedProvider;
import org.egov.novubridge.web.models.ResolvedTemplate;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class KarixProviderStrategyTest {

    private KarixProviderStrategy strategy;

    @BeforeEach
    void setUp() {
        strategy = new KarixProviderStrategy();
    }

    // ── supports() ──────────────────────────────────────────────────────────

    @Test
    void supports_karix_returns_true() {
        assertTrue(strategy.supports("karix"));
    }

    @Test
    void supports_karix_case_insensitive() {
        assertTrue(strategy.supports("Karix"));
        assertTrue(strategy.supports("KARIX"));
    }

    @Test
    void supports_other_providers_returns_false() {
        assertFalse(strategy.supports("twilio"));
        assertFalse(strategy.supports("vonage"));
        assertFalse(strategy.supports("whatsapp-business-api"));
        assertFalse(strategy.supports("plivo"));
        assertFalse(strategy.supports(null));
    }

    // ── getProviderName() ───────────────────────────────────────────────────

    @Test
    void getProviderName_returns_karix() {
        assertEquals("karix", strategy.getProviderName());
    }

    // ── buildProviderConfig() ───────────────────────────────────────────────

    @Test
    void buildProviderConfig_always_returns_empty_map() {
        // Karix delivery is handled by step.custom() in the bridge, not Novu overrides
        ResolvedProvider provider = ResolvedProvider.builder()
                .providerName("karix")
                .channel("whatsapp")
                .credentials(Map.of("accountId", "ACC123", "authToken", "TOK456"))
                .senderNumber("+919999999999")
                .build();

        ResolvedTemplate template = ResolvedTemplate.builder()
                .templateKey("complaints-workflow-apply-karix")
                .contentSid("complaint_apply")
                .build();

        Map<String, String> contentVars = Map.of("1", "CMP-001", "2", "OPEN");

        Map<String, Object> result = strategy.buildProviderConfig(provider, template, contentVars);

        assertNotNull(result);
        assertTrue(result.isEmpty(), "Karix must return empty overrides — delivery is via step.custom()");
    }

    @Test
    void buildProviderConfig_returns_empty_even_with_null_inputs() {
        ResolvedProvider provider = ResolvedProvider.builder().providerName("karix").build();
        ResolvedTemplate template = ResolvedTemplate.builder().build();

        Map<String, Object> result = strategy.buildProviderConfig(provider, template, null);

        assertNotNull(result);
        assertTrue(result.isEmpty());
    }

    // ── isContentSidValid() ─────────────────────────────────────────────────

    @Test
    void isContentSidValid_lowercase_alphanumeric_underscore_is_valid() {
        assertTrue(strategy.isContentSidValid("complaint_apply"));
        assertTrue(strategy.isContentSidValid("otp_send"));
        assertTrue(strategy.isContentSidValid("complaint123"));
        assertTrue(strategy.isContentSidValid("abc"));
    }

    @Test
    void isContentSidValid_uppercase_letters_are_invalid() {
        assertFalse(strategy.isContentSidValid("Complaint_Apply"));
        assertFalse(strategy.isContentSidValid("COMPLAINT_APPLY"));
    }

    @Test
    void isContentSidValid_special_characters_are_invalid() {
        assertFalse(strategy.isContentSidValid("complaint-apply")); // hyphens not allowed
        assertFalse(strategy.isContentSidValid("complaint apply")); // spaces not allowed
        assertFalse(strategy.isContentSidValid("complaint.apply")); // dots not allowed
    }

    @Test
    void isContentSidValid_twilio_hx_format_is_invalid() {
        // Twilio contentSid format must NOT be accepted for Karix
        assertFalse(strategy.isContentSidValid("HXabcdef1234567890abcdef1234567890"));
    }

    @Test
    void isContentSidValid_blank_or_null_is_invalid() {
        assertFalse(strategy.isContentSidValid(null));
        assertFalse(strategy.isContentSidValid(""));
        assertFalse(strategy.isContentSidValid("   "));
    }

    // ── getSupportedChannels() ──────────────────────────────────────────────

    @Test
    void getSupportedChannels_contains_whatsapp_only() {
        String[] channels = strategy.getSupportedChannels();
        assertNotNull(channels);
        assertEquals(1, channels.length);
        assertEquals("whatsapp", channels[0]);
    }
}
