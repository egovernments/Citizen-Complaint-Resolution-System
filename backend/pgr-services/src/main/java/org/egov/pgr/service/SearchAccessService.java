package org.egov.pgr.service;

import com.fasterxml.jackson.databind.JsonNode;
import lombok.extern.slf4j.Slf4j;
import org.egov.common.contract.request.RequestInfo;
import org.egov.pgr.accesscontrol.AccessControlDecisionClient;
import org.egov.pgr.accesscontrol.AccessControlUnavailableException;
import org.egov.pgr.accesscontrol.AccessDeniedException;
import org.egov.pgr.accesscontrol.ActionQuery;
import org.egov.pgr.accesscontrol.FieldObligation;
import org.egov.pgr.accesscontrol.MaskingStrategy;
import org.egov.pgr.accesscontrol.PgrRowScope;
import org.egov.pgr.accesscontrol.PolicyDecision;
import org.egov.pgr.accesscontrol.ResolvedScope;
import org.egov.pgr.accesscontrol.ResourceAttributes;
import org.egov.pgr.accesscontrol.ResourceDecision;
import org.egov.pgr.accesscontrol.ResourceEvaluationResponse;
import org.egov.pgr.accesscontrol.ResourceInput;
import org.egov.pgr.accesscontrol.ScopeEffect;
import org.egov.pgr.web.models.Address;
import org.egov.pgr.web.models.Boundary;
import org.egov.pgr.web.models.Service;
import org.egov.pgr.web.models.ServiceWrapper;
import org.springframework.beans.BeanWrapper;
import org.springframework.beans.BeanWrapperImpl;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.util.CollectionUtils;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * PEP for PGR complaint search/count: the only place pgr-services asks egov-accesscontrol (the sole
 * PDP) whether a caller may search complaints, and enforces exactly what a PEP is allowed to —
 * parameterized SQL filters (via {@link PgrRowScope}, applied by
 * {@code PGRRepository}/{@code PGRQueryBuilder}), short-circuit DENY, dropping denied rows, and
 * applying returned field masks. Never parses policy, combines roles, evaluates JsonLogic, or
 * fetches action documents.
 */
@org.springframework.stereotype.Service
@Slf4j
public class SearchAccessService {

    /** Action key/url for both /request/_search and /request/_count — count mirrors search's row
     *  scope so the two can never disagree. */
    public static final String PGR_SEARCH_ACTION = "/pgr-services/v2/request/_search";
    private static final String RESOURCE_TYPE_COMPLAINT = "complaint";

    private final AccessControlDecisionClient client;

    @Autowired
    public SearchAccessService(AccessControlDecisionClient client) {
        this.client = client;
    }

    /** Outcome of {@link #resolveScope}: either a scope to filter SQL by, or a signal to
     *  short-circuit to an empty result without ever reaching the database. */
    public static final class ScopeResolution {
        public final boolean denyAll;
        public final PgrRowScope scope;

        private ScopeResolution(boolean denyAll, PgrRowScope scope) {
            this.denyAll = denyAll;
            this.scope = scope;
        }

        public static final ScopeResolution DENY_ALL = new ScopeResolution(true, null);

        public static ScopeResolution of(PgrRowScope scope) {
            return new ScopeResolution(false, scope);
        }
    }

    private static ActionQuery searchAction() {
        return ActionQuery.builder()
                .key(PGR_SEARCH_ACTION)
                .method("POST")
                .url(PGR_SEARCH_ACTION)
                .resourceType(RESOURCE_TYPE_COMPLAINT)
                .build();
    }

