package org.egov.novubridge.service.provider;

import lombok.extern.slf4j.Slf4j;
import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.service.NovuClient;
import org.egov.novubridge.util.Values;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Is the provider a tenant pinned on a channel actually usable? Novu accepts a trigger naming a
 * deleted, disabled or wrong-channel integration and only fails the step internally, so the row
 * would read SENT for a message that never left.
 *
 * <p>Fails OPEN: when Novu's integration list cannot be read the answer is {@link Status#UNKNOWN}
 * and delivery proceeds, like the consent gate on an outage. A failed read is remembered for one
 * TTL so an outage costs one doomed call per TTL, not one per event on the listener thread. The
 * bridge's own provider create/_update/_delete call {@link #invalidate()}.
 */
@Slf4j
@Component
public class ProviderAvailability {

    public enum Status { AVAILABLE, MISSING, INACTIVE, CHANNEL_MISMATCH, UNKNOWN }

    /** The verdict plus the sentence that goes in the dispatch row's error message. */
    public record Result(Status status, String message) {
        /** True unless we positively know the trigger would go nowhere. */
        public boolean usable() {
            return status == Status.AVAILABLE || status == Status.UNKNOWN;
        }
    }

    private record Integration(boolean active, String novuChannel) {
    }

    private record Snapshot(Map<String, Integration> byKey, long fetchedAt) {
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
     * @param identifier Novu integration identifier (or {@code _id}) from the channel row; blank =
     *                   nothing pinned, always AVAILABLE
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
        Integration integration = current.byKey().get(key(identifier));
        if (integration == null) {
            return new Result(Status.MISSING, "Provider " + identifier.trim()
                    + " is selected for " + channel + " but is missing: no such integration in Novu."
                    + " Nothing was sent. Select a configured provider for this channel.");
        }
        if (!integration.active()) {
            return new Result(Status.INACTIVE, "Provider " + identifier.trim()
                    + " is selected for " + channel + " but is disabled in Novu."
                    + " Nothing was sent. Re-enable it or select another provider.");
        }
        String wanted = Values.novuChannel(channel);
        if (wanted != null && StringUtils.hasText(integration.novuChannel())
                && !wanted.equals(integration.novuChannel())) {
            return new Result(Status.CHANNEL_MISMATCH, "Provider " + identifier.trim()
                    + " is a Novu '" + integration.novuChannel() + "' integration, but " + channel
                    + " delivers on Novu's '" + wanted + "' channel. Nothing was sent.");
        }
        return new Result(Status.AVAILABLE, null);
    }

    public void invalidate() {
        snapshot = null;
        lastFailureAt = 0L;
    }

    /** The fresh snapshot, refreshing it if needed; {@code null} means "could not ask Novu". */
    private Snapshot snapshotForCheck() {
        long ttl = config.getProviderAvailabilityCacheTtlMs() != null
                ? config.getProviderAvailabilityCacheTtlMs() : 60_000L;
        long now = System.currentTimeMillis();
        Snapshot current = snapshot;
        if (current != null && now - current.fetchedAt() < ttl) {
            return current;
        }
        if (lastFailureAt > 0 && now - lastFailureAt < ttl) {
            return null;
        }
        try {
            Snapshot fetched = new Snapshot(fetch(), System.currentTimeMillis());
            snapshot = fetched;
            lastFailureAt = 0L;
            return fetched;
        } catch (Exception e) {
            lastFailureAt = now;
            // Never serve the stale snapshot: it could refuse a provider that now exists.
            log.warn("Provider availability: listing Novu integrations failed ({}); "
                    + "delivering without the check for the next {}ms", e.getMessage(), ttl);
            return null;
        }
    }

    private Map<String, Integration> fetch() {
        NovuClient.NovuResponse response = novuClient.listIntegrations();
        Map<String, Object> body = response == null ? null : response.getResponse();
        List<Object> data = Values.asList(body == null ? null : body.get("data"));
        if (data == null) {
            // An answer we cannot read is not evidence that a provider is gone.
            throw new IllegalStateException("Novu integrations response carried no data list");
        }
        Map<String, Integration> out = new LinkedHashMap<>();
        for (Object item : data) {
            Map<String, Object> row = Values.asMap(item);
            if (row == null) {
                continue;
            }
            String identifier = Values.str(row.get("identifier"));
            String id = Values.str(row.get("_id"));
            Integration integration = new Integration(Boolean.TRUE.equals(row.get("active")),
                    Values.lower(Values.str(row.get("channel"))));
            // Indexed under both: a channel row may name either.
            if (StringUtils.hasText(identifier)) {
                out.put(key(identifier), integration);
            }
            if (StringUtils.hasText(id)) {
                out.putIfAbsent(key(id), integration);
            }
        }
        return out;
    }

    private static String key(String value) {
        return value.trim().toLowerCase(Locale.ROOT);
    }
}
