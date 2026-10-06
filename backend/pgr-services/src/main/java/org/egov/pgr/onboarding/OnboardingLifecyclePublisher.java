package org.egov.pgr.onboarding;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class OnboardingLifecyclePublisher {
    private final OnboardingRepository repository;
    private final OnboardingSteps steps;
    public OnboardingLifecyclePublisher(OnboardingRepository repository, OnboardingSteps steps) {
        this.repository = repository; this.steps = steps;
    }

    @Transactional
    public void publishPending() {
        for (OnboardingOperation operation : repository.pendingPublications(System.currentTimeMillis())) {
            try {
                if ("FAILED".equals(operation.getLifecycleDecision()) && operation.isOrganizationEnsureStarted()) {
                    // An HTTP timeout can hide a successful ensure. Reconcile the exact current
                    // attempt before publishing, including attempts after a historical restart.
                    try {
                        steps.ensureOrganization(repository.findSignup(operation.getSignupId()).orElseThrow(), operation);
                    } catch (OnboardingFailure failure) {
                        if ("ATTEMPT_STALE".equals(failure.getCode())) throw failure;
                        // A replacement create can collide permanently, and a replay after
                        // FAILED was accepted returns LIFECYCLE_CONFLICT. The BFF can settle
                        // the matching pending restart on the old organization. Always try
                        // publication; an absent initial organization remains unacknowledged.
                    }
                }
                steps.publish(operation);
                repository.acknowledgePublication(operation, System.currentTimeMillis());
            } catch (OnboardingFailure e) {
                if ("ATTEMPT_STALE".equals(e.getCode())) repository.acknowledgePublication(operation, System.currentTimeMillis());
                else repository.deferPublication(operation, System.currentTimeMillis());
            }
        }
    }
}
