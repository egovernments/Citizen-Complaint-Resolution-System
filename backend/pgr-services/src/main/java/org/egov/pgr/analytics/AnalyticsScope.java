package org.egov.pgr.analytics;

import java.util.List;

/**
 * Server-resolved RBAC scope derived from JWT claims.
 * NEVER taken from the request body.
 */
public final class AnalyticsScope {

    public final String tenantId;
    public final boolean tenantStateLevel;
    public final String citizenUuid;    // non-null => restrict to this account
    public final String boundaryPrefix; // non-null => boundary_path LIKE prefix||'%'

    private AnalyticsScope(String tenantId, boolean stateLevel,
                           String citizenUuid, String boundaryPrefix) {
        this.tenantId = tenantId;
        this.tenantStateLevel = stateLevel;
        this.citizenUuid = citizenUuid;
        this.boundaryPrefix = boundaryPrefix;
    }

    public static AnalyticsScope resolve(String userId, List<String> roles,
                                         String tenantId, int stateLevelLen) {
        boolean stateLevel = tenantId != null && tenantId.split("\\.").length == stateLevelLen;

        boolean isCitizen = roles == null || roles.stream()
                .noneMatch(r -> r.equalsIgnoreCase("EMPLOYEE")
                        || r.equalsIgnoreCase("GRO_EMPLOYEE")
                        || r.equalsIgnoreCase("DGRO"));

        // pure citizen sees only their own records
        String citizenUuid = isCitizen ? userId : null;

        return new AnalyticsScope(tenantId, stateLevel, citizenUuid, null);
    }
}
