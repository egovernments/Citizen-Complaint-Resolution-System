package org.egov.pgr.policy;

/**
 * Signals that an access-policy source returned a successful HTTP response whose body cannot be
 * interpreted as a valid policy document.
 */
public class MalformedPolicySourceResponseException extends RuntimeException {

    public MalformedPolicySourceResponseException(String message) {
        super(message);
    }

    public MalformedPolicySourceResponseException(String message, Throwable cause) {
        super(message, cause);
    }
}
