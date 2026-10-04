package org.egov.pgr.onboarding;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import java.util.*;

@Component
@ConditionalOnProperty(name = "pgr.onboarding.runner.enabled", havingValue = "true")
public class OnboardingRunner {
    public static final List<String> STEPS = List.of("TENANT_FOUNDATION", "PLATFORM_BASELINE", "FOUNDER_HRMS", "ORGANIZATION", "MEMBERSHIP", "BINDING");
    private final OnboardingWorkerService worker;
    private final OnboardingRepository repository;
    private final OnboardingSteps steps;
    private final OnboardingLifecyclePublisher publisher;
    private final String workerId = "pgr:" + UUID.randomUUID();
    public OnboardingRunner(OnboardingWorkerService worker, OnboardingRepository repository, OnboardingSteps steps, OnboardingLifecyclePublisher publisher) {
        this.worker = worker; this.repository = repository; this.steps = steps; this.publisher = publisher;
    }

    @Scheduled(fixedDelayString = "${pgr.onboarding.runner.poll-ms:5000}")
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

    @Configuration
    @EnableScheduling
    @ConditionalOnProperty(name = "pgr.onboarding.runner.enabled", havingValue = "true")
    static class Scheduling { }
}
