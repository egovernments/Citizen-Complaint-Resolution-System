package org.egov.pgr.onboarding;

import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.slf4j.LoggerFactory;

import java.util.ArrayList;
import java.util.List;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.junit.Assert.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Review #2269 item 7: a misconfigured provisioner must not burn every signup's automatic
 * retries and strand it in RETRYABLE_FAILED with no next retry. The runner stops claiming
 * while the provisioner is not ready, so signups stay PENDING until an operator fixes it.
 */
public class OnboardingRunnerReadinessTest {
    private OnboardingWorkerService worker;
    private OnboardingSteps steps;
    private OnboardingLifecyclePublisher publisher;
    private OnboardingProvisionerClient provisioner;
    private OnboardingRunner runner;
    private long now = 1_000_000;
    private final ListAppender<ILoggingEvent> logs = new ListAppender<>();

    @Before
    public void setUp() {
        worker = mock(OnboardingWorkerService.class);
        steps = mock(OnboardingSteps.class);
        publisher = mock(OnboardingLifecyclePublisher.class);
        provisioner = mock(OnboardingProvisionerClient.class);
        OnboardingRepository repository = mock(OnboardingRepository.class);
        when(repository.checkpoint(any(), any(), anyLong())).thenReturn(true);
        runner = new OnboardingRunner(worker, repository, steps, publisher, provisioner, null, 5000);
        runner.clock = () -> now;
        when(worker.claim(anyString(), anyLong())).thenReturn(Optional.empty());
        logs.start();
        ((Logger) LoggerFactory.getLogger(OnboardingRunner.class)).addAppender(logs);
    }

    @After
    public void detach() {
        ((Logger) LoggerFactory.getLogger(OnboardingRunner.class)).detachAppender(logs);
    }

    /** Clock times (relative to the first tick) at which the runner re-checked the provisioner. */
    private List<Long> checkTimes(long pollMs, long untilMs) {
        long start = now;
        List<Long> checks = new ArrayList<>();
        doAnswer(call -> { checks.add(now - start); throw new OnboardingFailure(currentFailure, true); })
                .when(provisioner).verifyReady();
        while (now - start <= untilMs) { runner.tick(); now += pollMs; }
        return checks;
    }
    private String currentFailure = "PROVISIONER_UNAVAILABLE";

    private long pauseErrors() {
        return logs.list.stream().filter(e -> e.getLevel() == Level.ERROR
                && e.getFormattedMessage().contains("PAUSED")).count();
    }

    @Test
    public void anUnconfiguredProvisionerLeavesSignupsQueuedInsteadOfBurningRetries() {
        doThrow(new OnboardingFailure("PROVISIONER_NOT_CONFIGURED", true)).when(provisioner).verifyReady();

        for (int i = 0; i < 20; i++) { runner.tick(); now += 5000; }

        verify(worker, never()).claim(anyString(), anyLong());
        verify(worker, never()).fail(any(), any(), anyBoolean(), any(), any(), any(), any());
        verify(publisher, times(20)).publishPending(); // lifecycle publication is not paused
        assertEquals("PROVISIONER_NOT_CONFIGURED", runner.pausedReason());
        // Not on every 5 s poll: re-checked after 30 s, then 60 s (backoff), within these 100 s.
        verify(provisioner, times(3)).verifyReady();
    }

