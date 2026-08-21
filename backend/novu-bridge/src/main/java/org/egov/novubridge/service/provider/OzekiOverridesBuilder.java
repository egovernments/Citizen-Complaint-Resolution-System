package org.egov.novubridge.service.provider;

import org.springframework.util.StringUtils;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Builds the Novu trigger {@code overrides} envelope that delivers an SMS
 * through an <a href="https://ozeki-sms-gateway.com/p_5667-http-sms-api.html">Ozeki
 * SMS Gateway</a> behind Novu's built-in {@code generic-sms} provider — no
 * forked Novu images, no shim service. Full design:
 * {@code docs/Novu_Adapter/OZEKI-GENERIC-SMS-PROVIDER.md}.
 *
 * <p>Shape constraints (verified against Novu v2.3.0 source):
 * <ul>
 *   <li>The provider-overrides key must be the Novu provider id
 *       {@code generic-sms} — the worker's {@code combineOverrides} looks up
 *       {@code overrides.providers[integration.providerId]}; a key like
 *       {@code ozeki} would be silently ignored.</li>
 *   <li>{@code _passthrough.body} is deep-merged into the outgoing JSON with
 *       highest priority and is exempt from the provider's key-casing
 *       transform, so Ozeki's snake_case {@code messages[]} fields survive
 *       verbatim.</li>
 *   <li>Overrides are sent raw — Novu never templates them — so {@code text}
 *       must be the final pre-rendered body, which the pass-through pipeline
 *       has at trigger time.</li>
 *   <li>{@code overrides.sms.integrationIdentifier} pins the (possibly
 *       non-primary) generic-sms integration, letting Ozeki coexist with e.g.
 *       a primary Twilio integration.</li>
 * </ul>
 */
public final class OzekiOverridesBuilder {

    /** Novu provider id backing the Ozeki integration — NOT "ozeki". */
    public static final String NOVU_PROVIDER_ID = "generic-sms";

    private OzekiOverridesBuilder() {
    }

    /**
     * @param integrationIdentifier identifier of the generic-sms Novu
     *                              integration pointing at the Ozeki gateway;
     *                              blank = omit (Novu falls back to the
     *                              primary SMS integration)
     * @param transactionId         echoed back by the gateway as
     *                              {@code message_id} — the correlation key
     *                              across nb_dispatch_log, the Novu activity
     *                              feed (via the integration's idPath) and the
     *                              Ozeki message store
     * @param toAddress             recipient in +E.164 (already formatted by
     *                              the dispatch pipeline)
     * @param text                  final localized message body
     */
    public static Map<String, Object> build(String integrationIdentifier, String transactionId,
                                            String toAddress, String text) {
        Map<String, Object> message = new LinkedHashMap<>();
        message.put("message_id", transactionId);
        message.put("to_address", toAddress);
        message.put("text", text);

        Map<String, Object> overrides = new LinkedHashMap<>();
        if (StringUtils.hasText(integrationIdentifier)) {
            overrides.put("sms", Map.of("integrationIdentifier", integrationIdentifier));
        }
        overrides.put("providers", Map.of(NOVU_PROVIDER_ID,
                Map.of("_passthrough",
                        Map.of("body",
                                Map.of("messages", List.of(message))))));
        return overrides;
    }
}
