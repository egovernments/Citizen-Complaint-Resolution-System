package org.egov.identity.keycloak.otp;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Clock;
import java.util.Base64;
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
 */
public final class OtpChallenge {

    public static final String NOTE_PHONE = "digit.phone";
    public static final String NOTE_HASH = "digit.otp.hash";
    public static final String NOTE_SALT = "digit.otp.salt";
    public static final String NOTE_EXPIRES_AT = "digit.otp.expiresAt";
    public static final String NOTE_ATTEMPTS = "digit.otp.attempts";
    public static final String NOTE_SENT_AT = "digit.otp.sentAt";
    public static final String NOTE_VERIFIED_PHONE = "digit.phone.verified";

    public enum Result { OK, INVALID, EXPIRED, TOO_MANY_ATTEMPTS, NO_CODE }

    private final NoteStore notes;
    private final OtpSettings settings;
    private final Clock clock;
    private final SecureRandom random;

    public OtpChallenge(NoteStore notes, OtpSettings settings, Clock clock, SecureRandom random) {
        this.notes = notes;
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
        long now = clock.millis();
        notes.set(NOTE_PHONE, e164);
        notes.set(NOTE_SALT, Base64.getEncoder().encodeToString(salt));
        notes.set(NOTE_HASH, hash(salt, e164, code.toString()));
        notes.set(NOTE_EXPIRES_AT, Long.toString(now + settings.otpTtl().toMillis()));
        notes.set(NOTE_ATTEMPTS, "0");
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
        if (phone == null || expected == null || salt == null) {
            return Result.NO_CODE;
        }
        if (clock.millis() > Long.parseLong(notes.get(NOTE_EXPIRES_AT))) {
            clearCode();
            return Result.EXPIRED;
        }
        int attempts = Integer.parseInt(notes.get(NOTE_ATTEMPTS));
        if (attempts >= settings.maxAttempts()) {
            clearCode();
            return Result.TOO_MANY_ATTEMPTS;
        }
        String candidate = input == null ? "" : input.replaceAll("\\s", "");
        boolean wellFormed = candidate.length() == settings.otpLength() && candidate.chars().allMatch(Character::isDigit);
        String actual = hash(Base64.getDecoder().decode(salt), phone, wellFormed ? candidate : "");
        boolean match = wellFormed && MessageDigest.isEqual(
                expected.getBytes(StandardCharsets.US_ASCII), actual.getBytes(StandardCharsets.US_ASCII));
        if (match) {
            clearCode();
            notes.set(NOTE_VERIFIED_PHONE, phone);
            return Result.OK;
        }
        attempts++;
        if (attempts >= settings.maxAttempts()) {
            clearCode();
            return Result.TOO_MANY_ATTEMPTS;
        }
        notes.set(NOTE_ATTEMPTS, Integer.toString(attempts));
        return Result.INVALID;
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
        notes.remove(NOTE_ATTEMPTS);
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
