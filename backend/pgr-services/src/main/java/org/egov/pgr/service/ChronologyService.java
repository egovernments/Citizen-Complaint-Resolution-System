package org.egov.pgr.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import lombok.extern.slf4j.Slf4j;
import org.egov.common.contract.request.RequestInfo;
import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.repository.PGRRepository;
import org.egov.pgr.repository.ServiceRequestRepository;
import org.egov.pgr.util.MDMSUtils;
import org.egov.pgr.web.models.ComplaintTemplateTypeConfig;
import org.egov.pgr.web.models.RequestInfoWrapper;
import org.egov.pgr.web.models.RequestSearchCriteria;
import org.egov.pgr.web.models.Service;
import org.egov.pgr.web.models.ServiceWrapper;
import org.egov.tracer.model.CustomException;
import org.springframework.util.CollectionUtils;

import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;

import static org.egov.pgr.util.PGRConstants.MASK_SENTINEL;
import static org.egov.pgr.util.PGRConstants.ROLE_CONFIDENTIAL_VIEWER;

/**
 * CRQ "Complaint Chronology Visibility" v2.0, AC-03: the chronology a CITIZEN
 * receives must not contain employee comments, attachments or identities — in
 * the API payload, not just on screen. The raw egov-workflow-v2
 * process/_search cannot make that call (it has no notion of who the
 * complainant is), so this endpoint wraps it: pgr-services fetches the
 * process instances server-side, applies the visibility rules for the
 * REQUESTER, and returns the response otherwise byte-shape-identical — the
 * frontend swaps one URL and nothing else.
 *
 * Filtering happens on the raw JSON tree rather than via the ProcessInstance
 * model on purpose: a model round-trip silently drops any field the local
 * model does not know, which would change the payload shape for employees.
 *
 * Rules (mirroring the CRQ tables):
 *  - internal/system callers (a POSITIVE signal only — SYSTEM type or
 *    INTERNAL_MICROSERVICE_ROLE): untouched passthrough.
 *  - an ANONYMOUS caller (no server-vouched userInfo): an empty list. The
 *    gateway strips client-supplied userInfo from token-less requests but in
 *    audit mode still forwards them — absent identity must map to the LEAST
 *    privileged view, never to the internal passthrough.
 *  - the COMPLAINANT (and only on their own complaint): their own steps stay
 *    whole; steps whose content is addressed to the citizen — the closing
 *    entry (RESOLVE / REJECT) and a request for information
 *    (AWAITINGINFORMATION, the officer's question the citizen must be able
 *    to read to answer) — keep comment and attachments but lose
 *    the employee identity; every other employee step is status-only (no
 *    comment, no documents, no assigner/assignes).
 *  - any other CITIZEN: an empty list — a citizen has no business reading
 *    another complaint's chronology, and this endpoint must not become an
 *    existence oracle for it.
 *  - EMPLOYEES: full content (they work the case history). On a CONFIDENTIAL
 *    complaint the complainant's identity inside assigner/assignes is masked
 *    unless the caller is authorized for THAT complaint's template
 *    (allowedViewerRoles, default CONFIDENTIAL_COMPLAINT_VIEWER) — the
 *    chronology twin of the service.citizen masking in PGRService (AC-06).
 *    The viewer decision is per complaint, not global: one request may span
 *    templates with different viewer roles.
 */
@Slf4j
@org.springframework.stereotype.Service
public class ChronologyService {

    /**
     * Actions whose comment/attachments are addressed TO the citizen and so
     * survive the citizen filter (identity still never does): the CRQ closure
     * exception (RESOLVE / REJECT) and the CMS workflow's request for
     * information: the AWAITINGINFORMATION comment IS the question put to the
     * citizen (INVESTIGATION --AWAITINGINFORMATION--> INFOFROMCITIZEN), their
     * timeline is the one reliable channel for it, and staff record the answer
     * (INFOFROMCITIZEN --COMMENT--> is a staff transition). Flow-checked
     * against CmsPgrWorkflowConfig. RESOLVEBYSUPERVISOR is deliberately NOT
     * here: the citizen UI has never shown its comment, so passing it would
     * be a behaviour change, not parity — revisit with product if the CRQ's
     * closure rule should extend to it.
     */
    private static final Set<String> CITIZEN_CONTENT_ACTIONS =
            Set.of("RESOLVE", "REJECT", "AWAITINGINFORMATION");

