package org.egov.pgr.analytics;

import lombok.Getter;

/**
 * egov-accesscontrol did not grant the caller this analytics action. A confident answer, not a
 * failure to get one — mapped to HTTP 403, distinct from the 503 an unreachable accesscontrol
 * produces, because "you may not" and "we could not find out" send a user to different remedies.
 */
@Getter
public class AnalyticsAccessDeniedException extends RuntimeException {

    private final String action;

    public AnalyticsAccessDeniedException(String action) {
        super("action '" + action + "' is not granted to this caller at this tenant");
        this.action = action;
    }
}
