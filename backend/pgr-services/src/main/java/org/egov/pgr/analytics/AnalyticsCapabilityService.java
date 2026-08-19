package org.egov.pgr.analytics;

import lombok.extern.slf4j.Slf4j;
import org.egov.common.contract.request.RequestInfo;
import org.egov.pgr.policy.AccessPolicyRegistry;
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
        Set<String> granted = new LinkedHashSet<>();
        for (String actionUrl : AnalyticsCapabilities.ALL)
            if (registry.isActionVisible(actionUrl, requestInfo, tenantId))
                granted.add(actionUrl);

        if (granted.isEmpty())
            log.info("analytics: no capability granted at tenant {} — check ACCESSCONTROL-ROLEACTIONS "
                    + "for actions 2640-2648 before assuming the caller is simply unauthorized", tenantId);
        return AnalyticsCapabilities.of(granted);
    }
}
