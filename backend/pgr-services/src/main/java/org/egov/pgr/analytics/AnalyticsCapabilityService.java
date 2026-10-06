package org.egov.pgr.analytics;

import lombok.extern.slf4j.Slf4j;
import org.egov.common.contract.request.RequestInfo;
import org.egov.pgr.policy.AccessPolicyRegistry;
import org.egov.pgr.util.RoleCodes;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.LinkedHashSet;
import java.util.Set;

/**
 * Resolves the caller's analytics capabilities through the existing ABAC registry.
 *
 * <p>Each capability is one role-scoped action lookup against egov-accesscontrol, which the
 * registry caches per (tenant, url, role set) — so the nine questions cost one round trip each on a
 * cold cache and none afterwards, and the answers come from the same role-action master that
 * governs complaint search.
 */
@Service
@Slf4j
public class AnalyticsCapabilityService {

    private final AccessPolicyRegistry registry;

    @Autowired
    public AnalyticsCapabilityService(AccessPolicyRegistry registry) {
        this.registry = registry;
    }

    /**
     * @throws org.egov.pgr.policy.AccessControlUnavailableException accesscontrol could not be
     *         consulted; the caller fails the request closed rather than rendering an empty
     *         dashboard that looks like a permission problem.
     */
    public AnalyticsCapabilities resolve(RequestInfo requestInfo, String tenantId) {
        // A caller with no roles holds no grant — that is a denial, not an outage. The registry
        // refuses such a lookup outright (correctly: it cannot ask a role-scoped question with no
        // roles), but letting that surface from here would answer an anonymous request to an
        // employee endpoint with 503 "service unavailable" instead of 403. Same fail-closed
        // outcome, honest status.
        if (RoleCodes.normalize(requestInfo).isEmpty()) {
            log.debug("analytics: caller presents no roles at tenant {} — no capability granted", tenantId);
            return AnalyticsCapabilities.of(Set.of());
        }

        // One call, not nine: the underlying accesscontrol lookup returns the caller's whole
        // role-scoped action list anyway, so asking per url would fetch the same payload nine times
        // — on an endpoint the employee home card hits for every employee.
        Set<String> reachable = registry.visibleActionUrls(requestInfo, tenantId);
        Set<String> granted = new LinkedHashSet<>();
        for (String actionUrl : AnalyticsCapabilities.ALL)
            if (reachable.contains(actionUrl))
                granted.add(actionUrl);

        if (granted.isEmpty())
            log.info("analytics: no capability granted at tenant {} — check ACCESSCONTROL-ROLEACTIONS "
                    + "for actions 2640-2648 before assuming the caller is simply unauthorized", tenantId);
        return AnalyticsCapabilities.of(granted);
    }
}
