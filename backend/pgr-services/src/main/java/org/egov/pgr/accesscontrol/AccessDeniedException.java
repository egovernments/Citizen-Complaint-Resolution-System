package org.egov.pgr.accesscontrol;

import lombok.Getter;

/**
 * egov-accesscontrol returned a well-formed, confident {@code allowed=false} for a base action
 * decision. Distinct from {@link AccessControlUnavailableException} (which means PGR could not get
 * a trustworthy answer at all) — this means the PDP DID answer, and the answer is no. Mapped to
 * HTTP 403 by every controller that can throw it.
 */
@Getter
public class AccessDeniedException extends RuntimeException {
    private final String action;

    public AccessDeniedException(String action, String reason) {
        super("action '" + action + "' denied" + (reason == null || reason.isBlank() ? "" : ": " + reason));
        this.action = action;
    }
}
