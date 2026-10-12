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
 * bridge's own provider create/_update/_delete call {@link #invalidate()}; test-send asks
 * {@link #checkFresh} / {@link #checkUnpinnedFresh}, which re-read Novu but keep that failure
 * memory.
 *
 * <p>Only the API key's own Novu environment counts: {@code GET /v1/integrations} lists every
 * environment of the organization (Development and Production), and a trigger only ever uses the
 * key's. Integrations of another environment are dropped once {@code GET /v1/environments/me}
 * has named the key's; until it has (an older Novu, or that call failing), all are kept, as before.
 *
 * <p>With {@code novu.bridge.digit.worker.providers=false} an SMSCountry, Ozeki or Jasmin
 * integration is {@link Status#WORKER_PROVIDER_MISSING}: the worker has no handler for it. That holds
 * for a pinned one ({@link #check}) and for the one Novu would pick for a channel nothing pins
 * ({@link #checkUnpinned}). A channel nothing pins also needs Novu to hold an active integration
 * that delivers it at all ({@link Status#NO_ACTIVE_INTEGRATION}), whatever the flag.
 */
@Slf4j
@Component
public class ProviderAvailability {

    public enum Status {
        AVAILABLE, MISSING, INACTIVE, CHANNEL_MISMATCH, WORKER_PROVIDER_MISSING,
        /** Nothing pinned and Novu holds no active integration that delivers the channel. */
        NO_ACTIVE_INTEGRATION,
        UNKNOWN
    }

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
    /** The API key's Novu environment ({@code _id}), once Novu has named it; it never changes for a key. */
    private volatile String environmentId;

    public ProviderAvailability(NovuClient novuClient, NovuBridgeConfiguration config) {
        this.novuClient = novuClient;
        this.config = config;
    }

    /**
     * @param identifier Novu integration identifier (or {@code _id}) from the channel row; blank =
     *                   nothing pinned, always AVAILABLE
     */
    public Result check(String identifier, String channel) {
        return check(identifier, channel, false);
    }

    /**
     * {@link #check} on a fresh read of Novu's integrations, for test-send: an operator who just
     * changed a provider in Novu's own dashboard tests that, not what Novu looked like up to a TTL
     * ago (the fresh read then serves dispatch too). It does NOT clear the failure memory: within a
     * TTL of a failed list call Novu is not asked again, and the answer is {@link Status#UNKNOWN},
     * so repeated Tests during a Novu outage cost no Novu call and do not reset dispatch's back-off.
     */
    public Result checkFresh(String identifier, String channel) {
        return check(identifier, channel, true);
    }

    private Result check(String identifier, String channel, boolean fresh) {
        if (!StringUtils.hasText(identifier)) {
            return new Result(Status.AVAILABLE, null, identifier);
        }
        Snapshot current = fresh ? freshSnapshot() : snapshotForCheck();
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
        // SMS and WhatsApp share Novu's 'sms' channel, so Novu's channel alone passes a Twilio SMS
        // integration pinned on WhatsApp (or the reverse). Its catalog type says what it delivers;
        // one the bridge cannot identify is not refused (as for checkUnpinned).
        String delivers = ProviderCatalog.knownDigitChannel(integration.identifier(), integration.providerId());
        if (wanted != null && delivers != null && !delivers.equalsIgnoreCase(channel.trim())) {
            return new Result(Status.CHANNEL_MISMATCH, "Provider " + identifier.trim()
                    + " delivers " + delivers + ", not " + channel.trim().toUpperCase(Locale.ROOT)
                    + " (both go through Novu's '" + wanted + "' channel). Nothing was sent."
                    + " Select a " + channel.trim().toUpperCase(Locale.ROOT) + " provider for this channel.", identifier);
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
     * A channel that pins no provider and goes through Novu. Novu triggers it through the
     * integration {@code NOVU_BRIDGE_INTEGRATION_ID_WHATSAPP} names (WhatsApp), else through its
     * PRIMARY active integration on the channel, and when it has NO active integration for the
     * channel it accepts the trigger anyway and fails the job ("Subscriber does not have an active
     * integration"), so the row would read SENT for a message that never left. Two checks:
     *
     * <ul>
     *   <li><b>Always</b>: Novu must hold at least one ACTIVE integration on the channel's Novu
     *       channel that is not positively known to deliver ANOTHER DIGIT channel (a Twilio
     *       WhatsApp integration does not send SMS, nor an SMS-only one WhatsApp:
     *       {@link ProviderCatalog#knownDigitChannel}). None is {@link Status#NO_ACTIVE_INTEGRATION}.
     *       An integration the bridge cannot identify counts, so this never refuses a hand-made
     *       one that might deliver.</li>
     *   <li>With {@code novu.bridge.digit.worker.providers=false} only: if the integration Novu
     *       would pick is an SMSCountry, Ozeki or Jasmin one (a leftover from before the flag was
     *       turned off), the worker has no handler: {@link Status#WORKER_PROVIDER_MISSING}. With no
     *       primary flagged, only when EVERY active integration on the channel is one of them.</li>
     * </ul>
     *
     * <p>An env pin Novu cannot use (no such integration, inactive, or on another Novu channel) is
     * judged like no pin: Novu falls back to its default for the channel.
     *
     * <p>Uses the same cached snapshot as {@link #check}, so the cost is one Novu list per TTL, not
     * per event, whatever the flag.
     *
     * <p>Fails OPEN when Novu cannot be listed ({@link Status#UNKNOWN}, like {@link #check}): an
     * unpinned channel carries login OTPs (CORE_SMS) and every legacy row, and refusing them all on a
     * blip of Novu's list endpoint would turn a monitoring gap into a deployment-wide outage of
     * notifications Novu would most likely deliver; the trigger itself still reports a Novu outage.
     *
     * @return the verdict; its {@code identifier} is always null (nothing new is pinned)
     */
    public Result checkUnpinned(String channel) {
        return checkUnpinned(channel, false);
    }

    /** {@link #checkUnpinned} on a fresh read, with {@link #checkFresh}'s failure back-off. */
    public Result checkUnpinnedFresh(String channel) {
        return checkUnpinned(channel, true);
    }

    private Result checkUnpinned(String channel, boolean fresh) {
        String wanted = Values.novuChannel(channel);
        if (wanted == null) {
            return new Result(Status.AVAILABLE, null, null);
        }
        Snapshot current = fresh ? freshSnapshot() : snapshotForCheck();
        if (current == null) {
            return new Result(Status.UNKNOWN,
                    "Novu integrations could not be listed; delivering " + channel + " without checking", null);
        }
        String envPin = "WHATSAPP".equalsIgnoreCase(channel) && StringUtils.hasText(config.getWhatsappIntegrationId())
                ? config.getWhatsappIntegrationId().trim() : null;
        if (envPin != null) {
            Integration pinned = current.byKey().get(key(envPin));
            if (pinned != null && pinned.active() && wanted.equals(pinned.novuChannel())) {
                if (!config.isDigitWorkerProvidersEnabled() && ProviderCatalog.isWorkerProvider(pinned.providerId())) {
                    return workerProviderMissing(channel, "NOVU_BRIDGE_INTEGRATION_ID_WHATSAPP names " + envPin, pinned);
                }
                return new Result(Status.AVAILABLE, null, null);
            }
            // Novu cannot use it, so it falls back to the channel's default: judged below.
        }
        Integration primary = null;
        boolean anyActive = false;
        boolean anyForChannel = false;
        boolean allWorker = true;
        for (Integration integration : current.all()) {
            if (!integration.active() || !wanted.equals(integration.novuChannel())) {
                continue;
            }
            anyActive = true;
            String delivers = ProviderCatalog.knownDigitChannel(integration.identifier(), integration.providerId());
            anyForChannel |= delivers == null || delivers.equalsIgnoreCase(channel);
            allWorker &= ProviderCatalog.isWorkerProvider(integration.providerId());
            if (integration.primary() && primary == null) {
                primary = integration;
            }
        }
        if (!anyForChannel) {
            return noActiveIntegration(channel, wanted, anyActive);
        }
        if (config.isDigitWorkerProvidersEnabled()) {
            return new Result(Status.AVAILABLE, null, null);
        }
        if (primary != null) {
            return ProviderCatalog.isWorkerProvider(primary.providerId())
                    ? workerProviderMissing(channel, "Novu's primary '" + wanted + "' integration is "
                            + label(primary), primary)
                    : new Result(Status.AVAILABLE, null, null);
        }
        if (allWorker) {
            return workerProviderMissing(channel, "every active Novu '" + wanted + "' integration is one of "
                    + "DIGIT's worker providers", null);
        }
        return new Result(Status.AVAILABLE, null, null);
    }

    private static Result noActiveIntegration(String channel, String novuChannel, boolean otherChannelsOnly) {
        return new Result(Status.NO_ACTIVE_INTEGRATION, channel + " has no provider selected, and Novu has no active "
                + "integration that delivers " + channel + (otherChannelsOnly
                        ? " (its active '" + novuChannel + "' integrations deliver another channel)"
                        : " on its '" + novuChannel + "' channel")
                + ", so Novu would fail every send (\"Subscriber does not have an active integration\")."
                + " Nothing was sent. Add a provider for " + channel + " on Notifications \u2192 Providers and select"
                + " it on the channel.", null);
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
        long ttl = ttl();
        long now = System.currentTimeMillis();
        Snapshot current = snapshot;
        if (current != null && now - current.fetchedAt() < ttl) {
            return current;
        }
        if (lastFailureAt > 0 && now - lastFailureAt < ttl) {
            return null;
        }
        return load(now);
    }

    /** A new read whatever the snapshot's age, unless a read failed within the TTL ({@code null}). */
    private Snapshot freshSnapshot() {
        long now = System.currentTimeMillis();
        if (lastFailureAt > 0 && now - lastFailureAt < ttl()) {
            return null;
        }
        return load(now);
    }

    private Snapshot load(long now) {
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
                    + "delivering without the check for the next {}ms", e.getMessage(), ttl());
            return null;
        }
    }

    private long ttl() {
        return config.getProviderAvailabilityCacheTtlMs() != null ? config.getProviderAvailabilityCacheTtlMs() : 60_000L;
    }

    private Map<String, Integration> fetch(List<Integration> all) {
        NovuClient.NovuResponse response = novuClient.listIntegrations();
        Map<String, Object> body = response == null ? null : response.getResponse();
        List<Object> data = Values.asList(body == null ? null : body.get("data"));
        if (data == null) {
            // An answer we cannot read is not evidence that a provider is gone.
            throw new IllegalStateException("Novu integrations response carried no data list");
        }
        String environment = environmentId();
        Map<String, Integration> out = new LinkedHashMap<>();
        for (Object item : data) {
            Map<String, Object> row = Values.asMap(item);
            if (row == null) {
                continue;
            }
            // Another environment's integration (Development's, on a Production key): a trigger
            // through this key never reaches it, and its identifier may shadow the key's own one.
            String rowEnvironment = Values.str(row.get("_environmentId"));
            if (environment != null && StringUtils.hasText(rowEnvironment) && !environment.equals(rowEnvironment.trim())) {
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

    /** The key's environment, asked once; null while Novu has not named it (then nothing is filtered). */
    private String environmentId() {
        String known = environmentId;
        if (known != null) {
            return known;
        }
        try {
            NovuClient.NovuResponse response = novuClient.currentEnvironment();
            Map<String, Object> body = response == null ? null : response.getResponse();
            Map<String, Object> environment = Values.asMap(body == null ? null : body.get("data"));
            String id = environment == null ? null : Values.str(environment.get("_id"));
            if (StringUtils.hasText(id)) {
                environmentId = id.trim();
                return environmentId;
            }
            log.warn("Provider availability: Novu did not name the API key's environment; integrations of every "
                    + "environment are considered");
        } catch (Exception e) {
            log.warn("Provider availability: the API key's Novu environment could not be read ({}); integrations "
                    + "of every environment are considered", e.getMessage());
        }
        return null;
    }

    private static String key(String value) {
        return value.trim().toLowerCase(Locale.ROOT);
    }
}
