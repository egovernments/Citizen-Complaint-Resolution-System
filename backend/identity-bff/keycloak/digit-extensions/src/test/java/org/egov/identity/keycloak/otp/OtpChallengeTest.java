package org.egov.identity.keycloak.otp;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
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
    /** Stand-in for SingleUseObjectProvider: atomic putIfAbsent, shared by every "node". */
    private final Map<String, Long> claimed = new ConcurrentHashMap<>();
    private final AtomicInteger attemptClaims = new AtomicInteger();
    private final OtpChallenge.ClaimStore claims = (key, lifespan) -> {
        boolean won = claimed.putIfAbsent(key, lifespan) == null;
        if (won && key.contains(":attempt:")) {
            attemptClaims.incrementAndGet();
        }
        return won;
    };
    private final OtpChallenge otp = new OtpChallenge(notes, claims, OtpSettings.defaults(), clock, new SecureRandom());

    /**
     * One request's view of the auth session: its own copy of the notes, as
     * when parallel requests (or cluster nodes) each load the session. Only
     * the claim store is shared.
     */
    private OtpChallenge requestView() {
        Map<String, String> copy = new HashMap<>(store);
        NoteStore view = new NoteStore() {
            public String get(String name) { return copy.get(name); }
            public void set(String name, String value) { copy.put(name, value); }
            public void remove(String name) { copy.remove(name); }
        };
        return new OtpChallenge(view, claims, OtpSettings.defaults(), clock, new SecureRandom());
    }

    /** Runs {@code inputs} as simultaneous submissions against stale per-request views. */
    private List<Result> submitInParallel(List<String> inputs) throws Exception {
        List<OtpChallenge> views = new ArrayList<>();
        for (int i = 0; i < inputs.size(); i++) {
            views.add(requestView());
        }
        ExecutorService pool = Executors.newFixedThreadPool(inputs.size());
        CountDownLatch start = new CountDownLatch(1);
        try {
            List<Future<Result>> futures = new ArrayList<>();
            for (int i = 0; i < inputs.size(); i++) {
                OtpChallenge view = views.get(i);
                String input = inputs.get(i);
                futures.add(pool.submit(() -> {
                    start.await();
                    return view.verify(input);
                }));
            }
            start.countDown();
            List<Result> results = new ArrayList<>();
            for (Future<Result> future : futures) {
                results.add(future.get(10, TimeUnit.SECONDS));
            }
            return results;
        } finally {
            pool.shutdownNow();
        }
    }

    private static long count(List<Result> results, Result result) {
        return results.stream().filter(result::equals).count();
    }

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
        for (int i = 0; i < 3; i++) {
            assertEquals(Result.INVALID, otp.verify(wrong(second)));
        }
        if (!first.equals(second)) {
            assertEquals(Result.INVALID, otp.verify(first));
        }
        assertEquals(Result.OK, otp.verify(second));
    }

    @Test
    void parallelSubmissionsOfTheRightCodeSucceedExactlyOnce() throws Exception {
        String code = otp.issue("+254712345678");
        List<Result> results = submitInParallel(List.of(code, code, code, code, code, code, code, code));
        assertEquals(1, count(results, Result.OK), results.toString());
        // Every stale view still holds the code; a later replay is refused too.
        assertFalse(requestView().verify(code) == Result.OK);
    }

    @Test
    void parallelWrongGuessesNeverExceedTheAttemptLimit() throws Exception {
        String code = otp.issue("+254712345678");
        List<String> guesses = new ArrayList<>();
        for (int i = 0; i < 24; i++) {
            guesses.add(wrong(code));
        }
        List<Result> results = submitInParallel(guesses);
        int max = OtpSettings.defaults().maxAttempts();
        assertEquals(max - 1, count(results, Result.INVALID), results.toString());
        assertEquals(guesses.size() - (max - 1), count(results, Result.TOO_MANY_ATTEMPTS));
        assertEquals(max, attemptClaims.get(), "only maxAttempts guesses were ever compared");
        // The budget is spent for every view, including one that saw no failures.
        assertEquals(Result.TOO_MANY_ATTEMPTS, requestView().verify(code));
    }

    @Test
    void theRightCodeRacingWrongGuessesIsAcceptedAtMostOnce() throws Exception {
        String code = otp.issue("+254712345678");
        List<String> inputs = new ArrayList<>();
        for (int i = 0; i < 12; i++) {
            inputs.add(i % 3 == 0 ? code : wrong(code));
        }
        List<Result> results = submitInParallel(inputs);
        int max = OtpSettings.defaults().maxAttempts();
        assertTrue(count(results, Result.OK) <= 1, results.toString());
        assertTrue(count(results, Result.INVALID) <= max - 1, results.toString());
        assertEquals(max, attemptClaims.get());
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
