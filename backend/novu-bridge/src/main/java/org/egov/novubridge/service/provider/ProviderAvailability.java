package org.egov.novubridge.service.provider;

import lombok.extern.slf4j.Slf4j;
import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.service.NovuClient;
import org.egov.novubridge.util.Values;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import java.util.ArrayList;
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
 *
 * <p>With {@code novu.bridge.digit.worker.providers=false} an SMSCountry, Ozeki or Jasmin
 * integration is {@link Status#WORKER_PROVIDER_MISSING}: the worker has no handler for it. That holds
 * for a pinned one ({@link #check}) and for the one Novu would pick for a channel nothing pins
 * ({@link #checkUnpinned}).
 */
@Slf4j
@Component
public class ProviderAvailability {

    public enum Status { AVAILABLE, MISSING, INACTIVE, CHANNEL_MISMATCH, WORKER_PROVIDER_MISSING, UNKNOWN }

    /**
     * The verdict, the sentence that goes in the dispatch row's error message, and the
     * integration's {@code identifier} to trigger with: a channel row may name the Novu
     * {@code _id}, but Novu's override only understands the identifier (given one it does not
     * know, it silently uses the PRIMARY integration). As given when it cannot be resolved.
     */
    public record Result(Status status, String message, String identifier) {
        /** True unless we positively know the trigger would go nowhere. */
        public boolean usable() {
            return status == Status.AVAILABLE || status == Status.UNKNOWN;
        }
    }

    private record Integration(boolean active, boolean primary, String novuChannel, String identifier,
                               String providerId) {
    }

    private record Snapshot(Map<String, Integration> byKey, List<Integration> all, long fetchedAt) {
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
            return new Result(Status.AVAILABLE, null, identifier);
        }
        Snapshot current = snapshotForCheck();
        if (current == null) {
            return new Result(Status.UNKNOWN,
                    "Novu integrations could not be listed; delivering without checking " + identifier, identifier);
        }
        Integration integration = current.byKey().get(key(identifier));
        if (integration == null) {
            return new Result(Status.MISSING, "Provider " + identifier.trim()
                    + " is selected for " + channel + " but is missing: no such integration in Novu."
                    + " Nothing was sent. Select a configured provider for this channel.", identifier);
        }
        if (!integration.active()) {
            return new Result(Status.INACTIVE, "Provider " + identifier.trim()
                    + " is selected for " + channel + " but is disabled in Novu."
                    + " Nothing was sent. Re-enable it or select another provider.", identifier);
        }
        String wanted = Values.novuChannel(channel);
        if (wanted != null && StringUtils.hasText(integration.novuChannel())
                && !wanted.equals(integration.novuChannel())) {
            return new Result(Status.CHANNEL_MISMATCH, "Provider " + identifier.trim()
                    + " is a Novu '" + integration.novuChannel() + "' integration, but " + channel
                    + " delivers on Novu's '" + wanted + "' channel. Nothing was sent.", identifier);
        }
        if (!config.isDigitWorkerProvidersEnabled() && ProviderCatalog.isWorkerProvider(integration.providerId())) {
            return new Result(Status.WORKER_PROVIDER_MISSING, "Provider " + identifier.trim()
                    + " is selected for " + channel + ", but "
                    + ProviderCatalog.unavailableMessage(integration.providerId().trim()) + " Nothing was sent.",
                    identifier);
        }
        return new Result(Status.AVAILABLE, null,
                StringUtils.hasText(integration.identifier()) ? integration.identifier() : identifier.trim());
    }

    /**
     * A channel that pins no provider and goes through Novu, on a deployment whose worker does not
     * load DIGIT's providers ({@code novu.bridge.digit.worker.providers=false}): Novu triggers it
     * through the integration {@code NOVU_BRIDGE_INTEGRATION_ID_WHATSAPP} names (WhatsApp), else
     * through its PRIMARY active integration on the channel. If that is an SMSCountry, Ozeki or Jasmin
     * one (a leftover from before the flag was turned off), the worker has no handler and the row
     * would read SENT for a message that never left: {@link Status#WORKER_PROVIDER_MISSING}. With no
     * primary flagged, only when EVERY active integration on the channel is one of them.
     *
     * <p>Always AVAILABLE with the flag on, so the stock deployment never calls Novu here. Uses the
     * same cached snapshot as {@link #check}, so the cost is one Novu list per TTL, not per event.
     *
     * <p>Fails OPEN when Novu cannot be listed ({@link Status#UNKNOWN}, like {@link #check}): an
     * unpinned channel carries login OTPs (CORE_SMS) and every legacy row, and refusing them all on a
     * blip of Novu's list endpoint would turn a monitoring gap into a deployment-wide outage of
     * notifications Novu would most likely deliver; the trigger itself still reports a Novu outage.
     *
     * @return the verdict; its {@code identifier} is always null (nothing new is pinned)
     */
    public Result checkUnpinned(String channel) {
        if (config.isDigitWorkerProvidersEnabled()) {
            return new Result(Status.AVAILABLE, null, null);
        }
        String envPin = "WHATSAPP".equalsIgnoreCase(channel) && StringUtils.hasText(config.getWhatsappIntegrationId())
                ? config.getWhatsappIntegrationId().trim() : null;
        Snapshot current = snapshotForCheck();
        if (current == null) {
            return new Result(Status.UNKNOWN,
                    "Novu integrations could not be listed; delivering " + channel + " without checking", null);
        }
        if (envPin != null) {
            Integration pinned = current.byKey().get(key(envPin));
            if (pinned != null && ProviderCatalog.isWorkerProvider(pinned.providerId())) {
                return workerProviderMissing(channel, "NOVU_BRIDGE_INTEGRATION_ID_WHATSAPP names " + envPin, pinned);
            }
            return new Result(Status.AVAILABLE, null, null);
        }
        String wanted = Values.novuChannel(channel);
        if (wanted == null) {
            return new Result(Status.AVAILABLE, null, null);
        }
        Integration primary = null;
        boolean anyActive = false;
        boolean allWorker = true;
        for (Integration integration : current.all()) {
            if (!integration.active() || !wanted.equals(integration.novuChannel())) {
                continue;
            }
            anyActive = true;
            allWorker &= ProviderCatalog.isWorkerProvider(integration.providerId());
            if (integration.primary() && primary == null) {
                primary = integration;
            }
        }
        if (primary != null) {
            return ProviderCatalog.isWorkerProvider(primary.providerId())
                    ? workerProviderMissing(channel, "Novu's primary '" + wanted + "' integration is "
                            + label(primary), primary)
                    : new Result(Status.AVAILABLE, null, null);
        }
        if (anyActive && allWorker) {
            return workerProviderMissing(channel, "every active Novu '" + wanted + "' integration is one of "
                    + "DIGIT's worker providers", null);
        }
        return new Result(Status.AVAILABLE, null, null);
    }

    private static Result workerProviderMissing(String channel, String why, Integration integration) {
        String providerId = integration != null && StringUtils.hasText(integration.providerId())
                ? integration.providerId().trim() : "smscountry/ozeki/jasmin";
        return new Result(Status.WORKER_PROVIDER_MISSING, channel + " has no provider selected, so Novu sends it "
                + "through its default, and " + why + ": " + ProviderCatalog.unavailableMessage(providerId)
                + " Nothing was sent. Select a non-DIGIT provider on the channel (or make one primary in Novu).",
                null);
    }

    private static String label(Integration integration) {
        return StringUtils.hasText(integration.identifier()) ? integration.identifier() : integration.providerId();
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
            List<Integration> all = new ArrayList<>();
            Snapshot fetched = new Snapshot(fetch(all), all, System.currentTimeMillis());
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

    private Map<String, Integration> fetch(List<Integration> all) {
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
                    Boolean.TRUE.equals(row.get("primary")),
                    Values.lower(Values.str(row.get("channel"))), identifier == null ? null : identifier.trim(),
                    Values.str(row.get("providerId")));
            all.add(integration);
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
