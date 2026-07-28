package org.egov.pgr.policy;

import lombok.extern.slf4j.Slf4j;
import org.egov.common.contract.request.RequestInfo;
import org.egov.pgr.analytics.AnalyticsScope;
import org.egov.pgr.analytics.PrincipalScopeResolver;
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
 * employee sees only their department's complaints. Reuses {@link PrincipalScopeResolver} (the
 * existing analytics module's citizen/department scope resolver) instead of re-deriving HRMS
 * lookups, and re-checks the fetched page against the real JsonLogic condition registered in
 * {@link AccessPolicyRegistry} — the actual "runtime-evaluated JSON policy" from the design doc.
 *
 * This is deliberately PGR-search-specific for now (per the current implementation scope); a
 * generic, contract-agnostic version of this belongs in a shared accesscontrol/gateway policy
 * library later.
 */
@Component
@Slf4j
public class SearchAccessPolicyService {

    private final PrincipalScopeResolver principalScopeResolver;
    private final AccessPolicyRegistry registry;
    private final PolicyEvaluator evaluator;
    private final PolicyInputBuilder inputBuilder;

    @Autowired
    public SearchAccessPolicyService(PrincipalScopeResolver principalScopeResolver, AccessPolicyRegistry registry,
                                      PolicyEvaluator evaluator, PolicyInputBuilder inputBuilder) {
        this.principalScopeResolver = principalScopeResolver;
        this.registry = registry;
        this.evaluator = evaluator;
        this.inputBuilder = inputBuilder;
    }

    public AnalyticsScope resolveScope(RequestInfo requestInfo, String tenantId, int stateLevelLen) {
        return principalScopeResolver.resolve(requestInfo, tenantId, stateLevelLen);
    }

    /**
     * Defense-in-depth re-check of the fetched page against the real JsonLogic condition (fetched
     * from the ACCESSCONTROL-ACTIONS-TEST.actions-test MDMS master for this action url + tenant).
     * The SQL-level scope (applied earlier, in the query builder) is what actually keeps result
     * counts and pagination correct; a row dropped here signals SQL/policy drift and is logged
     * loudly.
     */
    public List<ServiceWrapper> enforce(RequestInfo requestInfo, String tenantId, AnalyticsScope scope, List<ServiceWrapper> wrappers) {
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
