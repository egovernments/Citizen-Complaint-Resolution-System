package org.egov.novubridge.service.account;

import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.service.NovuClient;
import org.egov.novubridge.service.policy.ChannelPolicyClient;
import org.egov.novubridge.service.provider.ProviderCatalog;
import org.egov.novubridge.util.Values;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Which provider would carry a channel for a tenant, in its own Novu account: the status the
 * admin API reports per channel, and the "no provider for the channel" answer of
 * {@code messages/_send}.
 *
 * <p>A channel row that pins a provider ({@code NOTIFICATIONS.Channel.provider}) is honoured
 * exactly: the pinned integration must exist in the account, be active and carry the channel.
 * Without a pin, the active integrations that carry the DIGIT channel are candidates, Novu's own
 * built-in ones ({@code novu}: in-app, demo email) excluded, and so are DIGIT's worker providers
 * when the worker does not load them; the primary candidate wins, else the first. The answer
 * always names ONE integration so a send can pin it: Novu's own default on the {@code sms}
 * channel could be a Twilio WhatsApp sender.
 */
@Component
public class ChannelReadiness {

    public static final List<String> CHANNELS = List.of("SMS", "WHATSAPP", "EMAIL");
    private static final String NOVU_BUILT_IN = "novu";

    private final NovuClient novuClient;
    private final ChannelPolicyClient channelPolicy;
    private final NovuBridgeConfiguration config;

    public ChannelReadiness(NovuClient novuClient, ChannelPolicyClient channelPolicy, NovuBridgeConfiguration config) {
        this.novuClient = novuClient;
        this.channelPolicy = channelPolicy;
        this.config = config;
    }

    /** @param identifier the integration to pin a send to; null when not ready */
    public record Readiness(String channel, boolean ready, String identifier, String providerId, String type,
                            boolean pinned, String reason) {

        public Map<String, Object> toMap() {
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("ready", ready);
            out.put("pinned", pinned);
            if (identifier != null) out.put("provider", identifier);
            if (providerId != null) out.put("providerId", providerId);
            if (type != null) out.put("type", type);
            if (reason != null) out.put("reason", reason);
            return out;
        }
    }

    /** One channel. Throws {@code NB_NOVU_UNAVAILABLE} when the account's integrations cannot be listed. */
    public Readiness evaluate(NovuAccount account, String tenantId, String channel) {
        return evaluate(tenantId, channel, integrations(account));
    }

    /** Every channel, from one integration list. */
    public Map<String, Readiness> evaluateAll(NovuAccount account, String tenantId) {
        List<Map<String, Object>> integrations = integrations(account);
        Map<String, Readiness> out = new LinkedHashMap<>();
        for (String channel : CHANNELS) {
            out.put(channel, evaluate(tenantId, channel, integrations));
        }
        return out;
    }

    Readiness evaluate(String tenantId, String channel, List<Map<String, Object>> integrations) {
        String code = channel.trim().toUpperCase(Locale.ROOT);
        String pinned = channelPolicy.provider(tenantId, code);
        if (StringUtils.hasText(pinned)) {
            Map<String, Object> match = null;
            for (Map<String, Object> integration : integrations) {
                if (pinned.equalsIgnoreCase(Values.str(integration.get("identifier")))
                        || pinned.equalsIgnoreCase(Values.str(integration.get("_id")))) {
                    match = integration;
                    break;
                }
            }
            if (match == null) {
                return notReady(code, true, "the provider selected for " + code + " (" + pinned
                        + ") does not exist in this tenant's notification account");
            }
            if (!Boolean.TRUE.equals(match.get("active"))) {
                return notReady(code, true, "the provider selected for " + code + " (" + pinned + ") is disabled");
            }
            if (!code.equals(ProviderCatalog.digitChannelOf(match))) {
                return notReady(code, true, "the provider selected for " + code + " (" + pinned + ") does not carry "
                        + code);
            }
            if (!deliverable(match)) {
                return notReady(code, true, "the provider selected for " + code + " (" + pinned + ") cannot send here: "
                        + ProviderCatalog.unavailableMessage(Values.str(match.get("providerId"))));
            }
            return ready(code, match, true);
        }
        List<Map<String, Object>> candidates = new ArrayList<>();
        for (Map<String, Object> integration : integrations) {
            if (Boolean.TRUE.equals(integration.get("active")) && deliverable(integration)
                    && code.equals(ProviderCatalog.digitChannelOf(integration))) {
                candidates.add(integration);
            }
        }
        if (candidates.isEmpty()) {
            return notReady(code, false, "no active " + code + " provider is configured in this tenant's notification account");
        }
        for (Map<String, Object> candidate : candidates) {
            if (Boolean.TRUE.equals(candidate.get("primary"))) {
                return ready(code, candidate, false);
            }
        }
        return ready(code, candidates.get(0), false);
    }

    private boolean deliverable(Map<String, Object> integration) {
        String providerId = Values.lower(Values.str(integration.get("providerId")));
        if (providerId == null || NOVU_BUILT_IN.equals(providerId)) {
            return false;
        }
        return config.isDigitWorkerProvidersEnabled() || !ProviderCatalog.isWorkerProvider(providerId);
    }

    private List<Map<String, Object>> integrations(NovuAccount account) {
        NovuClient.NovuResponse response;
        try {
            response = account == null ? novuClient.listIntegrations() : novuClient.listIntegrations(account);
        } catch (RuntimeException e) {
            throw new AccountException(HttpStatus.SERVICE_UNAVAILABLE, "NB_NOVU_UNAVAILABLE",
                    "The notification service could not list " + NovuAccount.label(account) + " providers: " + e.getMessage(), e);
        }
        List<Object> data = Values.asList(response == null || response.getResponse() == null
                ? null : response.getResponse().get("data"));
        if (data == null) {
            throw new AccountException(HttpStatus.SERVICE_UNAVAILABLE, "NB_NOVU_UNAVAILABLE",
                    "The notification service listed " + NovuAccount.label(account) + " providers without a data list");
        }
        List<Map<String, Object>> out = new ArrayList<>();
        for (Object item : data) {
            Map<String, Object> row = Values.asMap(item);
            if (row != null) {
                out.add(row);
            }
        }
        return out;
    }

    private static Readiness ready(String channel, Map<String, Object> integration, boolean pinned) {
        String identifier = Values.str(integration.get("identifier"));
        return new Readiness(channel, true, StringUtils.hasText(identifier) ? identifier : Values.str(integration.get("_id")),
                Values.str(integration.get("providerId")), ProviderCatalog.deriveType(integration), pinned, null);
    }

    private static Readiness notReady(String channel, boolean pinned, String reason) {
        return new Readiness(channel, false, null, null, null, pinned, reason);
    }
}
