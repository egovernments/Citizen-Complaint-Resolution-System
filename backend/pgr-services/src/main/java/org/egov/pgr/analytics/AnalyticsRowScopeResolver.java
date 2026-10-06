package org.egov.pgr.analytics;

import lombok.extern.slf4j.Slf4j;
import org.egov.common.contract.request.RequestInfo;
import org.egov.pgr.policy.PgrSearchScope;
import org.egov.pgr.policy.ScopePolicyEngine;
import org.egov.pgr.policy.SearchAccessPolicyService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import java.util.List;

/**
 * The dashboard's row scope — which is now simply PGR search's row scope.
 *
 * <p>Analytics used to resolve its own, in {@code PrincipalScopeResolver}, from its own HRMS lookup
 * and its own hard-coded list of tenant-wide roles. That is why the two surfaces disagreed about
 * the same person: a ward-scoped GRO was correctly restricted on {@code /v2/request/_search} and
 * saw every ward on the dashboard, because the analytics resolver left the jurisdiction axis
 * unresolved on purpose. Two resolvers reading two different rule sets will always drift; the fix
 * is not to synchronise them but to delete one.
 *
 * <p>So this asks {@link SearchAccessPolicyService} for the scope authored on action 2008 —
 * the same call, the same MDMS policy, the same {@code PolicyDrivenScopeResolver} — and hands back
 * that object unchanged. Nothing here interprets a role, reads a policy or talks to HRMS.
 */
@Component
@Slf4j
public class AnalyticsRowScopeResolver {

    private final SearchAccessPolicyService complaintScopePolicy;
    private final KpiCatalogService catalog;

    @Autowired
    public AnalyticsRowScopeResolver(SearchAccessPolicyService complaintScopePolicy, KpiCatalogService catalog) {
        this.complaintScopePolicy = complaintScopePolicy;
        this.catalog = catalog;
    }

    /**
     * The scope action 2008 grants this caller, with the tenant's own department-scoping switch
     * applied on top.
     */
    public PgrSearchScope resolve(RequestInfo requestInfo, String tenantId, int stateLevelLen) {
        PgrSearchScope scope = complaintScopePolicy.resolveScope(requestInfo, tenantId, stateLevelLen);

        // #1280 is a tenant opt-out for deployments whose complaint data carries no departments at
        // all, so the axis would otherwise exclude every row. It is honoured here rather than left
        // behind with the resolver it used to live in, because dropping it silently would empty
        // those tenants' dashboards. It IS a second policy source, and folding it into action
        // 2008's own roleScopes is the right end state — tracked separately, not done here.
        //
        // It must never touch a DENIED scope. The engine expresses "this caller may see nothing"
        // as a department list holding one sentinel value, so a naive "drop the department axis"
        // would turn every deny — an unauthorized tenant, an unresolvable principal, strict mode
        // with no policy — into a fully unrestricted tenant-wide scope. The switch turns an axis
        // off; it does not overturn a decision.
        if (isDenied(scope))
            return scope;

        if (scope.departmentCodes != null && catalog.isDepartmentScopingDisabled(tenantId)) {
            log.info("department scoping disabled by DashboardConfig for tenant {} — dropping the department axis "
                    + "from the policy-resolved scope", tenantId);
            return new PgrSearchScope(scope.tenantId, scope.tenantStateLevel, scope.citizenUuid,
                    null, scope.jurisdictionCodes);
        }
        return scope;
    }

    /**
     * Whether this scope is the engine's deny-all. Recognised by the sentinel it carries rather
     * than by a flag, because that is how {@link PgrSearchScope#deniedAll} expresses it.
     */
    static boolean isDenied(PgrSearchScope scope) {
        return scope.departmentCodes != null
                && scope.departmentCodes.contains(ScopePolicyEngine.UNRESOLVED_SENTINEL);
    }

    /** The tenant-only scope the anonymous public dashboard runs under. Never an authored policy. */
    public static PgrSearchScope publicSurfaceScope(String tenantId, boolean stateLevel) {
        return new PgrSearchScope(tenantId, stateLevel, null, null, null);
    }

    /** Exposed for the parity suite: the raw policy scope, before the #1280 switch. */
    public PgrSearchScope resolveWithoutTenantOverrides(RequestInfo requestInfo, String tenantId, int stateLevelLen) {
        return complaintScopePolicy.resolveScope(requestInfo, tenantId, stateLevelLen);
    }

    /** Convenience for logs/tests. */
    static String describe(PgrSearchScope scope) {
        List<String> departments = scope.departmentCodes;
        List<String> jurisdictions = scope.jurisdictionCodes;
        return "tenant=" + scope.tenantId + (scope.tenantStateLevel ? "(subtree)" : "(exact)")
                + " citizen=" + scope.citizenUuid
                + " departments=" + (departments == null ? "ALL" : departments)
                + " jurisdictions=" + (jurisdictions == null ? "ALL" : jurisdictions);
    }
}
