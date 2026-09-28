package org.egov.identity.keycloak.ratelimit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import org.egov.identity.keycloak.MutableClock;
import org.egov.identity.keycloak.config.OtpSettings;
import org.egov.identity.keycloak.ratelimit.SendRateLimiter.Decision;
import org.junit.jupiter.api.Test;

class SendRateLimiterTest {

    /** SingleUseObjectProvider stand-in: putIfAbsent with per-key expiry. */
    private final MutableClock clock = new MutableClock(Instant.parse("2026-09-28T10:00:00Z"));
    private final Map<String, Instant> keys = new HashMap<>();
    private final SendRateLimiter.SlotStore store = new SendRateLimiter.SlotStore() {
        @Override
        public boolean putIfAbsent(String key, long lifespan) {
            if (contains(key)) {
                return false;
            }
            keys.put(key, clock.instant().plusSeconds(lifespan));
            return true;
        }

        @Override
        public boolean contains(String key) {
            Instant expiry = keys.get(key);
            return expiry != null && clock.instant().isBefore(expiry);
        }
    };
    private final SendRateLimiter limiter = new SendRateLimiter(store, OtpSettings.defaults(), clock, "realm-1");

    @Test
    void enforcesTheResendCooldownPerPhone() {
        assertEquals(Decision.ALLOWED, limiter.tryAcquire("+254712345678", "10.0.0.1"));
        assertEquals(Decision.RESEND_TOO_SOON, limiter.tryAcquire("+254712345678", "10.0.0.2"));
        assertEquals(Decision.ALLOWED, limiter.tryAcquire("+254700000000", "10.0.0.1"));
        clock.advance(Duration.ofSeconds(30));
        assertEquals(Decision.ALLOWED, limiter.tryAcquire("+254712345678", "10.0.0.1"));
    }

    @Test
    void allowsFiveSendsPerPhonePerHour() {
        for (int i = 0; i < 5; i++) {
            assertEquals(Decision.ALLOWED, limiter.tryAcquire("+254712345678", "10.0.0." + i));
            clock.advance(Duration.ofSeconds(31));
        }
        assertEquals(Decision.PHONE_LIMIT, limiter.tryAcquire("+254712345678", "10.0.0.9"));
        clock.advance(Duration.ofHours(1));
        assertEquals(Decision.ALLOWED, limiter.tryAcquire("+254712345678", "10.0.0.9"));
    }

    @Test
    void allowsTwentySendsPerIpPerHour() {
        for (int i = 0; i < 20; i++) {
            assertEquals(Decision.ALLOWED, limiter.tryAcquire("+2547000000" + String.format("%02d", i), "10.9.9.9"));
        }
        assertEquals(Decision.IP_LIMIT, limiter.tryAcquire("+254711111111", "10.9.9.9"));
        assertEquals(Decision.ALLOWED, limiter.tryAcquire("+254711111112", "10.9.9.8"));
    }

    @Test
    void anIpRefusalSpendsNoneOfThePhoneBudgetOrCooldown() {
        for (int i = 0; i < 20; i++) {
            assertEquals(Decision.ALLOWED, limiter.tryAcquire("+2547000000" + String.format("%02d", i), "10.6.6.6"));
        }
        // An attacker whose IP is exhausted hammers a victim's number...
        for (int i = 0; i < 10; i++) {
            assertEquals(Decision.IP_LIMIT, limiter.tryAcquire("+254712345678", "10.6.6.6"));
        }
        // ...and the victim still gets a code now and a full hourly budget.
        for (int i = 0; i < 5; i++) {
            assertEquals(Decision.ALLOWED, limiter.tryAcquire("+254712345678", "10.0.0.1"));
            clock.advance(Duration.ofSeconds(31));
        }
    }

    @Test
    void resendingTooSoonSpendsNoBudget() {
        assertEquals(Decision.ALLOWED, limiter.tryAcquire("+254712345678", "10.0.0.1"));
        for (int i = 0; i < 10; i++) {
            assertEquals(Decision.RESEND_TOO_SOON, limiter.tryAcquire("+254712345678", "10.0.0.2"));
        }
        for (int i = 0; i < 4; i++) {
            clock.advance(Duration.ofSeconds(31));
            assertEquals(Decision.ALLOWED, limiter.tryAcquire("+254712345678", "10.0.0.2"));
        }
        clock.advance(Duration.ofSeconds(31));
        assertEquals(Decision.PHONE_LIMIT, limiter.tryAcquire("+254712345678", "10.0.0.2"));
        // 1 + 4 sends from 10.0.0.2's perspective: its IP budget still has room.
        assertEquals(Decision.ALLOWED, limiter.tryAcquire("+254799999999", "10.0.0.2"));
    }

    @Test
    void aPhoneRefusalDoesNotStartTheCooldown() {
        for (int i = 0; i < 5; i++) {
            assertEquals(Decision.ALLOWED, limiter.tryAcquire("+254712345678", "10.0.0.1"));
            clock.advance(Duration.ofSeconds(31));
        }
        assertEquals(Decision.PHONE_LIMIT, limiter.tryAcquire("+254712345678", "10.0.0.1"));
        assertEquals(Decision.PHONE_LIMIT, limiter.tryAcquire("+254712345678", "10.0.0.1"));
    }

    @Test
    void keysAreNamespacedAndCarryNoRawPhoneOrIp() {
        limiter.tryAcquire("+254712345678", "10.0.0.1");
        for (String key : keys.keySet()) {
            assertTrue(key.startsWith("digit-otp:realm-1:"), key);
            assertTrue(!key.contains("254712345678") && !key.contains("10.0.0.1"), key);
        }
    }

    @Test
    void realmsHaveIndependentBudgets() {
        SendRateLimiter other = new SendRateLimiter(store, OtpSettings.defaults(), clock, "realm-2");
        assertEquals(Decision.ALLOWED, limiter.tryAcquire("+254712345678", "10.0.0.1"));
        assertEquals(Decision.ALLOWED, other.tryAcquire("+254712345678", "10.0.0.1"));
    }
}
