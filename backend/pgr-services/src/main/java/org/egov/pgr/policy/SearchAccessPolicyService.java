package org.egov.pgr.policy;

import lombok.extern.slf4j.Slf4j;
import org.egov.common.contract.request.RequestInfo;
import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.web.models.ServiceWrapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.util.CollectionUtils;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Tier-2 PDP for the reference access-control rule: a citizen sees only their own complaints, an
 * employee sees only their department's complaints. Reuses {@link PolicyDrivenScopeResolver} (a
 * {@link ScopePolicy}-driven resolver, kept separate from Dashboard/Analytics' own
 * {@code PrincipalScopeResolver} — see that class' Javadoc) instead of re-deriving HRMS lookups,
 * and re-checks the fetched page against the real JsonLogic condition registered in
 * {@link AccessPolicyRegistry} — the actual "runtime-evaluated JSON policy" from the design doc.
 *
 * This is deliberately PGR-search-specific for now (per the current implementation scope); a
 * generic, contract-agnostic version of this belongs in a shared accesscontrol/gateway policy
 * library later.
 */
@Component
@Slf4j
public class SearchAccessPolicyService {

    /**
     * In-code fallback when MDMS has no {@code resource.complaint.scope} configured for this action
     * — reproduces PGR search's structural default (jurisdiction-based, department not part of its
     * row-scoping model) via the SAME {@link ScopePolicyEngine} the MDMS-authored path uses, so
     * "not configured" and "configured to match today's default" behave identically.
     */
    private static final ScopePolicy DEFAULT_SCOPE_POLICY = ScopePolicy.of(
            List.of("department", "jurisdiction"),
            Map.of("department", ScopeLevel.ALL, "jurisdiction", ScopeLevel.OWN));

    private final PolicyDrivenScopeResolver policyDrivenScopeResolver;
    private final AccessPolicyRegistry registry;
    private final PolicyEvaluator evaluator;
    private final PolicyInputBuilder inputBuilder;
    private final PGRConfiguration config;

    @Autowired
    public SearchAccessPolicyService(PolicyDrivenScopeResolver policyDrivenScopeResolver, AccessPolicyRegistry registry,
                                      PolicyEvaluator evaluator, PolicyInputBuilder inputBuilder, PGRConfiguration config) {
        this.policyDrivenScopeResolver = policyDrivenScopeResolver;
        this.registry = registry;
        this.evaluator = evaluator;
        this.inputBuilder = inputBuilder;
        this.config = config;
    }

    /**
     * Fetches the MDMS-authored {@code resource.complaint.scope} for this action, then resolves the
     * caller's scope against it via {@link PolicyDrivenScopeResolver}. When no scope is configured:
     * {@code count()} never calls {@link #enforce} (Tier-2) the way {@code search()} does — a SQL
     * {@code COUNT} can't cheaply apply a per-row JsonLogic condition — so without this, a tenant
     * still on a hand-authored (pre-scope-block) {@code condition} could get a {@code count()} that
     * disagrees with what {@code search()} actually returns for the same criteria. Once
     * {@link PGRConfiguration#isAbacStrictMode()} is enabled, Tier-1 (this) and Tier-2
     * ({@code AccessPolicyRegistry#getCondition}) deny IDENTICALLY instead — the same explicit
     * rollout gate, applied uniformly to both tiers so {@code count()} and {@code search()} can
     * never disagree once a deployment has opted in. With the gate off (today's default), this
     * still falls back to {@link #DEFAULT_SCOPE_POLICY}, same as before.
     */
    public PgrSearchScope resolveScope(RequestInfo requestInfo, String tenantId, int stateLevelLen) {
        Optional<ScopePolicy> scopePolicy = registry.getScopePolicy(AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL, requestInfo, tenantId, "complaint");
        if (scopePolicy.isEmpty() && config.isAbacStrictMode()) {
            log.error("SearchAccessPolicyService: no resource.complaint.scope configured for url='{}' tenant='{}' — pgr.abac.strict-mode is enabled, failing closed (Tier-1, matching AccessPolicyRegistry#getCondition's Tier-2 fail-closed)",
                    AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL, tenantId);
            boolean stateLevel = tenantId != null && tenantId.split("\\.").length == stateLevelLen;
            return PgrSearchScope.deniedAll(tenantId, stateLevel);
        }
        return policyDrivenScopeResolver.resolve(requestInfo, tenantId, stateLevelLen, scopePolicy.orElse(DEFAULT_SCOPE_POLICY));
    }

    /**
     * Defense-in-depth re-check of the fetched page against the real JsonLogic condition (fetched
     * from the ACCESSCONTROL-ACTIONS-TEST.actions-test MDMS master for this action url + tenant).
     * The SQL-level scope (applied earlier, in the query builder) is what actually keeps result
     * counts and pagination correct; a row dropped here signals SQL/policy drift and is logged
     * loudly.
     */
    public List<ServiceWrapper> enforce(RequestInfo requestInfo, String tenantId, PgrSearchScope scope, List<ServiceWrapper> wrappers) {
        if (CollectionUtils.isEmpty(wrappers))
            return wrappers;

        String condition = registry.getCondition(AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL, requestInfo, tenantId);
        Map<String, Object> userDoc = inputBuilder.buildUserDoc(requestInfo, scope);

        List<ServiceWrapper> allowed = new ArrayList<>();
        for (ServiceWrapper wrapper : wrappers) {
            Map<String, Object> data = new LinkedHashMap<>();
            data.put("user", userDoc);
            data.put("resource", inputBuilder.buildResourceDoc(wrapper.getService()));

            if (evaluator.isAllowed(condition, data)) {
                allowed.add(wrapper);
            } else {
                log.warn("SearchAccessPolicyService: dropping complaint serviceRequestId={} — denied by policy '{}' for user uuid={} (SQL-level scope should already have excluded this; check for drift)",
                        wrapper.getService().getServiceRequestId(), AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL, userDoc.get("uuid"));
            }
        }
        return allowed;
    }
}
