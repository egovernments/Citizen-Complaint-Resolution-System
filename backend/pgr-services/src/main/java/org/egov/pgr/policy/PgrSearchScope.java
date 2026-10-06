package org.egov.pgr.policy;

import java.util.List;
import java.util.Set;

/**
 * Server-resolved ABAC scope for everything that reads complaints — a pure value object
 * ("ScopeSpec"), shared since #1050 by PGR complaint search and the employee dashboard. It began as
 * search's own type, kept apart from Dashboard's {@code AnalyticsScope} while the two engines
 * evolved independently; they no longer do, and one type for one authored policy is what stops the
 * two surfaces disagreeing about a caller. It is NEVER taken from the request body; it is produced
 * by {@link PolicyDrivenScopeResolver} from the authenticated userInfo + tenantId + the
 * MDMS-authored {@link ScopePolicy}. Clients can only narrow within this, never widen.
 *
 * Fields (all "null/empty = no restriction on this axis"):
 * - tenant scope:      always applied (LIKE prefix at state level, = at city level).
 * - citizenUuid:       a pure CITIZEN sees only their own complaints (account_id = their uuid).
 * - departmentCodes:   an employee is restricted to the union of their HRMS assignment departments.
 * - jurisdictionCodes: an employee is restricted to the union of their HRMS jurisdiction (boundary)
 *                      assignments — exact-matched against a complaint's address locality on the
 *                      search path, and matched as a segment of the '|'-joined boundary_path on the
 *                      analytics grains, which is the same test against a different storage shape.
 * - ownAssignedServiceRequestIds: complaints the caller currently holds, resolved server-side from
 *                      workflow history (never from the request) — the assignee named by the newest
 *                      transition that named anyone within the complaint's current state, so an
 *                      assignee-less COMMENT/ESCALATE does not drop the holder (see
 *                      {@code WorkflowService#getServiceRequestIdsByAssignee}). These are visible
 *                      even when they fall outside the department/jurisdiction axes — an employee
 *                      must always be able to see and act on what workflow has assigned to them.
 *                      They never relax the tenant or citizen-self axes, and never apply to a
 *                      {@link #denyAll} scope. Null/empty = no exception.
 * - denyAll:           an explicit deny-all decision ({@link #deniedAll}) — no identity, a tenant
 *                      outside the caller's subtree, strict mode with no policy. Nothing widens it.
 */
public final class PgrSearchScope {
    public final String tenantId;
    public final boolean tenantStateLevel;
    public final String citizenUuid;              // nullable: set => restrict to this account
    public final List<String> departmentCodes;    // nullable/empty => no department restriction
    public final List<String> jurisdictionCodes;  // nullable/empty => no jurisdiction restriction
    public final Set<String> ownAssignedServiceRequestIds; // nullable/empty => no own-assigned exception
    public final boolean denyAll;                 // true => an explicit deny-all decision, never loosened

    public PgrSearchScope(String tenantId, boolean tenantStateLevel, String citizenUuid,
                           List<String> departmentCodes, List<String> jurisdictionCodes) {
        this(tenantId, tenantStateLevel, citizenUuid, departmentCodes, jurisdictionCodes, null);
    }

    public PgrSearchScope(String tenantId, boolean tenantStateLevel, String citizenUuid,
                           List<String> departmentCodes, List<String> jurisdictionCodes,
                           Set<String> ownAssignedServiceRequestIds) {
        this(tenantId, tenantStateLevel, citizenUuid, departmentCodes, jurisdictionCodes, ownAssignedServiceRequestIds, false);
    }

    private PgrSearchScope(String tenantId, boolean tenantStateLevel, String citizenUuid,
                           List<String> departmentCodes, List<String> jurisdictionCodes,
                           Set<String> ownAssignedServiceRequestIds, boolean denyAll) {
        this.tenantId = tenantId;
        this.tenantStateLevel = tenantStateLevel;
        this.citizenUuid = citizenUuid;
        this.departmentCodes = departmentCodes;
        this.jurisdictionCodes = jurisdictionCodes;
        this.ownAssignedServiceRequestIds = denyAll ? null : ownAssignedServiceRequestIds;
        this.denyAll = denyAll;
    }

    /** True when the department or jurisdiction axis restricts this scope at all. */
    public boolean restrictsDepartmentOrJurisdiction() {
        return departmentCodes != null || jurisdictionCodes != null;
    }

    /**
     * Copy of this scope that also admits the caller's currently-assigned complaints. A deny-all
     * scope is returned unchanged: an assignment never overturns a deny decision.
     */
    public PgrSearchScope withOwnAssigned(Set<String> serviceRequestIds) {
        if (denyAll)
            return this;
        return new PgrSearchScope(tenantId, tenantStateLevel, citizenUuid, departmentCodes, jurisdictionCodes,
                serviceRequestIds);
    }

    /** Whether this complaint is one workflow currently assigns to the caller. */
    public boolean isOwnAssigned(String serviceRequestId) {
        return !denyAll && serviceRequestId != null && ownAssignedServiceRequestIds != null
                && ownAssignedServiceRequestIds.contains(serviceRequestId);
    }

    /**
     * The ONLY way a caller may skip RBAC scoping in {@code PGRQueryBuilder}. A {@code null}
     * scope on a scoped search/count path is a bug, not an authorization decision — it used to
     * silently mean "unrestricted," which is exactly the hole a missed scope-resolution call
     * would fall into. Approved unrestricted callers (plainSearch, internal fetch-by-id/
     * update-reconciliation) must pass this sentinel explicitly instead of {@code null}.
     */
    public static final PgrSearchScope UNRESTRICTED = new PgrSearchScope(null, false, null, null, null);

    /**
     * Fail-closed scope for a tenant/action with no resolvable policy — matches no real row
     * (the same {@link ScopePolicyEngine#UNRESOLVED_SENTINEL} used for a required-but-unresolvable
     * axis), regardless of the caller's role. Used by {@code SearchAccessPolicyService#resolveScope}
     * so Tier-1 (SQL, this scope) and Tier-2 ({@code AccessPolicyRegistry#getCondition}) deny
     * IDENTICALLY once {@code pgr.abac.strict-mode} is enabled — otherwise {@code count()} (which
     * only ever applies Tier-1) and {@code search()} (which applies both) could disagree.
     * Flagged {@link #denyAll} so no exception (e.g. own-assigned complaints) can loosen it.
     */
    public static PgrSearchScope deniedAll(String tenantId, boolean tenantStateLevel) {
        return new PgrSearchScope(tenantId, tenantStateLevel, null, List.of(ScopePolicyEngine.UNRESOLVED_SENTINEL), null,
                null, true);
    }
}
