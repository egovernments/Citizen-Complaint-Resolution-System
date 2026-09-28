package org.egov.identity.keycloak.otp;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import org.egov.identity.keycloak.MutableClock;
import org.egov.identity.keycloak.config.OtpSettings;
import org.egov.identity.keycloak.otp.OtpChallenge.Result;
import org.junit.jupiter.api.Test;

class OtpChallengeTest {

    private final Map<String, String> store = new HashMap<>();
    private final NoteStore notes = new NoteStore() {
        public String get(String name) { return store.get(name); }
        public void set(String name, String value) { store.put(name, value); }
        public void remove(String name) { store.remove(name); }
    };
    private final MutableClock clock = new MutableClock(Instant.parse("2026-09-28T10:00:00Z"));
    private final OtpChallenge otp = new OtpChallenge(notes, OtpSettings.defaults(), clock, new SecureRandom());

    private static String wrong(String code) {
        return code.equals("000000") ? "111111" : "000000";
    }

    @Test
    void issuesSixDigitCodesAndNeverStoresThemInClear() {
        String code = otp.issue("+254712345678");
        assertTrue(code.matches("^[0-9]{6}$"));
        assertFalse(store.containsValue(code));
        assertEquals("+254712345678", otp.phone());
    }

    @Test
    void acceptsTheRightCodeOnceAndRecordsTheVerifiedPhone() {
        String code = otp.issue("+254712345678");
        assertEquals(Result.OK, otp.verify(" " + code + " "));
        assertEquals("+254712345678", otp.verifiedPhone());
        assertEquals(Result.NO_CODE, otp.verify(code));
    }

    @Test
    void codeExpiresAfterTheTtl() {
        String code = otp.issue("+254712345678");
        clock.advance(Duration.ofSeconds(301));
        assertEquals(Result.EXPIRED, otp.verify(code));
        assertNull(otp.verifiedPhone());
    }

    @Test
    void fiveWrongEntriesBurnTheCode() {
        String code = otp.issue("+254712345678");
        for (int i = 0; i < 4; i++) {
            assertEquals(Result.INVALID, otp.verify(wrong(code)));
        }
        assertEquals(Result.TOO_MANY_ATTEMPTS, otp.verify(wrong(code)));
        assertEquals(Result.NO_CODE, otp.verify(code));
    }

    @Test
    void malformedInputCountsAsAnAttempt() {
        String code = otp.issue("+254712345678");
        for (int i = 0; i < 4; i++) {
            assertEquals(Result.INVALID, otp.verify(i % 2 == 0 ? "12ab56" : null));
        }
        assertEquals(Result.TOO_MANY_ATTEMPTS, otp.verify("1"));
        assertEquals(Result.NO_CODE, otp.verify(code));
    }

    @Test
    void aNewCodeReplacesTheOldOneAndResetsAttempts() {
        String first = otp.issue("+254712345678");
        assertEquals(Result.INVALID, otp.verify(wrong(first)));
        String second = otp.issue("+254712345678");
        assertEquals("0", store.get(OtpChallenge.NOTE_ATTEMPTS));
        if (!first.equals(second)) {
            assertEquals(Result.INVALID, otp.verify(first));
        }
        assertEquals(Result.OK, otp.verify(second));
    }

    @Test
    void aCodeIsBoundToThePhoneItWasSentTo() {
        String code = otp.issue("+254712345678");
        store.put(OtpChallenge.NOTE_PHONE, "+254799999999");
        assertEquals(Result.INVALID, otp.verify(code));
    }

    @Test
    void resendCountdownFollowsTheClock() {
        otp.issue("+254712345678");
        assertEquals(30, otp.resendAvailableInSeconds());
        clock.advance(Duration.ofMillis(10_500));
        assertEquals(20, otp.resendAvailableInSeconds());
        clock.advance(Duration.ofSeconds(20));
        assertEquals(0, otp.resendAvailableInSeconds());
    }

    @Test
    void hashDependsOnSaltPhoneAndCode() {
        byte[] salt = new byte[16];
        String h = OtpChallenge.hash(salt, "+254712345678", "123456");
        assertEquals(h, OtpChallenge.hash(salt, "+254712345678", "123456"));
        assertFalse(h.equals(OtpChallenge.hash(salt, "+254712345678", "123457")));
        assertFalse(h.equals(OtpChallenge.hash(salt, "+254712345679", "123456")));
        byte[] other = new byte[16];
        other[0] = 1;
        assertFalse(h.equals(OtpChallenge.hash(other, "+254712345678", "123456")));
    }
}