    private final ServiceRequestRepository repository;
    private final PGRRepository pgrRepository;
    private final PGRConfiguration config;
    private final MDMSUtils mdmsUtils;
    private final ObjectMapper mapper;

    public ChronologyService(ServiceRequestRepository repository, PGRRepository pgrRepository,
                             PGRConfiguration config, MDMSUtils mdmsUtils, ObjectMapper mapper) {
        this.repository = repository;
        this.pgrRepository = pgrRepository;
        this.config = config;
        this.mdmsUtils = mdmsUtils;
        this.mapper = mapper;
    }

    public Object search(RequestInfo requestInfo, String tenantId, List<String> businessIds, Boolean history) {
        // No server-vouched identity → least privilege, and no workflow call at
        // all: the raw payload must not even transit on behalf of an anonymous
        // caller. Same empty shape the workflow returns for a no-match search.
        if (RequesterKind.of(requestInfo) == RequesterKind.ANONYMOUS)
            return emptyResponse();

        // Reject blanks up front rather than forwarding a malformed search.
        Set<String> idSet = businessIds == null ? Set.of()
                : businessIds.stream().filter(Objects::nonNull).map(String::trim)
                        .filter(s -> !s.isEmpty())
                        .collect(Collectors.toCollection(LinkedHashSet::new));
        if (tenantId == null || tenantId.isBlank() || idSet.isEmpty())
            throw new CustomException("CHRONOLOGY_INVALID_REQUEST",
                    "tenantId and at least one businessId are required");
        String joinedIds = String.join(",", idSet);

        StringBuilder url = new StringBuilder(config.getWfHost())
                .append(config.getWfProcessInstanceSearchPath())
                .append("?tenantId=").append(tenantId)
                .append("&businessIds=").append(joinedIds);
        if (Boolean.TRUE.equals(history))
            url.append("&history=true");

        Object wfResult = repository.fetchResult(url,
                RequestInfoWrapper.builder().requestInfo(requestInfo).build());
        // fetchResult swallows transport failures (workflow down / timeout) and
        // returns null — surface that as an explicit error instead of an NPE
        // for citizens or a silent empty 200 for internal callers.
        if (wfResult == null)
            throw new CustomException("CHRONOLOGY_WORKFLOW_UNAVAILABLE",
                    "Workflow service did not return a chronology for: " + joinedIds);
        ObjectNode root = mapper.valueToTree(wfResult);

        if (RequesterKind.of(requestInfo) == RequesterKind.INTERNAL)
            return root;

        // The complaints these instances belong to — who the complainant is and
        // whether the complaint is confidential drive every rule below. The
        // Set-valued criteria field is the one that renders as an IN-clause
        // (the single-valued field is an equality and would match nothing on
        // a multi-id request).
        RequestSearchCriteria criteria = new RequestSearchCriteria();
        criteria.setTenantId(tenantId);
        criteria.setServiceRequestIds(idSet);
        List<ServiceWrapper> complaints = pgrRepository.getServiceWrappers(criteria);

        // Viewer authorization is resolved per template (caseRelatedTo), then
        // stamped onto each complaint's context: authorization for one
        // template must not unlock a different template's complaint.
        Map<String, Boolean> viewerByTemplate = new HashMap<>();
        Map<String, ComplaintContext> byBusinessId = new HashMap<>();
        for (ServiceWrapper w : complaints) {
            Service svc = w.getService();
            boolean confidential = svc.getExtendedAttributes() != null
                    && svc.getExtendedAttributes().getIsConfidentialSafe();
            String caseRelatedTo = svc.getExtendedAttributes() != null
                    ? svc.getExtendedAttributes().getCaseRelatedTo() : null;
            boolean viewer = confidential && viewerByTemplate.computeIfAbsent(
                    caseRelatedTo == null ? "" : caseRelatedTo,
                    t -> isConfidentialViewer(requestInfo, tenantId, caseRelatedTo));
            byBusinessId.put(svc.getServiceRequestId(),
                    new ComplaintContext(svc.getAccountId(), confidential, caseRelatedTo, viewer));
        }

        filterForRequester(root, requestInfo, byBusinessId);
        return root;
    }

