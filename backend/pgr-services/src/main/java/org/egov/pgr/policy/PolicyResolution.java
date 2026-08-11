package org.egov.pgr.policy;

import java.util.Objects;
import java.util.Optional;

/**
 * Explicit result of resolving an action for one tenant and role set.
 *
 * <p>Callers must allow only {@link Status#RESOLVED}. Keeping unavailable, malformed, and
 * unauthorized outcomes distinct lets future field-masking consumers fail closed without
 * confusing a policy-system failure with an intentionally absent field rule.
 */
public final class PolicyResolution {

    public enum Status {
        RESOLVED,
        NOT_AUTHORIZED,
        SOURCE_UNAVAILABLE,
        INVALID_REQUEST,
        INVALID_POLICY
    }

    private final Status status;
    private final PolicyAction action;

    private PolicyResolution(Status status, PolicyAction action) {
        this.status = Objects.requireNonNull(status, "status");
        this.action = action;
        if ((status == Status.RESOLVED) != (action != null))
            throw new IllegalArgumentException("only a resolved result may contain an action");
    }

    public static PolicyResolution resolved(PolicyAction action) {
        return new PolicyResolution(Status.RESOLVED, Objects.requireNonNull(action, "action"));
    }

    public static PolicyResolution notAuthorized() {
        return new PolicyResolution(Status.NOT_AUTHORIZED, null);
    }

    public static PolicyResolution sourceUnavailable() {
        return new PolicyResolution(Status.SOURCE_UNAVAILABLE, null);
    }

    public static PolicyResolution invalidRequest() {
        return new PolicyResolution(Status.INVALID_REQUEST, null);
    }

    public static PolicyResolution invalidPolicy() {
        return new PolicyResolution(Status.INVALID_POLICY, null);
    }

    public Status status() {
        return status;
    }

    public Optional<PolicyAction> action() {
        return Optional.ofNullable(action);
    }

    public boolean isResolved() {
        return status == Status.RESOLVED;
    }
}