    @Test
    public void seedUpgradesRunOnlyOnIdleTicksWithAReadyProvisioner() {
        BaselineUpgrader upgrader = mock(BaselineUpgrader.class);
        runner = new OnboardingRunner(worker, mock(OnboardingRepository.class), steps, publisher, provisioner, upgrader, 5000);
        runner.clock = () -> now;
        doThrow(new OnboardingFailure("PROVISIONER_NOT_CONFIGURED", true)).doNothing().when(provisioner).verifyReady();
        runner.tick();
        verify(upgrader, never()).upgradeNext();

        now += OnboardingRunner.NOT_READY_RECHECK_MS;
        runner.tick(); // no signup waiting
        verify(upgrader).upgradeNext();

        Map<String, Object> claim = new LinkedHashMap<>();
        claim.put("Operation", OnboardingOperation.builder().id(UUID.randomUUID()).signupId(UUID.randomUUID()).completedSteps(new ArrayList<>(OnboardingRunner.STEPS)).build());
        claim.put("Signup", new OnboardingSignup()); claim.put("leaseToken", UUID.randomUUID().toString());
        when(worker.claim(anyString(), anyLong())).thenReturn(Optional.of(claim));
        now += 5000; runner.tick(); // a signup goes first
        verify(upgrader, times(1)).upgradeNext();
    }

    @Test
    public void claimsResumeOnceTheProvisionerIsFixed() {
        doThrow(new OnboardingFailure("PROVISIONER_AUTHORIZATION_REQUIRED", true)).doNothing().when(provisioner).verifyReady();
        runner.tick();
        verify(worker, never()).claim(anyString(), anyLong());

        now += OnboardingRunner.NOT_READY_RECHECK_MS;
        runner.tick();
        verify(worker).claim(anyString(), anyLong());
        assertNull(runner.pausedReason());

        // A healthy provisioner is re-verified at most once a minute.
        now += 5000; runner.tick();
        verify(provisioner, times(2)).verifyReady();
        verify(worker, times(2)).claim(anyString(), anyLong());
    }

    @Test
    public void aProvisionerFailureDuringAJobIsRecheckedBeforeTheNextClaim() {
        UUID operationId = UUID.randomUUID(), token = UUID.randomUUID();
        OnboardingOperation operation = OnboardingOperation.builder().id(operationId)
                .completedSteps(new ArrayList<>()).build();
        Map<String, Object> claim = new LinkedHashMap<>();
        claim.put("Operation", operation);
        claim.put("Signup", new OnboardingSignup());
        claim.put("leaseToken", token.toString());
        when(worker.claim(anyString(), anyLong())).thenReturn(Optional.of(claim)).thenReturn(Optional.empty());
        doThrow(new OnboardingFailure("PROVISIONER_AUTHORIZATION_REQUIRED", true))
                .when(steps).perform(eq("TENANT_FOUNDATION"), any(), any(), any());
        doNothing().doThrow(new OnboardingFailure("PROVISIONER_AUTHORIZATION_REQUIRED", true)).when(provisioner).verifyReady();

        runner.tick(); // ready, claims, the job fails once
        verify(worker).fail(eq(operationId), eq(token), eq(true), eq("PROVISIONER_AUTHORIZATION_REQUIRED"), any(), any(), any());

        now += 1000; // well inside the one-minute "ready" window
        runner.tick();
        verify(provisioner, times(2)).verifyReady();
        verify(worker, times(1)).claim(anyString(), anyLong());
        assertEquals("PROVISIONER_AUTHORIZATION_REQUIRED", runner.pausedReason());
    }

    /** #2269 round-3 review item 2: a failing provisioner is re-checked with exponential backoff, capped at 15 min. */
    @Test
    public void aPausedRunnerBacksOffExponentiallyUpToFifteenMinutes() {
        List<Long> checks = checkTimes(5000, 60 * 60_000);
        List<Long> gaps = new ArrayList<>();
        for (int i = 1; i < checks.size(); i++) gaps.add(checks.get(i) - checks.get(i - 1));
        assertEquals(List.of(30_000L, 60_000L, 120_000L, 240_000L, 480_000L, 900_000L, 900_000L), gaps.subList(0, 7));
        assertTrue(gaps.stream().allMatch(gap -> gap <= OnboardingRunner.NOT_READY_MAX_RECHECK_MS));
        verify(worker, never()).claim(anyString(), anyLong());
    }

