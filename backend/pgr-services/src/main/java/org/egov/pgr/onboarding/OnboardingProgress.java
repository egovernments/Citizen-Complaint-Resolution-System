package org.egov.pgr.onboarding;

import java.util.UUID;
import java.util.function.BooleanSupplier;

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
        UUID operationId = operation.getId(), signupId = signup.getId(); int restartNo = operation.getRestartNo();
        String tenant = signup.getRequestedTenantId();
        return new WriteScope(signupId, tenant, step, () -> repository.authorizesSignupWrite(operationId, signupId, restartNo, token,
                tenant, step, System.currentTimeMillis()));
    }

    public static final class WriteScope {
        private final UUID signupId;
        private final String tenant, step;
        private final BooleanSupplier liveLease;
        /** liveLease re-reads the persisted lease that grants this scope; it is checked around every write. */
        WriteScope(UUID signupId, String tenant, String step, BooleanSupplier liveLease) {
            this.signupId=signupId; this.tenant=tenant; this.step=step; this.liveLease=liveLease;
        }
        String tenant() { return tenant; }
        String step() { return step; }
        UUID signupId() { return signupId; }
        void requireLiveLease() {
            if (!liveLease.getAsBoolean()) throw new OnboardingFailure("ONBOARDING_LEASE_LOST", true);
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