    /**
     * Resolves the base action + row scope for a search/count call.
     *
     * @throws AccessDeniedException if the base action itself is denied (maps to HTTP 403)
     * @throws AccessControlUnavailableException on a PDP outage, or a malformed/incomplete decision
     *         (maps to HTTP 503) — an allowed decision with no usable scope/effect is treated the
     *         same as an outage: PGR has nothing safe to enforce.
     */
    public ScopeResolution resolveScope(RequestInfo requestInfo, String tenantId) {
        ActionQuery action = searchAction();
        PolicyDecision decision = client.resolve(requestInfo, tenantId, List.of(action))
                .decisionFor(action.getKey())
                .orElseThrow(() -> new AccessControlUnavailableException(
                        "access-control returned no decision for action " + PGR_SEARCH_ACTION + " tenant=" + tenantId));

        if (!decision.isAllowed())
            throw new AccessDeniedException(PGR_SEARCH_ACTION, decision.getReason());

        ResolvedScope scope = decision.getScope();
        if (scope == null || scope.getEffect() == null)
            throw new AccessControlUnavailableException(
                    "allowed decision for " + PGR_SEARCH_ACTION + " tenant=" + tenantId + " carries no usable scope/effect");

        if (scope.getEffect() == ScopeEffect.DENY)
            return ScopeResolution.DENY_ALL;

        return ScopeResolution.of(PgrRowScope.from(scope));
    }

    /**
     * Bulk-evaluates the fetched rows in one call — "bulk resource decisions", never one call per
     * row. Returns the validated response; callers apply {@link #dropDenied} and (after enrichment)
     * {@link #applyMasks} against its {@code results}.
     *
     * @throws AccessDeniedException if access-control now denies the base action itself.
     * @throws AccessControlUnavailableException if the call fails, or the response carries no
     *         usable decision/results at all (a resource id simply absent from an otherwise valid
     *         {@code results} list is NOT this — see {@link #dropDenied}).
     */
    public ResourceEvaluationResponse evaluate(RequestInfo requestInfo, String tenantId, List<ServiceWrapper> wrappers) {
        ActionQuery action = searchAction();
        List<ResourceInput> resources = new ArrayList<>();
        java.util.Set<String> seen = new java.util.LinkedHashSet<>();
        for (ServiceWrapper wrapper : wrappers) {
            String id = correlationId(wrapper.getService());
            if (!seen.add(id))
                throw new AccessControlUnavailableException(
                        "two fetched complaints share serviceRequestId '" + id + "' — the page cannot be correlated "
                                + "to its decisions, failing closed");
            resources.add(toResourceInput(wrapper.getService(), id));
        }

        ResourceEvaluationResponse response = client.evaluateResources(requestInfo, tenantId, action, resources);
        if (!response.getDecision().isAllowed())
            throw new AccessDeniedException(PGR_SEARCH_ACTION, response.getDecision().getReason());
        return response;
    }

    /**
     * Drops every wrapper whose resource decision is missing (incomplete response — fail closed by
     * exclusion, not by failing the whole request) or {@code allowed=false}.
     */
    public List<ServiceWrapper> dropDenied(List<ServiceWrapper> wrappers, ResourceEvaluationResponse decisions) {
        if (CollectionUtils.isEmpty(wrappers))
            return wrappers;

        List<ServiceWrapper> allowed = new ArrayList<>();
        for (ServiceWrapper wrapper : wrappers) {
            String id = correlationId(wrapper.getService());
            Optional<ResourceDecision> decision = decisions.resultFor(id);
            if (decision.isPresent() && decision.get().isAllowed()) {
                allowed.add(wrapper);
            } else {
                log.warn("SearchAccessService: dropping complaint serviceRequestId={} — {}", id,
                        decision.isEmpty() ? "no resource decision returned (incomplete response)" : "denied by access-control");
            }
        }
        return allowed;
    }

    /**
     * Applies every retained wrapper's field obligations (e.g. REDACT) via {@link MaskingStrategy}.
     * Must run AFTER user/workflow enrichment — an obligation on e.g. {@code citizen.mobileNumber}
     * is a no-op if that field hasn't been populated yet. Pure/no I/O: {@code decisions} was already
     * fetched by {@link #evaluate}.
     */
    public void applyMasks(List<ServiceWrapper> wrappers, ResourceEvaluationResponse decisions) {
        if (CollectionUtils.isEmpty(wrappers))
            return;

        for (ServiceWrapper wrapper : wrappers) {
            Service service = wrapper.getService();
            Optional<ResourceDecision> decision = decisions.resultFor(correlationId(service));
            if (decision.isEmpty() || CollectionUtils.isEmpty(decision.get().getObligations()))
                continue;

            BeanWrapper beanWrapper = new BeanWrapperImpl(service);
            for (FieldObligation obligation : decision.get().getObligations())
                maskField(beanWrapper, obligation, service.getServiceRequestId());
        }
    }

