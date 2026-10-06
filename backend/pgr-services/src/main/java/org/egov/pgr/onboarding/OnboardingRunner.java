package org.egov.pgr.onboarding;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.SmartLifecycle;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;
import org.springframework.stereotype.Component;
import java.time.Duration;
import java.util.*;
import java.util.function.LongSupplier;

/**
 * Polls for onboarding work on its OWN single thread ({@value #THREAD_PREFIX}*).
 *
 * Not {@code @Scheduled}: Spring's shared scheduler has one thread, and one signup runs
 * ~1,000 records x several HTTP calls, so escalation and dashboard refresh would stall
 * for minutes behind it. The runner's scheduler is private, not a bean, so it never
 * becomes the application's default TaskScheduler either. Claims still go through the
 * lease and SKIP LOCKED in {@link OnboardingWorkerService#claim}.
 */
@Slf4j
@Component
@ConditionalOnProperty(name = "pgr.onboarding.runner.enabled", havingValue = "true")
public class OnboardingRunner implements SmartLifecycle {
    public static final List<String> STEPS = List.of("TENANT_FOUNDATION", "PLATFORM_BASELINE", "FOUNDER_HRMS", "ORGANIZATION", "MEMBERSHIP", "BINDING");
    static final String THREAD_PREFIX = "pgr-onboarding-";
    static final long READY_RECHECK_MS = 60_000, NOT_READY_RECHECK_MS = 30_000, NOT_READY_MAX_RECHECK_MS = 15 * 60_000;
    /**
     * egov-user rejected the provisioner's password. Every retry is another failed login, and egov-user
     * locks the account after 5 in 30 minutes (max.invalid.login.attempts), so a rejected credential is
     * not retried on the backoff schedule: once per this interval, or at once after a restart.
     */
    static final long CREDENTIALS_REJECTED_RECHECK_MS = 6 * 60 * 60_000L;
    /**
     * Before the first successful login a 400/401 usually means the account does not exist yet (a fresh
     * deploy creates the provisioner after pgr-services starts). Re-check every 10 min: at most 3 failed
     * logins per 30 min, under egov-user's lockout of 5, so a genuinely wrong password still cannot lock it.
     */
    static final long FIRST_LOGIN_REJECTED_RECHECK_MS = 10 * 60_000L;
    static final String CREDENTIALS_REJECTED = OnboardingProvisionerClient.CREDENTIALS_REJECTED;
    private final OnboardingWorkerService worker;
    private final OnboardingRepository repository;
    private final OnboardingSteps steps;
    private final OnboardingLifecyclePublisher publisher;
    /** Null only in tests that drive {@link #tick()} directly: no readiness gate. */
    private final OnboardingProvisionerClient provisioner;
    private final long pollMs;
    private final String workerId = "pgr:" + UUID.randomUUID();
    LongSupplier clock = System::currentTimeMillis;
    private volatile long nextReadinessCheck;
    private volatile String notReady;
    /** Consecutive failed readiness checks; the re-check interval doubles with each, up to the cap. */
    private volatile int failedChecks;
    private ThreadPoolTaskScheduler scheduler;

    public OnboardingRunner(OnboardingWorkerService worker, OnboardingRepository repository, OnboardingSteps steps, OnboardingLifecyclePublisher publisher) {
        this(worker, repository, steps, publisher, 5000);
    }

    OnboardingRunner(OnboardingWorkerService worker, OnboardingRepository repository, OnboardingSteps steps,
                     OnboardingLifecyclePublisher publisher, long pollMs) {
        this(worker, repository, steps, publisher, null, pollMs);
    }

    @Autowired
    public OnboardingRunner(OnboardingWorkerService worker, OnboardingRepository repository, OnboardingSteps steps,
                            OnboardingLifecyclePublisher publisher, OnboardingProvisionerClient provisioner,
                            @Value("${pgr.onboarding.runner.poll-ms:5000}") long pollMs) {
        this.worker = worker; this.repository = repository; this.steps = steps; this.publisher = publisher;
        this.provisioner = provisioner; this.pollMs = Math.max(100, pollMs);
    }

    public void tick() {
        publisher.publishPending();
        // A misconfigured provisioner fails every job retryably; claiming anyway would burn
        // each signup's 12 automatic retries and leave it RETRYABLE_FAILED with no next retry.
        // Leave the work PENDING instead until the provisioner is fixed.
        if (!provisionerReady()) return;
        worker.claim(workerId, 120).ifPresent(claim -> process((OnboardingOperation) claim.get("Operation"),
                (OnboardingSignup) claim.get("Signup"), UUID.fromString(claim.get("leaseToken").toString())));
    }

