package org.egov.pgr.policy;

/**
 * Thrown when the egov-accesscontrol call itself fails (network error, non-2xx response, malformed
 * payload) — distinct from a confirmed, successful "no action visible" result. {@link
 * AccessPolicyRegistry} needs this distinction: a confirmed absence of policy configuration is
 * backward-compatible (allow), but an inability to even ASK accesscontrol must still fail closed —
 * treating an outage as "no policy defined" would fail the whole tenant open during an incident.
 */
public class AccessControlUnavailableException extends RuntimeException {
    public AccessControlUnavailableException(String message) {
        super(message);
    }

    public AccessControlUnavailableException(String message, Throwable cause) {
        super(message, cause);
    }
}
