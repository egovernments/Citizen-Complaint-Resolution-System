package org.egov.pgr.analytics;

import java.util.List;

/**
 * Server-resolved RBAC scope — a pure value object (a "ScopeSpec"). It is NEVER taken from the
 * request body; it is produced by {@link PrincipalScopeResolver} from the authenticated
 * userInfo + tenantId. Clients can only narrow within this, never widen.
 *
 * The seam: <b>how</b> this object is derived (HRMS today, a stored JsonLogic policy tomorrow)
 * lives entirely in {@link PrincipalScopeResolver}. <b>How</b> it is consumed (WHERE-clause
 * injection) lives entirely in {@link AnalyticsPlanner#applyScope}. Nothing downstream of the
 * resolver cares how the spec was derived, so a future policy-engine cutover is a one-method swap.
 *
 * Fields (all "null/empty = no restriction on this axis"):
 * - tenant scope:      always applied (LIKE prefix at state level, = at city level).
 * - departmentCodes:   an employee is restricted to the union of their HRMS assignment departments.
 *                      null/empty => no department restriction (admin / no-assignment => see all).
 * - boundaryPrefix:    the analytics module's own hierarchical jurisdiction axis (boundary_path
 *                      LIKE prefix%) — intentionally left unpopulated by {@link PrincipalScopeResolver}
 *                      today (see its comment); unrelated to {@link #jurisdictionCodes} below.
 * - citizenUuid:       a pure CITIZEN sees only their own complaints (account_id = their uuid).
 * - jurisdictionCodes: an employee is restricted to the union of their HRMS jurisdiction (boundary)
 *                      assignments, exact-matched against a complaint's address locality — the PGR
 *                      search policy's own jurisdiction axis (see the access-control policy design
 *                      doc), independent of the analytics module's boundaryPrefix mechanism above.
 *                      null/empty => no jurisdiction restriction.
 */
public final class AnalyticsScope {
    public final String tenantId;
    public final boolean tenantStateLevel;
    public final String citizenUuid;          // nullable: set => restrict to this account
    public final String boundaryPrefix;       // nullable: set => boundary_path LIKE prefix||'%'
    public final List<String> departmentCodes; // nullable/empty => no department restriction
    public final List<String> jurisdictionCodes; // nullable/empty => no jurisdiction restriction

    public AnalyticsScope(String tenantId, boolean tenantStateLevel, String citizenUuid,
                          String boundaryPrefix, List<String> departmentCodes) {
        this(tenantId, tenantStateLevel, citizenUuid, boundaryPrefix, departmentCodes, null);
    }

    public AnalyticsScope(String tenantId, boolean tenantStateLevel, String citizenUuid,
                          String boundaryPrefix, List<String> departmentCodes, List<String> jurisdictionCodes) {
        this.tenantId = tenantId;
        this.tenantStateLevel = tenantStateLevel;
        this.citizenUuid = citizenUuid;
        this.boundaryPrefix = boundaryPrefix;
        this.departmentCodes = departmentCodes;
        this.jurisdictionCodes = jurisdictionCodes;
    }
}