    private ObjectNode emptyResponse() {
        ObjectNode root = mapper.createObjectNode();
        root.putNull("ResponseInfo");
        root.putArray("ProcessInstances");
        root.put("totalCount", 0);
        return root;
    }

    /** Viewer check against ONE template's allowedViewerRoles (default role when MDMS lists none). */
    private boolean isConfidentialViewer(RequestInfo requestInfo, String tenantId, String caseRelatedTo) {
        if (requestInfo.getUserInfo() == null || requestInfo.getUserInfo().getRoles() == null)
            return false;
        List<String> viewerRoles = List.of(ROLE_CONFIDENTIAL_VIEWER);
        try {
            ComplaintTemplateTypeConfig cfg = mdmsUtils.fetchComplaintTemplateTypeConfig(
                    requestInfo, tenantId, caseRelatedTo);
            if (cfg != null && !CollectionUtils.isEmpty(cfg.getAllowedViewerRoles()))
                viewerRoles = cfg.getAllowedViewerRoles();
        } catch (Exception e) {
            log.warn("chronology: template config lookup failed, using the default viewer role", e);
        }
        final List<String> allowed = viewerRoles;
        return requestInfo.getUserInfo().getRoles().stream().anyMatch(r -> allowed.contains(r.getCode()));
    }

    // ------------------------------------------------------------------
    // Pure filtering core — package-visible for unit tests.
    // ------------------------------------------------------------------

    enum RequesterKind {
        INTERNAL, CITIZEN, EMPLOYEE, ANONYMOUS;

        static RequesterKind of(RequestInfo requestInfo) {
            // INTERNAL requires a POSITIVE signal. Absent userInfo is NOT one:
            // the gateway strips client-supplied userInfo from token-less
            // requests and, in audit mode, forwards them — classifying that as
            // internal would hand the raw payload to anonymous callers.
            if (requestInfo == null || requestInfo.getUserInfo() == null)
                return ANONYMOUS;
            if ("SYSTEM".equalsIgnoreCase(requestInfo.getUserInfo().getType()))
                return INTERNAL;
            if (requestInfo.getUserInfo().getRoles() != null
                    && requestInfo.getUserInfo().getRoles().stream()
                            .anyMatch(r -> "INTERNAL_MICROSERVICE_ROLE".equals(r.getCode())))
                return INTERNAL;
            if ("CITIZEN".equalsIgnoreCase(requestInfo.getUserInfo().getType()))
                return CITIZEN;
            return EMPLOYEE;
        }
    }

    static final class ComplaintContext {
        final String accountId;
        final boolean confidential;
        final String caseRelatedTo;
        /** Caller may see this complaint's confidential identity in clear — decided per template. */
        final boolean viewerAuthorized;

        ComplaintContext(String accountId, boolean confidential, String caseRelatedTo, boolean viewerAuthorized) {
            this.accountId = accountId;
            this.confidential = confidential;
            this.caseRelatedTo = caseRelatedTo;
            this.viewerAuthorized = viewerAuthorized;
        }
    }

