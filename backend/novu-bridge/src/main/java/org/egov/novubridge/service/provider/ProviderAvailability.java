package org.egov.novubridge.service.provider;

import lombok.extern.slf4j.Slf4j;
import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.service.NovuClient;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Is the provider a tenant pinned on a channel actually usable right now?
 *
 * <p>Novu accepts a trigger that names an integration it cannot deliver through — a deleted
 * integration, a disabled one, one belonging to another channel — and only fails the step
 * internally ({@code SUBSCRIBER_NO_ACTIVE_INTEGRATION}). The dispatch row would say
 * {@code SENT} for a message that never left the building. This class is what lets the
 * pipeline refuse first and record an honest {@code SKIPPED / NB_PROVIDER_UNAVAILABLE}.
 *
 * <p><b>Fail open.</b> When Novu's integration list cannot be read, delivery is NOT blocked:
 * the answer is {@link Status#UNKNOWN} and the trigger goes out exactly as before, the same
 * way the consent gate allows on a preference-service outage. A gate that cannot see must not
 * become an outage of its own. A failed read is remembered for one TTL so a Novu outage cannot
 * turn every event into an extra doomed HTTP call on the Kafka listener thread.
 *
 * <p><b>Cache.</b> One process-wide snapshot of {@code GET /v1/integrations}, TTL
 * {@code novu.bridge.provider.availability.cache.ttl.ms} (default 60s, same shape as the
 * channel-policy cache). The bridge's own create/_update/_delete call {@link #invalidate()},
 * so an operator's change in the configurator takes effect on the next event rather than up to
 * a minute later; the TTL only bounds changes made straight in Novu.
 */
@Slf4j
@Component
public class ProviderAvailability {

    public enum Status {
        /** The integration exists, is active, and carries this event's Novu channel. */
        AVAILABLE,
        /** No integration with that identifier (or id) exists in Novu. */
        MISSING,
        /** It exists but is switched off; Novu would never select it. */
        INACTIVE,
        /** It exists and is active, but on a different Novu channel than this event needs. */
        CHANNEL_MISMATCH,
        /** Novu could not be asked. Delivery proceeds — never blocked on our own blindness. */
        UNKNOWN
    }

    /** The verdict plus the sentence that goes in the dispatch row's error message. */
    public static final class Result {
        private final Status status;
        private final String message;

        Result(Status status, String message) {
            this.status = status;
            this.message = message;
        }

        public Status getStatus() {
            return status;
        }

        public String getMessage() {
            return message;
        }

        /** True unless we positively know the trigger would go nowhere. */
        public boolean usable() {
            return status == Status.AVAILABLE || status == Status.UNKNOWN;
        }
    }

    /** What the gate needs to know about one Novu integration. */
    private static final class Integration {
        final String identifier;
        final boolean active;
        final String novuChannel;

        Integration(String identifier, boolean active, String novuChannel) {
            this.identifier = identifier;
            this.active = active;
            this.novuChannel = novuChannel;
        }
    }

    private static final class Snapshot {
        final Map<String, Integration> byKey;
        final long fetchedAt = System.currentTimeMillis();

        Snapshot(Map<String, Integration> byKey) {
            this.byKey = byKey;
        }
    }

    private final NovuClient novuClient;
    private final NovuBridgeConfiguration config;

    private volatile Snapshot snapshot;
    /** Epoch millis of the last failed list call; 0 = none since the last success/invalidate. */
    private volatile long lastFailureAt;

    public ProviderAvailability(NovuClient novuClient, NovuBridgeConfiguration config) {
        this.novuClient = novuClient;
        this.config = config;
    }

    /**
     * Check the integration a channel row pinned against Novu's own view of it.
     *
     * @param identifier the Novu integration identifier (or {@code _id}) from
     *                   {@code NotificationChannel.provider}; blank = nothing pinned, which is
     *                   always {@link Status#AVAILABLE} (the pre-catalog path is untouched)
     * @param channel    the event channel — {@code SMS}, {@code WHATSAPP} or {@code EMAIL}
     */
    public Result check(String identifier, String channel) {
        if (!StringUtils.hasText(identifier)) {
            return new Result(Status.AVAILABLE, null);
        }
        Snapshot current = snapshotForCheck();
        if (current == null) {
            return new Result(Status.UNKNOWN,
                    "Novu integrations could not be listed; delivering without checking " + identifier);
        }
        Integration integration = current.byKey.get(key(identifier));
        if (integration == null) {
            return new Result(Status.MISSING, "Provider " + identifier.trim()
                    + " is selected for " + channel + " but is missing: no such integration in Novu."
                    + " Nothing was sent. Select a configured provider for this channel.");
        }
        if (!integration.active) {
            return new Result(Status.INACTIVE, "Provider " + identifier.trim()
                    + " is selected for " + channel + " but is disabled in Novu."
                    + " Nothing was sent. Re-enable it or select another provider.");
        }
        String wanted = novuChannel(channel);
        // WhatsApp rides Novu's `sms` channel, so SMS and WHATSAPP share a expected value here
        // and a Twilio WhatsApp integration is NOT a mismatch for an SMS event as far as Novu's
        // channel field goes — only an email/sms cross-up is.
        if (wanted != null && StringUtils.hasText(integration.novuChannel)
                && !wanted.equals(integration.novuChannel)) {
            return new Result(Status.CHANNEL_MISMATCH, "Provider " + identifier.trim()
                    + " is a Novu '" + integration.novuChannel + "' integration, but " + channel
                    + " delivers on Novu's '" + wanted + "' channel. Nothing was sent.");
        }
        return new Result(Status.AVAILABLE, null);
    }

    /**
     * Drop the cached view of Novu's integrations. Called after this service creates, updates
     * or deletes one, so the next dispatch sees the operator's change immediately.
     */
    public void invalidate() {
        snapshot = null;
        lastFailureAt = 0L;
    }

    // ---- internals -------------------------------------------------------

    /** The fresh snapshot, refreshing it if needed; {@code null} means "could not ask Novu". */
    private Snapshot snapshotForCheck() {
        long ttl = config.getProviderAvailabilityCacheTtlMs() != null
                ? config.getProviderAvailabilityCacheTtlMs() : 60_000L;
        long now = System.currentTimeMillis();
        Snapshot current = snapshot;
        if (current != null && now - current.fetchedAt < ttl) {
            return current;
        }
        // Negative cache: one failing list call per TTL, not one per event. Every call here
        // runs on the Kafka listener thread.
        if (lastFailureAt > 0 && now - lastFailureAt < ttl) {
            return null;
        }
        try {
            Snapshot fetched = new Snapshot(fetch());
            snapshot = fetched;
            lastFailureAt = 0L;
            return fetched;
        } catch (Exception e) {
            lastFailureAt = now;
            // Deliberately NOT serving the stale snapshot: stale data could refuse a provider
            // that now exists. Blind means "let it through", never "block".
            log.warn("Provider availability: listing Novu integrations failed ({}); "
                    + "delivering without the check for the next {}ms", e.getMessage(), ttl);
            return null;
        }
    }

    @SuppressWarnings("unchecked")
    private Map<String, Integration> fetch() {
        NovuClient.NovuResponse response = novuClient.listIntegrations();
        Map<String, Object> body = response == null ? null : response.getResponse();
        Object data = body == null ? null : body.get("data");
        Map<String, Integration> out = new LinkedHashMap<>();
        if (!(data instanceof List)) {
            // An answer we cannot read is not evidence that a provider is gone.
            throw new IllegalStateException("Novu integrations response carried no data list");
        }
        for (Object item : (List<Object>) data) {
            if (!(item instanceof Map)) {
                continue;
            }
            Map<String, Object> row = (Map<String, Object>) item;
            String identifier = text(row.get("identifier"));
            String id = text(row.get("_id"));
            Integration integration = new Integration(
                    identifier,
                    Boolean.TRUE.equals(row.get("active")),
                    lower(text(row.get("channel"))));
            // Indexed under both keys: a channel row may name either, exactly as the
            // management endpoints resolve an integration by either.
            if (StringUtils.hasText(identifier)) {
                out.put(key(identifier), integration);
            }
            if (StringUtils.hasText(id)) {
                out.putIfAbsent(key(id), integration);
            }
        }
        return out;
    }

    /** SMS and WHATSAPP deliver on Novu's {@code sms} channel; EMAIL on {@code email}. */
    private static String novuChannel(String channel) {
        if (!StringUtils.hasText(channel)) {
            return null;
        }
        switch (channel.trim().toUpperCase(Locale.ROOT)) {
            case "SMS":
            case "WHATSAPP":
                return "sms";
            case "EMAIL":
                return "email";
            default:
                return null;
        }
    }

    private static String key(String value) {
        return value.trim().toLowerCase(Locale.ROOT);
    }

    private static String text(Object value) {
        return value == null ? null : value.toString();
    }

    private static String lower(String value) {
        return value == null ? null : value.trim().toLowerCase(Locale.ROOT);
    }
}