    /** A rejected password is not retried on the backoff schedule: each retry is a failed login toward lockout. */
    @Test
    public void rejectedCredentialsAreNotRetriedUntilTheLongInterval() {
        when(provisioner.hasLoggedIn()).thenReturn(true);
        currentFailure = OnboardingRunner.CREDENTIALS_REJECTED;
        List<Long> checks = checkTimes(5000, 6 * 60 * 60_000L);
        assertEquals(List.of(0L, OnboardingRunner.CREDENTIALS_REJECTED_RECHECK_MS), checks);
        assertEquals(OnboardingRunner.CREDENTIALS_REJECTED, runner.pausedReason());
        assertEquals(1, pauseErrors());
        assertTrue(logs.list.get(0).getFormattedMessage().contains("locks the account"));
    }

    /**
     * Review #2269 round 3: on a fresh deploy pgr-services starts before the playbook creates the
     * provisioner, so its first logins are rejected. Before any successful login the runner must keep
     * re-checking (not sleep 6 h), but slowly enough to stay under egov-user's lockout (5 per 30 min).
     */
    @Test
    public void aRejectionBeforeAnySuccessfulLoginIsRecheckedUnderTheLockoutThreshold() {
        when(provisioner.hasLoggedIn()).thenReturn(false);
        currentFailure = OnboardingRunner.CREDENTIALS_REJECTED;
        List<Long> checks = checkTimes(5000, 60 * 60_000L);
        assertTrue("re-checked within the hour, not after 6 h", checks.size() >= 6);
        for (Long start : checks) {
            long inWindow = checks.stream().filter(t -> t >= start && t < start + 30 * 60_000L).count();
            assertTrue("at most 3 failed logins in any 30 min window", inWindow <= 3);
        }
        assertEquals(OnboardingRunner.CREDENTIALS_REJECTED, runner.pausedReason());
        assertEquals(1, pauseErrors());
        assertTrue(logs.list.get(0).getFormattedMessage().contains("may not exist yet"));
    }

    @Test
    public void aJobRejectedAtLoginPausesWithoutAnotherLogin() {
        UUID operationId = UUID.randomUUID(), token = UUID.randomUUID();
        OnboardingOperation operation = OnboardingOperation.builder().id(operationId)
                .completedSteps(new ArrayList<>()).build();
        Map<String, Object> claim = new LinkedHashMap<>();
        claim.put("Operation", operation);
        claim.put("Signup", new OnboardingSignup());
        claim.put("leaseToken", token.toString());
        when(worker.claim(anyString(), anyLong())).thenReturn(Optional.of(claim)).thenReturn(Optional.empty());
        doThrow(new OnboardingFailure(OnboardingRunner.CREDENTIALS_REJECTED, true))
                .when(steps).perform(eq("TENANT_FOUNDATION"), any(), any(), any());

        runner.tick(); // ready, claims, the job's login is refused
        for (int i = 0; i < 100; i++) { now += 5000; runner.tick(); }

        verify(provisioner, times(1)).verifyReady();
        verify(worker, times(1)).claim(anyString(), anyLong());
        assertEquals(OnboardingRunner.CREDENTIALS_REJECTED, runner.pausedReason());
    }

    /** Test gap 8: the pause is logged once per reason, not on every re-check. */
    @Test
    public void thePauseIsLoggedOncePerReasonNotOnEveryCheck() {
        List<Long> checks = checkTimes(5000, 30 * 60_000);
        assertTrue("several re-checks happened", checks.size() >= 5);
        assertEquals(1, pauseErrors());

        currentFailure = "PROVISIONER_AUTHORIZATION_REQUIRED";
        checkTimes(5000, 30 * 60_000);
        assertEquals("a new reason is logged once", 2, pauseErrors());

        doNothing().when(provisioner).verifyReady();
        now += OnboardingRunner.NOT_READY_MAX_RECHECK_MS;
        runner.tick();
        assertNull(runner.pausedReason());
        assertEquals(1, logs.list.stream().filter(e -> e.getFormattedMessage().contains("resumed")).count());
    }
}
