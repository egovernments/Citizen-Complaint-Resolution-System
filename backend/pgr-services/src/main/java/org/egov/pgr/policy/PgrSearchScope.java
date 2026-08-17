package org.egov.pgr.policy;

import java.util.List;

/**
 * Server-resolved RBAC scope for PGR complaint search — a pure value object ("ScopeSpec").
 * Deliberately separate from {@code org.egov.pgr.analytics.AnalyticsScope} (Dashboard/Analytics'
 * own scope object, which additionally carries a {@code boundaryPrefix} axis PGR search doesn't
 * use): coding PGR search's ABAC scoping into Dashboard's existing class would couple two
 * independently-evolving consumers through one shared type — see {@link PolicyDrivenScopeResolver}
 * and {@link PrincipalScopeResolver}'s Javadoc for why the two resolvers are kept apart the same
 * way. It is NEVER taken from the request body; it is produced by {@link PolicyDrivenScopeResolver}
 * from the authenticated userInfo + tenantId + the MDMS-authored {@link ScopePolicy}. Clients can
 * only narrow within this, never widen.
 *
 * Fields (all "null/empty = no restriction on this axis"):
 * - tenant scope:      always applied (LIKE prefix at state level, = at city level).
 * - citizenUuid:       a pure CITIZEN sees only their own complaints (account_id = their uuid).
 * - departmentCodes:   an employee is restricted to the union of their HRMS assignment departments.
 * - jurisdictionCodes: an employee is restricted to the union of their HRMS jurisdiction (boundary)
 *                      assignments, exact-matched against a complaint's address locality.
 */
public final class PgrSearchScope {
    public final String tenantId;
    public final boolean tenantStateLevel;
    public final String citizenUuid;              // nullable: set => restrict to this account
    public final List<String> departmentCodes;    // nullable/empty => no department restriction
    public final List<String> jurisdictionCodes;  // nullable/empty => no jurisdiction restriction

    public PgrSearchScope(String tenantId, boolean tenantStateLevel, String citizenUuid,
                           List<String> departmentCodes, List<String> jurisdictionCodes) {
        this.tenantId = tenantId;
        this.tenantStateLevel = tenantStateLevel;
        this.citizenUuid = citizenUuid;
        this.departmentCodes = departmentCodes;
        this.jurisdictionCodes = jurisdictionCodes;
    }

    /**
     * The ONLY way a caller may skip RBAC scoping in {@code PGRQueryBuilder}. A {@code null}
     * scope on a scoped search/count path is a bug, not an authorization decision — it used to
     * silently mean "unrestricted," which is exactly the hole a missed scope-resolution call
     * would fall into. Approved unrestricted callers (plainSearch, internal fetch-by-id/
     * update-reconciliation) must pass this sentinel explicitly instead of {@code null}.
     */
    public static final PgrSearchScope UNRESTRICTED = new PgrSearchScope(null, false, null, null, null);
}