    public void process(OnboardingOperation operation, OnboardingSignup signup, UUID token) {
        var progress = new OnboardingProgress(repository, operation, token);
        try {
            for (String step : STEPS) {
                if (operation.getCompletedSteps().contains(step)) continue;
                operation.setCurrentStep(step); progress.save();
                steps.perform(step, signup, operation, progress);
                operation.getCompletedSteps().add(step); progress.save();
            }
            worker.complete(operation.getId(), token, operation.getCompletedSteps());
        } catch (OnboardingFailure failure) {
            // A rejected credential pauses at once: re-checking now would be one more failed login.
            if (CREDENTIALS_REJECTED.equals(failure.getCode())) pause(CREDENTIALS_REJECTED, clock.getAsLong());
            else if (failure.getCode() != null && failure.getCode().startsWith("PROVISIONER_")) nextReadinessCheck = 0;
            if ("ONBOARDING_LEASE_LOST".equals(failure.getCode())) return;
            worker.fail(operation.getId(), token, failure.isRetryable(), failure.getCode(), failure.getCode(),
                    operation.getCurrentStep(), operation.getCompletedSteps());
        }
        // complete/fail committed any lifecycle decision; publish it now, not a poll later (#2303).
        publisher.publishPending();
        // Unexpected failures leave the lease to expire: restart resumes from the last checkpoint.
    }

    /**
     * The provisioner's credentials, login and root-tenant admin roles. Re-checked once a minute while
     * ready; while paused, after 30 s doubling to at most 15 min, or after 6 h for a rejected password.
     */
    boolean provisionerReady() {
        if (provisioner == null) return true;
        long now = clock.getAsLong();
        if (now < nextReadinessCheck) return notReady == null;
        String reason;
        try {
            provisioner.verifyReady();
            reason = null;
        } catch (OnboardingFailure failure) {
            reason = failure.getCode();
        } catch (RuntimeException unexpected) {
            reason = "PROVISIONER_UNAVAILABLE";
        }
        if (reason == null) {
            if (notReady != null) log.info("PGR onboarding runner resumed: provisioner is ready");
            notReady = null;
            failedChecks = 0;
            nextReadinessCheck = now + READY_RECHECK_MS;
            return true;
        }
        pause(reason, now);
        return false;
    }

    private void pause(String reason, long now) {
        if (!reason.equals(notReady)) {
            if (CREDENTIALS_REJECTED.equals(reason) && !provisioner.hasLoggedIn()) {
                log.error("PGR onboarding runner PAUSED ({}): egov-user rejected the provisioner login before it ever "
                        + "succeeded. On a fresh deploy the account may not exist yet; re-checking every {} min (under "
                        + "egov-user's lockout of 5 failures in 30 minutes). If it persists, fix "
                        + "PGR_DIGIT_PROVISIONER_USERNAME/PASSWORD/TENANT_ID.", reason, FIRST_LOGIN_REJECTED_RECHECK_MS / 60_000);
            } else if (CREDENTIALS_REJECTED.equals(reason)) {
                log.error("PGR onboarding runner PAUSED ({}): egov-user rejected the provisioner login. Not retrying "
                        + "for {} h: every attempt is a failed login, and egov-user locks the account after 5 in 30 "
                        + "minutes. An operator must fix PGR_DIGIT_PROVISIONER_PASSWORD (or USERNAME/TENANT_ID, or the "
                        + "OAuth client secret) and restart pgr-services. If the account is already locked, clear "
                        + "eg_user.accountlocked and its eg_user_login_failed_attempts rows, or wait 60 minutes.",
                        reason, CREDENTIALS_REJECTED_RECHECK_MS / 3_600_000);
            } else {
                log.error("PGR onboarding runner PAUSED ({}): signups stay queued until the provisioner works. Check "
                        + "PGR_DIGIT_PROVISIONER_USERNAME/PASSWORD/TENANT_ID: the account must log in as an active EMPLOYEE "
                        + "of that root tenant and hold MDMS_ADMIN, ACCOUNT_ADMIN, LOC_ADMIN and HRMS_ADMIN there.", reason);
            }
        }
        notReady = reason;
        long delay;
        if (CREDENTIALS_REJECTED.equals(reason)) {
            delay = provisioner.hasLoggedIn() ? CREDENTIALS_REJECTED_RECHECK_MS : FIRST_LOGIN_REJECTED_RECHECK_MS;
        } else {
            delay = Math.min(NOT_READY_RECHECK_MS << Math.min(failedChecks, 10), NOT_READY_MAX_RECHECK_MS);
            failedChecks++;
        }
        nextReadinessCheck = now + delay;
    }

    /** Why the runner is not claiming work, or null while it is. */
    public String pausedReason() { return provisioner == null ? null : notReady; }

    @Override
    public synchronized void start() {
        if (scheduler != null) return;
        ThreadPoolTaskScheduler own = new ThreadPoolTaskScheduler();
        own.setPoolSize(1);
        own.setThreadNamePrefix(THREAD_PREFIX);
        own.setWaitForTasksToCompleteOnShutdown(true);
        own.setAwaitTerminationSeconds(30);
        own.initialize();
        own.scheduleWithFixedDelay(() -> {
            try { tick(); }
            catch (RuntimeException error) { log.error("PGR onboarding runner tick failed", error); }
        }, Duration.ofMillis(pollMs));
        scheduler = own;
    }

    @Override
    public synchronized void stop() {
        if (scheduler == null) return;
        scheduler.shutdown();
        scheduler = null;
    }

    @Override
    public synchronized boolean isRunning() { return scheduler != null; }
}
