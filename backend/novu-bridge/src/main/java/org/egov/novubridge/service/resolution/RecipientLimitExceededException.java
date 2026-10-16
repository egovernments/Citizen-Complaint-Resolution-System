package org.egov.novubridge.service.resolution;

/**
 * Thrown by a {@link RecipientResolver} whose audience is larger than it will read. The resolver
 * refuses the whole event with NB_RECIPIENT_LIMIT_EXCEEDED: half a fan-out is worse than none.
 */
public class RecipientLimitExceededException extends RuntimeException {

    public RecipientLimitExceededException(String message) {
        super(message);
    }
}
