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
     * In-code fallback for a LEGACY tenant that still has a hand-authored {@code condition} on this
     * action but no {@code resource.complaint.scope} block — reproduces PGR search's old structural
     * default (jurisdiction-based, department not part of its row-scoping model) via the SAME
     * {@link ScopePolicyEngine} the MDMS-authored path uses. This must NOT be applied when the action
     * has neither a {@code scope} block NOR a {@code condition} at all — see
     * {@link #UNRESTRICTED_SCOPE_POLICY} and {@link AccessPolicyRegistry#isPolicyUnconfigured}.
     */
    private static final ScopePolicy DEFAULT_SCOPE_POLICY = ScopePolicy.of(
            List.of("department", "jurisdiction"),
            Map.of("department", ScopeLevel.ALL, "jurisdiction", ScopeLevel.OWN));

    /**
     * Tier-1 fallback when the action has genuinely nothing authored for it — no
     * {@code resource.complaint.scope} block AND no legacy {@code condition} either (see
     * {@link AccessPolicyRegistry#isPolicyUnconfigured}). Zero axes means {@link ScopePolicyEngine}
     * never restricts department or jurisdiction for anyone, matching Tier-2
     * ({@link AccessPolicyRegistry#getCondition}'s backward-compatible {@code true} for the same
     * "unconfigured" action) instead of silently imposing {@link #DEFAULT_SCOPE_POLICY}'s
     * jurisdiction requirement on a tenant that never configured ANY PGR search policy at all.
     * Citizen self-scoping and tenant/subtree authorization in
     * {@link PolicyDrivenScopeResolver#resolve} are unaffected — those are hardcoded, not
     * axis-driven, and still apply regardless of this policy.
     */
    private static final ScopePolicy UNRESTRICTED_SCOPE_POLICY = ScopePolicy.of(List.of(), Map.of());

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
     * falls back to {@link #DEFAULT_SCOPE_POLICY} only when the action has a legacy hand-authored
     * {@code condition} (some restriction was already intended); an action with NEITHER a
     * {@code scope} block NOR a {@code condition} — genuinely never configured — gets
     * {@link #UNRESTRICTED_SCOPE_POLICY} instead, matching Tier-2's backward-compatible allow for
     * the same case rather than silently requiring HRMS department/jurisdiction data nobody asked
     * for. See {@link AccessPolicyRegistry#isPolicyUnconfigured}.
     *
     * <p>Fetches the action exactly once via {@link AccessPolicyRegistry#resolveScopeState} — the
     * scope-policy-present check and the unconfigured fallback below used to be two independent
     * {@code AccessPolicyRegistry} calls, each capable of triggering its own
     * {@code /access/v1/actions/mdms/_get} round-trip on a cache miss (a "not found" action is never
     * cached), which was both a real double-fetch race and doubled hot-path load per search request.
     */
    public PgrSearchScope resolveScope(RequestInfo requestInfo, String tenantId, int stateLevelLen) {
        AccessPolicyRegistry.ScopeResolution resolution =
                registry.resolveScopeState(AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL, requestInfo, tenantId, "complaint");
        if (resolution.scopePolicy().isPresent())
            return policyDrivenScopeResolver.resolve(requestInfo, tenantId, stateLevelLen, resolution.scopePolicy().get());

        if (config.isAbacStrictMode()) {
            log.error("SearchAccessPolicyService: no resource.complaint.scope configured for url='{}' tenant='{}' — pgr.abac.strict-mode is enabled, failing closed (Tier-1, matching AccessPolicyRegistry#getCondition's Tier-2 fail-closed)",
                    AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL, tenantId);
            boolean stateLevel = tenantId != null && tenantId.split("\\.").length == stateLevelLen;
            return PgrSearchScope.deniedAll(tenantId, stateLevel);
        }

        ScopePolicy fallback = resolution.unconfigured() ? UNRESTRICTED_SCOPE_POLICY : DEFAULT_SCOPE_POLICY;
        return policyDrivenScopeResolver.resolve(requestInfo, tenantId, stateLevelLen, fallback);
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