    static void filterForRequester(ObjectNode root, RequestInfo requestInfo,
                                   Map<String, ComplaintContext> contexts) {
        JsonNode instancesNode = root.get("ProcessInstances");
        if (instancesNode == null || !instancesNode.isArray())
            return;
        ArrayNode instances = (ArrayNode) instancesNode;

        RequesterKind kind = RequesterKind.of(requestInfo);
        // Guarded again here (search() already returns early) so the filter is
        // safe no matter who calls it — internal callers are pure passthrough,
        // anonymous callers get nothing.
        if (kind == RequesterKind.INTERNAL)
            return;
        if (kind == RequesterKind.ANONYMOUS) {
            instances.removeAll();
            if (root.has("totalCount"))
                root.put("totalCount", 0);
            return;
        }
        String callerUuid = requestInfo.getUserInfo() != null ? requestInfo.getUserInfo().getUuid() : null;

        if (kind == RequesterKind.CITIZEN) {
            // A citizen may read only their own complaints' chronology.
            Set<String> ownBusinessIds = new HashSet<>();
            for (Map.Entry<String, ComplaintContext> e : contexts.entrySet())
                if (e.getValue().accountId != null && e.getValue().accountId.equals(callerUuid))
                    ownBusinessIds.add(e.getKey());
            for (int i = instances.size() - 1; i >= 0; i--) {
                ObjectNode pi = (ObjectNode) instances.get(i);
                String businessId = text(pi, "businessId");
                if (!ownBusinessIds.contains(businessId)) {
                    instances.remove(i);
                    continue;
                }
                filterInstanceForComplainant(pi, contexts.get(businessId).accountId);
            }
            return;
        }

        // EMPLOYEE: full content; on confidential complaints, mask the
        // complainant's identity in the actor blocks unless the caller is
        // authorized for THAT complaint's template.
        for (JsonNode n : instances) {
            ObjectNode pi = (ObjectNode) n;
            ComplaintContext ctx = contexts.get(text(pi, "businessId"));
            if (ctx == null || !ctx.confidential || ctx.viewerAuthorized)
                continue;
            if (ctx.accountId != null && ctx.accountId.equals(callerUuid))
                continue; // the complainant browsing via an employee session keeps their own data
            maskPersonIfComplainant(pi.get("assigner"), ctx.accountId);
            JsonNode assignes = pi.get("assignes");
            if (assignes != null && assignes.isArray())
                for (JsonNode a : assignes)
                    maskPersonIfComplainant(a, ctx.accountId);
        }
    }

    /**
     * CRQ §3 for the complainant's own view: own steps stay whole; steps whose
     * content is addressed to the citizen (closure, request for information)
     * keep comment + documents but drop the employee identity; every other
     * employee step becomes status-only. nextActions / state / dates are
     * always preserved — the citizen sees THAT the complaint moved.
     */
    private static void filterInstanceForComplainant(ObjectNode pi, String accountId) {
        JsonNode assigner = pi.get("assigner");
        String actorUuid = assigner != null && assigner.isObject() ? text((ObjectNode) assigner, "uuid") : null;
        boolean ownStep = accountId != null && accountId.equals(actorUuid);
        if (ownStep) {
            // The citizen's own step (APPLY / REOPEN / RATE / their COMMENT):
            // comment, documents and the assigner (which IS the citizen) stay.
            // But assignes names the OFFICER the step was routed TO — an
            // employee identity that must not reach the citizen. A REOPEN, for
            // instance, carries the supervisor it lands on. Strip it.
            pi.putNull("assignes");
            return;
        }
        // Set.of collections reject null lookups — a migrated row may carry no
        // action at all, which is simply "not citizen-facing", not a 500.
        String action = text(pi, "action");
        boolean citizenContent = action != null && CITIZEN_CONTENT_ACTIONS.contains(action);
        if (!citizenContent) {
            pi.putNull("comment");
            pi.putNull("documents");
        }
        // Employee identity never reaches the citizen — closing entry included.
        pi.putNull("assigner");
        pi.putNull("assignes");
    }

    private static void maskPersonIfComplainant(JsonNode person, String accountId) {
        if (person == null || !person.isObject() || accountId == null)
            return;
        ObjectNode p = (ObjectNode) person;
        if (!accountId.equals(text(p, "uuid")))
            return;
        for (String field : new String[] { "name", "userName", "mobileNumber", "emailId", "correspondenceAddress" })
            if (p.hasNonNull(field))
                p.put(field, MASK_SENTINEL);
    }

    private static String text(ObjectNode node, String field) {
        JsonNode v = node.get(field);
        return v != null && v.isTextual() ? v.asText() : null;
    }
}
