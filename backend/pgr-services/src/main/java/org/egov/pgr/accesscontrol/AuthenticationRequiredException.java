package org.egov.pgr.accesscontrol;

/**
 * egov-accesscontrol rejected the caller's token outright — absent, expired or invalid.
 *
 * <p>Deliberately separate from both of its neighbours. It is not {@link AccessDeniedException}:
 * that means "we know who you are and you may not do this", whereas this means "we do not know who
 * you are", and answering 403 to an expired session leaves a UI with nothing to react to except a
 * permission error it cannot fix by re-authenticating. It is not
 * {@link AccessControlUnavailableException} either: the PDP answered, clearly, and telling a user
 * the service is down when their session simply expired sends them to the wrong remedy. Mapped to
 * HTTP 401.
 */
public class AuthenticationRequiredException extends RuntimeException {
    public AuthenticationRequiredException(String message) {
        super(message);
    }

    public AuthenticationRequiredException(String message, Throwable cause) {
        super(message, cause);
    }
}
