package org.egov.identity.keycloak.otp;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Clock;
import java.util.Base64;
import java.util.HexFormat;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.egov.identity.keycloak.config.OtpSettings;

/**
 * One phone-OTP challenge, stored in the authentication session's notes.
 *
 * <p>The code itself is never stored: only HMAC-SHA256(salt, phone ":" code)
 * with a per-code random salt, so the notes (which live in the distributed
 * auth-session cache) do not leak a usable code. Comparison is constant time.
 * A code is bound to the phone it was sent to, expires after the configured
 * TTL, and is destroyed after the configured number of wrong entries or on
 * first successful use.
 *
 * <p>Auth-session notes are not an atomic store: parallel submissions (even
 * on different cluster nodes) each read their own copy. So the two limits
 * that matter are enforced in Keycloak's cluster-wide
 * {@code SingleUseObjectProvider} ({@link ClaimStore}), keyed by a random
 * per-code challenge id: every submission first claims one of
 * {@code maxAttempts} attempt slots ({@code <id>:attempt:<n>}) and is refused
 * when none is free, and a matching code is accepted only by the one
 * submission that claims {@code <id>:used}. The notes are just the display
 * state.
 */
public final class OtpChallenge {

    public static final String NOTE_PHONE = "digit.phone";
    public static final String NOTE_HASH = "digit.otp.hash";
    public static final String NOTE_SALT = "digit.otp.salt";
    public static final String NOTE_EXPIRES_AT = "digit.otp.expiresAt";
    public static final String NOTE_CHALLENGE_ID = "digit.otp.challengeId";
    public static final String NOTE_SENT_AT = "digit.otp.sentAt";
    public static final String NOTE_VERIFIED_PHONE = "digit.phone.verified";

    public enum Result { OK, INVALID, EXPIRED, TOO_MANY_ATTEMPTS, NO_CODE }

    /** Cluster-wide atomic "claim this key for N seconds"; true only for the first claimant. */
    public interface ClaimStore {
        boolean putIfAbsent(String key, long lifespanSeconds);
    }

    private static final String CLAIM_PREFIX = "digit-otp:challenge:";
    /** Claims outlive the code a little so a skewed node cannot see them expire early. */
    private static final long CLAIM_GRACE_SECONDS = 60;

    private final NoteStore notes;
    private final ClaimStore claims;
    private final OtpSettings settings;
    private final Clock clock;
    private final SecureRandom random;

    public OtpChallenge(NoteStore notes, ClaimStore claims, OtpSettings settings, Clock clock, SecureRandom random) {
        this.notes = notes;
        this.claims = claims;
        this.settings = settings;
        this.clock = clock;
        this.random = random;
    }

    /** Creates a fresh code for {@code e164}, replacing any earlier one, and returns it for sending. */
    public String issue(String e164) {
        StringBuilder code = new StringBuilder(settings.otpLength());
        for (int i = 0; i < settings.otpLength(); i++) {
            code.append(random.nextInt(10));
        }
        byte[] salt = new byte[16];
        random.nextBytes(salt);
        byte[] id = new byte[16];
        random.nextBytes(id);
        long now = clock.millis();
        notes.set(NOTE_CHALLENGE_ID, HexFormat.of().formatHex(id));
        notes.set(NOTE_PHONE, e164);
        notes.set(NOTE_SALT, Base64.getEncoder().encodeToString(salt));
        notes.set(NOTE_HASH, hash(salt, e164, code.toString()));
        notes.set(NOTE_EXPIRES_AT, Long.toString(now + settings.otpTtl().toMillis()));
        notes.set(NOTE_SENT_AT, Long.toString(now));
        notes.remove(NOTE_VERIFIED_PHONE);
        return code.toString();
    }

    public String phone() {
        return notes.get(NOTE_PHONE);
    }

    public boolean hasActiveCode() {
        return notes.get(NOTE_HASH) != null;
    }

    /** Seconds until this session may request another code (0 when it may now). */
    public long resendAvailableInSeconds() {
        String sentAt = notes.get(NOTE_SENT_AT);
        if (sentAt == null) {
            return 0;
        }
        long waitMillis = Long.parseLong(sentAt) + settings.resendInterval().toMillis() - clock.millis();
        return waitMillis <= 0 ? 0 : (waitMillis + 999) / 1000;
    }

    public Result verify(String input) {
        String phone = notes.get(NOTE_PHONE);
        String expected = notes.get(NOTE_HASH);
        String salt = notes.get(NOTE_SALT);
        String id = notes.get(NOTE_CHALLENGE_ID);
        String expiresAt = notes.get(NOTE_EXPIRES_AT);
        if (phone == null || expected == null || salt == null || id == null || expiresAt == null) {
            return Result.NO_CODE;
        }
        long remainingMillis = Long.parseLong(expiresAt) - clock.millis();
        if (remainingMillis < 0) {
            clearCode();
            return Result.EXPIRED;
        }
        long lifespan = (remainingMillis + 999) / 1000 + CLAIM_GRACE_SECONDS;
        int slot = claimAttempt(id, lifespan);
        if (slot < 0) {
            clearCode();
            return Result.TOO_MANY_ATTEMPTS;
        }
        String candidate = input == null ? "" : input.replaceAll("\\s", "");
        boolean wellFormed = candidate.length() == settings.otpLength() && candidate.chars().allMatch(Character::isDigit);
        String actual = hash(Base64.getDecoder().decode(salt), phone, wellFormed ? candidate : "");
        boolean match = wellFormed && MessageDigest.isEqual(
                expected.getBytes(StandardCharsets.US_ASCII), actual.getBytes(StandardCharsets.US_ASCII));
        if (match) {
            if (!claims.putIfAbsent(CLAIM_PREFIX + id + ":used", lifespan)) {
                // A parallel submission already spent this code.
                return Result.EXPIRED;
            }
            clearCode();
            notes.set(NOTE_VERIFIED_PHONE, phone);
            return Result.OK;
        }
        if (slot == settings.maxAttempts() - 1) {
            clearCode();
            return Result.TOO_MANY_ATTEMPTS;
        }
        return Result.INVALID;
    }

    /** Claims the first free attempt slot of challenge {@code id}; -1 when all are taken. */
    private int claimAttempt(String id, long lifespan) {
        for (int slot = 0; slot < settings.maxAttempts(); slot++) {
            if (claims.putIfAbsent(CLAIM_PREFIX + id + ":attempt:" + slot, lifespan)) {
                return slot;
            }
        }
        return -1;
    }

    /** The phone proven by a successful {@link #verify}, or null. */
    public String verifiedPhone() {
        return notes.get(NOTE_VERIFIED_PHONE);
    }

    /** Forget the code but keep the phone and the resend clock. */
    public void clearCode() {
        notes.remove(NOTE_HASH);
        notes.remove(NOTE_SALT);
        notes.remove(NOTE_EXPIRES_AT);
        notes.remove(NOTE_CHALLENGE_ID);
    }

    static String hash(byte[] salt, String phone, String code) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(salt, "HmacSHA256"));
            byte[] digest = mac.doFinal((phone + ":" + code).getBytes(StandardCharsets.UTF_8));
            return Base64.getEncoder().encodeToString(digest);
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("HmacSHA256 unavailable", e);
        }
    }
}
