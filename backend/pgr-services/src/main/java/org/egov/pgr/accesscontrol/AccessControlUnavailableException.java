package org.egov.pgr.accesscontrol;

/**
 * The PEP could not obtain a trustworthy decision from egov-accesscontrol — the call itself failed
 * (network error, non-2xx, malformed payload), or a response came back but is malformed/incomplete
 * (a required decision/scope is missing or unparseable). Both are treated identically: PGR has no
 * safe access decision to enforce, so every caller of this exception fails the request closed
 * (mapped to HTTP 503) rather than guessing. Never treated as "no policy configured, allow".
 */
public class AccessControlUnavailableException extends RuntimeException {
    public AccessControlUnavailableException(String message) {
        super(message);
    }

    public AccessControlUnavailableException(String message, Throwable cause) {
        super(message, cause);
    }
}
