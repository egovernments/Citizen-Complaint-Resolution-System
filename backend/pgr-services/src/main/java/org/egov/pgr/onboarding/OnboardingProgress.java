package org.egov.pgr.onboarding;

import java.util.UUID;

/** An intent is durable before each remote write; lost leases cannot advance progress. */
public class OnboardingProgress {
    private final OnboardingRepository repository;
    private final OnboardingOperation operation;
    private final UUID token;
    public OnboardingProgress(OnboardingRepository repository, OnboardingOperation operation, UUID token) {
        this.repository = repository;
        this.operation = operation;
        this.token = token;
    }
    public void save() {
        if (!repository.checkpoint(operation, token, System.currentTimeMillis()))
            throw new OnboardingFailure("ONBOARDING_LEASE_LOST", true);
    }
    public void record(String key, Runnable action) {
        if ("DONE".equals(operation.getRecordProgress().get(key))) return;
        operation.getRecordProgress().put(key, "STARTED");
        save();
        action.run();
        operation.getRecordProgress().put(key, "DONE");
        save();
    }
}
