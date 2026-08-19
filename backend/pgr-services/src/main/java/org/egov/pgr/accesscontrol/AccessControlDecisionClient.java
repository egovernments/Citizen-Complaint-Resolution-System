package org.egov.pgr.accesscontrol;

import lombok.extern.slf4j.Slf4j;
import org.egov.common.contract.request.RequestInfo;
import org.egov.pgr.config.PGRConfiguration;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * Typed client for egov-accesscontrol's two PDP endpoints, matching its own
 * {@code org.egov.access.web.contract.policy} wire contract field-for-field. This is the ONLY way
 * pgr-services asks "what is allowed" — it does not parse policies, combine roles, evaluate
 * JsonLogic, or fetch action documents; it POSTs a request, gets back typed decisions, validates
 * that they correlate cleanly with what was asked, and hands them to the caller unmodified.
 *
 * <p>Deliberately does NOT use {@code ServiceRequestRepository#fetchResult}: that helper SWALLOWS a
 * generic connection failure and returns {@code null} (fine for a best-effort MDMS lookup, wrong
 * here — an unreachable PDP must fail the request closed, never be read as "no decision"). Every
 * failure mode here — network error, non-2xx, a response body that won't deserialize, a successful
 * response with no usable decisions/results, or one that is missing/duplicate/unexpected relative to
 * what was requested — surfaces as {@link AccessControlUnavailableException}, uniformly, so every
 * caller's fail-closed handling is the same regardless of which of those actually happened.
 */
@Component
@Slf4j
public class AccessControlDecisionClient {

    private final RestTemplate restTemplate;
    private final PGRConfiguration config;

    @Autowired
    public AccessControlDecisionClient(RestTemplate restTemplate, PGRConfiguration config) {
        this.restTemplate = restTemplate;
        this.config = config;
    }

    /**
     * Resolves one {@link PolicyDecision} per {@code actions} entry. Validates the response's
     * {@code decisions} against {@code actions} by {@code key}: no duplicates, no entries for a key
     * that was never requested. A key that was requested but is ABSENT from the response is NOT
     * validated here — callers decide per key whether that is a hard failure (a single required
     * action) or a tolerable exclusion (bulk catalog visibility); see
     * {@link PolicyResolveResponse#decisionFor}.
     */
    public PolicyResolveResponse resolve(RequestInfo requestInfo, String tenantId, List<ActionQuery> actions) {
        if (actions == null || actions.isEmpty())
            throw new IllegalArgumentException("actions must not be empty");

        Set<String> requestedKeys = new LinkedHashSet<>();
        for (ActionQuery action : actions) {
            if (action == null || action.getKey() == null)
                throw new IllegalArgumentException("every ActionQuery must have a key");
            if (!requestedKeys.add(action.getKey()))
                throw new IllegalArgumentException("duplicate ActionQuery key in one resolve() call: " + action.getKey());
        }

        PolicyResolveRequest request = PolicyResolveRequest.builder()
                .requestInfo(requestInfo)
                .tenantId(tenantId)
                .actions(actions)
                .build();

        String url = config.getAccessControlHost() + config.getAccessControlResolvePath();
        PolicyResolveResponse response = post(url, request, PolicyResolveResponse.class, requestedKeys.toString());
        if (response.getDecisions() == null)
            throw new AccessControlUnavailableException(
                    "access-control _resolve returned no 'decisions' for actions=" + requestedKeys + " tenant=" + tenantId);

        Set<String> seenKeys = new HashSet<>();
        for (PolicyDecision decision : response.getDecisions()) {
            if (decision == null || decision.getKey() == null)
                throw new AccessControlUnavailableException(
                        "access-control _resolve response contains a decision with no key (tenant=" + tenantId + ")");
            if (!seenKeys.add(decision.getKey()))
                throw new AccessControlUnavailableException(
                        "access-control _resolve response contains a duplicate decision for key '" + decision.getKey() + "'");
            if (!requestedKeys.contains(decision.getKey()))
                throw new AccessControlUnavailableException(
                        "access-control _resolve response contains an unexpected decision for key '" + decision.getKey()
                                + "' that was never requested");
        }
        return response;
    }

    /**
     * Bulk resource decisions for one action + the page of rows about to be returned.
     * {@code resources} must be non-empty — callers only reach here once a fetch produced rows to
     * evaluate; there is nothing to short-circuit before that point. Validates the response's
     * {@code results} against {@code resources} by {@code id}: no duplicates, no entries for an id
     * that was never submitted. An id that was submitted but is ABSENT from {@code results} is the
     * caller's problem (treated as denied — see {@link ResourceEvaluationResponse#resultFor}), not
     * this client's.
     *
     * @throws AccessControlUnavailableException if the call fails, the response carries no usable
     *         {@code decision}/{@code results} at all, or results are duplicate/unexpected.
     */
    public ResourceEvaluationResponse evaluateResources(RequestInfo requestInfo, String tenantId, ActionQuery action,
                                                          List<ResourceInput> resources) {
        if (action == null || action.getKey() == null)
            throw new IllegalArgumentException("action must be set with a key");
        if (resources == null || resources.isEmpty())
            throw new IllegalArgumentException("resources must not be empty");

        Set<String> requestedIds = new LinkedHashSet<>();
        for (ResourceInput resource : resources) {
            if (resource == null || resource.getId() == null)
                throw new IllegalArgumentException("every ResourceInput must have an id");
            if (!requestedIds.add(resource.getId()))
                throw new IllegalArgumentException("duplicate ResourceInput id in one evaluateResources() call: " + resource.getId());
        }

        ResourceEvaluationRequest request = ResourceEvaluationRequest.builder()
                .requestInfo(requestInfo)
                .tenantId(tenantId)
                .action(action)
                .resources(resources)
                .build();

        String url = config.getAccessControlHost() + config.getAccessControlEvaluatePath();
        ResourceEvaluationResponse response = post(url, request, ResourceEvaluationResponse.class,
                action.getKey() + " (" + requestedIds.size() + " resources)");
        if (response.getDecision() == null || response.getResults() == null)
            throw new AccessControlUnavailableException(
                    "access-control resources/_evaluate returned no usable decision/results for action="
                            + action.getKey() + " tenant=" + tenantId);
        // The action-level decision must echo back the SAME action we submitted — a mismatched or
        // missing key means the response can't be trusted to be about the action PGR actually asked
        // about, wire-contract correlation, not a policy judgment.
        if (response.getDecision().getKey() == null || !response.getDecision().getKey().equals(action.getKey()))
            throw new AccessControlUnavailableException(
                    "access-control resources/_evaluate action-level decision key '" + response.getDecision().getKey()
                            + "' does not match the submitted action '" + action.getKey() + "'");

        Set<String> seenIds = new HashSet<>();
        for (ResourceDecision result : response.getResults()) {
            if (result == null || result.getId() == null)
                throw new AccessControlUnavailableException(
                        "access-control resources/_evaluate response contains a result with no id (action=" + action.getKey() + ")");
            if (!seenIds.add(result.getId()))
                throw new AccessControlUnavailableException(
                        "access-control resources/_evaluate response contains a duplicate result for id '" + result.getId() + "'");
            if (!requestedIds.contains(result.getId()))
                throw new AccessControlUnavailableException(
                        "access-control resources/_evaluate response contains an unexpected result for id '" + result.getId()
                                + "' that was never submitted");
            validateObligations(result, action.getKey());
        }
        return response;
    }

    /**
     * A field obligation exists specifically to hide a field the caller may not see. A null/blank
     * {@code path} can't be applied — and silently skipping it (rather than failing the request)
     * would leave that field exposed with whatever value it already has, exactly the leak an
     * obligation exists to prevent. A duplicate path is equally untrustworthy: PGR cannot tell which
     * of two obligations for the same field is authoritative. Both fail the WHOLE request closed,
     * before any masking is attempted — this is wire-contract validation, not policy evaluation.
     */
    private void validateObligations(ResourceDecision result, String actionKey) {
        if (result.getObligations() == null)
            throw new AccessControlUnavailableException(
                    "access-control resources/_evaluate result for id '" + result.getId() + "' (action=" + actionKey
                            + ") carries a null obligations list");
        Set<String> seenPaths = new HashSet<>();
        for (FieldObligation obligation : result.getObligations()) {
            if (obligation == null || obligation.getPath() == null || obligation.getPath().isBlank())
                throw new AccessControlUnavailableException(
                        "access-control resources/_evaluate result for id '" + result.getId() + "' (action=" + actionKey
                                + ") carries a field obligation with no usable path — cannot safely mask, failing closed");
            if (!seenPaths.add(obligation.getPath()))
                throw new AccessControlUnavailableException(
                        "access-control resources/_evaluate result for id '" + result.getId() + "' (action=" + actionKey
                                + ") carries duplicate obligations for path '" + obligation.getPath() + "'");
        }
    }

    private <T> T post(String url, Object body, Class<T> responseType, String context) {
        try {
            T response = restTemplate.postForObject(url, body, responseType);
            if (response == null)
                throw new AccessControlUnavailableException("access-control returned an empty body for " + context + " at " + url);
            return response;
        } catch (AccessControlUnavailableException e) {
            throw e;
        } catch (org.springframework.web.client.HttpStatusCodeException e) {
            // A 401 from the PDP is an answer, not an outage: the caller's token is invalid or
            // expired. Relaying it as 503 would tell the user the service is broken when what they
            // actually need is to sign in again.
            if (e.getStatusCode().value() == 401)
                throw new AuthenticationRequiredException(
                        "access-control rejected the caller's token for " + context, e);
            log.error("AccessControlDecisionClient: call to {} failed for {} with status {} — failing closed",
                    url, context, e.getStatusCode().value(), e);
            throw new AccessControlUnavailableException("access-control call failed for " + context + " at " + url, e);
        } catch (RuntimeException e) {
            log.error("AccessControlDecisionClient: call to {} failed for {} — failing closed", url, context, e);
            throw new AccessControlUnavailableException("access-control call failed for " + context + " at " + url, e);
        }
    }
}
