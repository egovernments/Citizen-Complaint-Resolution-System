package org.egov.pgr.util;

import com.fasterxml.jackson.databind.JsonNode;

/** Shared interpretation of nullable/legacy HRMS activity flags used by scope projections. */
public final class HrmsScopeSemantics {

    private HrmsScopeSemantics() {
    }

    /** Legacy assignments without an explicit flag remain current, matching PGR scope resolution. */
    public static boolean isCurrentAssignment(JsonNode assignment) {
        return assignment != null && assignment.path("isCurrentAssignment").asBoolean(true);
    }

    /** A missing or null activity flag remains active; only an explicit false disables the row. */
    public static boolean isActiveJurisdiction(JsonNode jurisdiction) {
        return jurisdiction != null && jurisdiction.path("isActive").asBoolean(true);
    }
}