    private void maskField(BeanWrapper beanWrapper, FieldObligation obligation, String serviceRequestId) {
        // AccessControlDecisionClient already rejects a null/blank/duplicate obligation path for the
        // whole response (fails the request closed) — this is a defensive backstop, not the primary
        // enforcement: an obligation reaching here with no usable path must never be silently
        // dropped, since that would leave the field it was meant to hide exposed.
        String path = obligation.getPath();
        if (path == null || path.isBlank())
            throw new AccessControlUnavailableException(
                    "field obligation with no usable path on serviceRequestId=" + serviceRequestId + " — refusing to skip it");
        Object current;
        try {
            current = beanWrapper.getPropertyValue(path);
        } catch (Exception e) {
            // Most commonly a null intermediate object (e.g. no citizen enriched onto this
            // wrapper) — there's genuinely nothing exposed in that case.
            log.debug("SearchAccessService: could not read path '{}' on serviceRequestId={} — nothing to mask: {}",
                    path, serviceRequestId, e.getMessage());
            return;
        }
        if (current == null)
            return;
        try {
            beanWrapper.setPropertyValue(path, MaskingStrategy.apply(current, obligation));
        } catch (Exception e) {
            // The value IS present and access-control denied it — a failed write leaves it exposed.
            // Fail closed by clearing it instead, and alarm loudly since this is not expected.
            log.error("SearchAccessService: failed to mask path '{}' on serviceRequestId={} — clearing the value to avoid exposing it",
                    path, serviceRequestId, e);
            try {
                beanWrapper.setPropertyValue(path, null);
            } catch (Exception ignored) {
                throw new IllegalStateException("cannot mask or clear denied field '" + path + "'", e);
            }
        }
    }

    /**
     * The id a decision is correlated back by.
     *
     * <p>{@code serviceRequestId} rather than the internal database id: it is the complaint's stable
     * public identity, it is what every log line and audit trail on both sides of this call already
     * names, and it does not leak a row's storage key into an outbound request. A complaint with no
     * serviceRequestId cannot be correlated at all, and a row whose decision cannot be matched must
     * never be returned on the assumption that it was allowed.
     */
    private String correlationId(Service service) {
        String serviceRequestId = service.getServiceRequestId();
        if (serviceRequestId == null || serviceRequestId.isBlank())
            throw new AccessControlUnavailableException(
                    "a fetched complaint carries no serviceRequestId — its access decision cannot be "
                            + "correlated, failing closed");
        return serviceRequestId;
    }

    /** The raw resource facts access-control needs to decide — never PGR's own interpretation of them. */
    private ResourceInput toResourceInput(Service service, String correlationId) {
        ResourceAttributes attributes = ResourceAttributes.builder()
                .accountId(service.getAccountId())
                .department(extractDepartment(service))
                .boundary(extractBoundary(service))
                .build();
        return ResourceInput.builder().id(correlationId).attributes(attributes).build();
    }

    /**
     * Service.additionalDetail is a Jackson JsonNode (read back from the jsonb column) when loaded
     * from the DB via PGRRowMapper — the only path that reaches this method — but handle a plain Map
     * too rather than assume the runtime shape.
     */
    private String extractDepartment(Service service) {
        Object additionalDetail = service.getAdditionalDetail();
        if (additionalDetail instanceof java.util.Map) {
            Object dept = ((java.util.Map<?, ?>) additionalDetail).get("department");
            return dept == null ? null : String.valueOf(dept);
        }
        if (additionalDetail instanceof JsonNode) {
            JsonNode department = ((JsonNode) additionalDetail).get("department");
            return department == null || department.isNull() ? null : department.asText();
        }
        return null;
    }

    private String extractBoundary(Service service) {
        Address address = service.getAddress();
        if (address == null)
            return null;
        Boundary locality = address.getLocality();
        return locality == null ? null : locality.getCode();
    }
}
