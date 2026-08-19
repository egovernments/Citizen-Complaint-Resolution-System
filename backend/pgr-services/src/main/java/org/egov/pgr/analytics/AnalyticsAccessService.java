package org.egov.pgr.analytics;

import lombok.extern.slf4j.Slf4j;
import org.egov.common.contract.request.RequestInfo;
import org.egov.pgr.accesscontrol.AccessControlDecisionClient;
import org.egov.pgr.accesscontrol.AccessControlUnavailableException;
import org.egov.pgr.accesscontrol.ActionQuery;
import org.egov.pgr.accesscontrol.PgrRowScope;
import org.egov.pgr.accesscontrol.PolicyDecision;
import org.egov.pgr.accesscontrol.PolicyResolveResponse;
import org.egov.pgr.accesscontrol.ResolvedScope;
import org.egov.pgr.accesscontrol.ScopeEffect;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;

/**
 * The analytics PEP's single conversation with the PDP.
 *
 * <p>One {@code _resolve} call per request settles all nine analytics actions at once, so every
 * endpoint in a request sees one consistent answer and the dashboard's bootstrap costs the same as
 * any other call. The alternative — resolving each capability where it happens to be needed — makes
 * a page load fan out into nine round trips and lets two of them disagree if policy changes between
 * them.
 *
 * <p>Nothing is interpreted here. A capability is granted because the PDP said {@code allowed}; the
 * row scope is whatever {@link PgrRowScope#from} could map out of the decision; neither is combined
 * with a role, a tenant guess or a local default.
 */
@Service
@Slf4j
public class AnalyticsAccessService {

    private static final String RESOURCE_TYPE_COMPLAINT = "complaint";

    private final AccessControlDecisionClient client;

    @Autowired
    public AnalyticsAccessService(AccessControlDecisionClient client) {
        this.client = client;
    }

    /**
     * Resolves every analytics capability plus the base row scope for one authenticated caller.
     *
     * @throws org.egov.pgr.accesscontrol.AuthenticationRequiredException the token is invalid (401)
     * @throws AccessControlUnavailableException the PDP could not be consulted, or answered with a
     *         base decision PGR cannot enforce (503)
     */
    public AnalyticsAccess resolve(RequestInfo requestInfo, String tenantId) {
        List<ActionQuery> actions = new ArrayList<>(AnalyticsAccess.ALL_ACTIONS.size());
        for (String url : AnalyticsAccess.ALL_ACTIONS)
            actions.add(ActionQuery.builder()
                    .key(url)
                    .method("POST")
                    .url(url)
                    // Only the base query action carries a row scope; asking for the complaint
                    // resource type on the others would invite a scope PGR has nowhere to apply.
                    .resourceType(AnalyticsAccess.QUERY.equals(url) ? RESOURCE_TYPE_COMPLAINT : null)
                    .build());

        PolicyResolveResponse response = client.resolve(requestInfo, tenantId, actions);

        Set<String> capabilities = new LinkedHashSet<>();
        for (String url : AnalyticsAccess.ALL_ACTIONS) {
            Optional<PolicyDecision> decision = response.decisionFor(url);
            // A decision that never came back is not a grant. The client has already rejected
            // duplicated and unrequested keys, so an absent one means the PDP declined to speak
            // about this action — which is not the same as allowing it.
            if (decision.isPresent() && decision.get().isAllowed())
                capabilities.add(url);
        }

        Optional<PolicyDecision> queryDecision = response.decisionFor(AnalyticsAccess.QUERY);
        if (queryDecision.isEmpty() || !queryDecision.get().isAllowed()) {
            // No base grant means no rows will ever be read: every endpoint that touches data
            // requires QUERY, and the ones that don't never look at the scope.
            log.debug("analytics: caller has no {} grant at tenant {} - no row scope resolved",
                    AnalyticsAccess.QUERY, tenantId);
            return AnalyticsAccess.of(capabilities, true, null);
        }

        ResolvedScope scope = queryDecision.get().getScope();
        if (scope == null || scope.getEffect() == null)
            throw new AccessControlUnavailableException("allowed decision for " + AnalyticsAccess.QUERY
                    + " tenant=" + tenantId + " carries no usable scope/effect");
        if (scope.getEffect() == ScopeEffect.DENY)
            return AnalyticsAccess.of(capabilities, true, null);

        return AnalyticsAccess.of(capabilities, false, PgrRowScope.from(scope));
    }
}
