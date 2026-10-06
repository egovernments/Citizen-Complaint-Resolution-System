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
    /** A write capability is usable only while its persisted operation lease still owns this signup. */
    public WriteScope writeScope(OnboardingSignup signup, String step) {
        if (!operation.getSignupId().equals(signup.getId())) throw new OnboardingFailure("SIGNUP_WRITE_SCOPE_DENIED", false);
        return new WriteScope(repository, operation.getId(), signup.getId(), operation.getRestartNo(), token,
                signup.getRequestedTenantId(), step);
    }

    public static final class WriteScope {
        private final OnboardingRepository repository;
        private final UUID operationId, signupId, token;
        private final int restartNo;
        private final String tenant, step;
        private WriteScope(OnboardingRepository repository, UUID operationId, UUID signupId, int restartNo,
                           UUID token, String tenant, String step) {
            this.repository=repository; this.operationId=operationId; this.signupId=signupId;
            this.restartNo=restartNo; this.token=token; this.tenant=tenant; this.step=step;
        }
        String tenant() { return tenant; }
        String step() { return step; }
        UUID signupId() { return signupId; }
        void requireLiveLease() {
            if (!repository.authorizesSignupWrite(operationId, signupId, restartNo, token, tenant, step, System.currentTimeMillis()))
                throw new OnboardingFailure("ONBOARDING_LEASE_LOST", true);
        }
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
