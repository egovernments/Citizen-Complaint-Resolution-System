package org.egov.pgr.onboarding;

import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;

@Slf4j
@Service
public class OnboardingLifecyclePublisher {
    /** Backoff caps near 4 minutes, so the 10th failure is roughly 8 minutes after the decision. */
    static final int STUCK_ATTEMPTS = 10;
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
                else repository.deferPublication(operation, System.currentTimeMillis())
                        .ifPresent(deferral -> logDeferral(operation, deferral, e));
            }
        }
    }

    /** One line per failed attempt; the backoff keeps this to a few per hour once a publication is stuck. */
    private void logDeferral(OnboardingOperation operation, OnboardingRepository.PublicationDeferral deferral, OnboardingFailure failure) {
        Object[] args = {operation.getId(), deferral.tenantId(), operation.getLifecycleDecision(), deferral.attempts(),
                Instant.ofEpochMilli(deferral.nextAttemptAt()), failure.getHttpStatus(), failure.getCode()};
        String detail = "operation={} tenant={} decision={} attempts={} nextAttemptAt={} httpStatus={} code={}";
        if (deferral.attempts() == STUCK_ATTEMPTS)
            log.error("Onboarding lifecycle publication is STUCK (an ACTIVE workspace stays hidden from its founder until "
                    + "the identity BFF accepts it); still retrying: " + detail, args);
        else log.warn("Onboarding lifecycle publication failed, will retry: " + detail, args);
    }
}
