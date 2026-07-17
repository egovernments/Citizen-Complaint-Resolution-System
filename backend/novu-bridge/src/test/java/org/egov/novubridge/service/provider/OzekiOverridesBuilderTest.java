package org.egov.novubridge.service.provider;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Shape coverage for {@link OzekiOverridesBuilder}: the Novu trigger overrides
 * envelope that routes an SMS through an Ozeki gateway behind Novu's built-in
 * {@code generic-sms} provider. The exact key shapes are load-bearing — Novu's
 * worker looks up {@code overrides.providers[providerId]} and deep-merges
 * {@code _passthrough.body} verbatim into the outgoing gateway request.
 */
class OzekiOverridesBuilderTest {

    private static final String TXN = "txn-123";
    private static final String PHONE = "+254712345678";
    private static final String TEXT = "Your complaint PGR-1 was resolved";

    @SuppressWarnings("unchecked")
    private static Map<String, Object> messageAt(Map<String, Object> overrides) {
        Map<String, Object> providers = (Map<String, Object>) overrides.get("providers");
        Map<String, Object> generic = (Map<String, Object>) providers.get(OzekiOverridesBuilder.NOVU_PROVIDER_ID);
        Map<String, Object> passthrough = (Map<String, Object>) generic.get("_passthrough");
        Map<String, Object> body = (Map<String, Object>) passthrough.get("body");
        List<Map<String, Object>> messages = (List<Map<String, Object>>) body.get("messages");
        assertEquals(1, messages.size(), "messages must be a 1-element list");
        return messages.get(0);
    }

    @SuppressWarnings("unchecked")
    @Test
    void build_withIdentifier_pinsIntegrationViaSmsKey() {
        Map<String, Object> overrides = OzekiOverridesBuilder.build("ozeki-sms", TXN, PHONE, TEXT);

        assertTrue(overrides.containsKey("sms"), "sms key must pin the integration");
        Map<String, Object> sms = (Map<String, Object>) overrides.get("sms");
        assertEquals("ozeki-sms", sms.get("integrationIdentifier"));
    }

    @Test
    void build_withNullOrBlankIdentifier_omitsSmsKeyEntirely() {
        assertFalse(OzekiOverridesBuilder.build(null, TXN, PHONE, TEXT).containsKey("sms"),
                "null identifier must omit the sms key");
        assertFalse(OzekiOverridesBuilder.build("", TXN, PHONE, TEXT).containsKey("sms"),
                "empty identifier must omit the sms key");
        assertFalse(OzekiOverridesBuilder.build("   ", TXN, PHONE, TEXT).containsKey("sms"),
                "blank identifier must omit the sms key");
    }

    @SuppressWarnings("unchecked")
    @Test
    void build_providersKeyIsGenericSms_neverOzeki() {
        Map<String, Object> overrides = OzekiOverridesBuilder.build("ozeki-sms", TXN, PHONE, TEXT);

        Map<String, Object> providers = (Map<String, Object>) overrides.get("providers");
        assertEquals("generic-sms", OzekiOverridesBuilder.NOVU_PROVIDER_ID);
        assertEquals(Set.of(OzekiOverridesBuilder.NOVU_PROVIDER_ID), providers.keySet(),
                "providers must be keyed by the Novu provider id only");
        assertFalse(providers.containsKey("ozeki"),
                "an 'ozeki' key would be silently ignored by Novu's combineOverrides");
    }

    @Test
    void build_passthroughMessage_hasExactlyMessageIdToAddressText() {
        Map<String, Object> overrides = OzekiOverridesBuilder.build("ozeki-sms", TXN, PHONE, TEXT);

        Map<String, Object> message = messageAt(overrides);
        assertEquals(Set.of("message_id", "to_address", "text"), message.keySet(),
                "message must carry exactly Ozeki's snake_case fields");
        assertEquals(TXN, message.get("message_id"));
        assertEquals(PHONE, message.get("to_address"));
        assertEquals(TEXT, message.get("text"));
    }
}
