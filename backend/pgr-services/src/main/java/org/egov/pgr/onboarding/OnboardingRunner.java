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
    private final OnboardingWorkerService worker;
    private final OnboardingRepository repository;
    private final OnboardingSteps steps;
    private final OnboardingLifecyclePublisher publisher;
    private final long pollMs;
    private final String workerId = "pgr:" + UUID.randomUUID();
    private ThreadPoolTaskScheduler scheduler;

    public OnboardingRunner(OnboardingWorkerService worker, OnboardingRepository repository, OnboardingSteps steps, OnboardingLifecyclePublisher publisher) {
        this(worker, repository, steps, publisher, 5000);
    }

    @Autowired
    public OnboardingRunner(OnboardingWorkerService worker, OnboardingRepository repository, OnboardingSteps steps,
                            OnboardingLifecyclePublisher publisher,
                            @Value("${pgr.onboarding.runner.poll-ms:5000}") long pollMs) {
        this.worker = worker; this.repository = repository; this.steps = steps; this.publisher = publisher;
        this.pollMs = Math.max(100, pollMs);
    }

    public void tick() {
        publisher.publishPending();
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
            if ("ONBOARDING_LEASE_LOST".equals(failure.getCode())) return;
            worker.fail(operation.getId(), token, failure.isRetryable(), failure.getCode(), failure.getCode(),
                    operation.getCurrentStep(), operation.getCompletedSteps());
        }
        // Unexpected failures leave the lease to expire: restart resumes from the last checkpoint.
    }

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
