package org.egov.identity.keycloak.ratelimit;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.util.HexFormat;
import org.egov.identity.keycloak.config.OtpSettings;

/**
 * Cluster-wide limits on OTP sends, kept in Keycloak's
 * {@code SingleUseObjectProvider} (the replicated action-token store).
 *
 * <p>The store only offers {@code putIfAbsent(key, lifespan)} atomically, so a
 * counter of N per hour is N slot keys for the current hour window: a send
 * claims the first free slot and is refused when all are taken. Every key
 * carries its own lifespan, so nothing outlives its window. Phone numbers and
 * IPs are hashed before they become keys.
 *
 * <p>Claims are taken IP, then phone budget, then cooldown, so a refused
 * request never spends a later budget: requests refused for their IP cannot
 * burn a victim's hourly budget or cooldown. A running cooldown is checked
 * first without claiming anything, so resending too soon spends nothing.
 */
public final class SendRateLimiter {

    private static final long WINDOW_SECONDS = 3600;

    public enum Decision { ALLOWED, RESEND_TOO_SOON, PHONE_LIMIT, IP_LIMIT }

    /** Atomic "claim this key for N seconds"; true when the key was free. */
    public interface SlotStore {
        boolean putIfAbsent(String key, long lifespanSeconds);

        /** Whether the key is currently claimed; claims nothing. */
        boolean contains(String key);
    }

    private final SlotStore store;
    private final OtpSettings settings;
    private final Clock clock;
    private final String namespace;

    /** @param namespace realm id, so realms sharing a cluster do not share budgets */
    public SendRateLimiter(SlotStore store, OtpSettings settings, Clock clock, String namespace) {
        this.store = store;
        this.settings = settings;
        this.clock = clock;
        this.namespace = namespace;
    }

    public Decision tryAcquire(String e164, String clientIp) {
        String phoneKey = digest(e164);
        long resend = settings.resendInterval().toSeconds();
        String cooldownKey = key("cooldown", phoneKey);
        if (resend > 0 && store.contains(cooldownKey)) {
            return Decision.RESEND_TOO_SOON;
        }
        long nowSeconds = clock.millis() / 1000;
        long window = nowSeconds / WINDOW_SECONDS;
        // +60s so a slot claimed at the end of a window cannot expire early on a skewed node
        long lifespan = (window + 1) * WINDOW_SECONDS - nowSeconds + 60;
        if (clientIp != null && !clientIp.isBlank()
                && !claim("ip:" + digest(clientIp) + ":" + window, settings.ipSendsPerHour(), lifespan)) {
            return Decision.IP_LIMIT;
        }
        if (!claim("phone:" + phoneKey + ":" + window, settings.phoneSendsPerHour(), lifespan)) {
            return Decision.PHONE_LIMIT;
        }
        // Only a concurrent send for the same phone can take the cooldown here.
        if (resend > 0 && !store.putIfAbsent(cooldownKey, resend)) {
            return Decision.RESEND_TOO_SOON;
        }
        return Decision.ALLOWED;
    }

    private boolean claim(String bucket, int limit, long lifespan) {
        for (int slot = 0; slot < limit; slot++) {
            if (store.putIfAbsent(key(bucket, Integer.toString(slot)), lifespan)) {
                return true;
            }
        }
        return false;
    }

    private String key(String bucket, String suffix) {
        return "digit-otp:" + namespace + ":" + bucket + ":" + suffix;
    }

    private static String digest(String value) {
        try {
            byte[] hash = MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(hash, 0, 16);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
