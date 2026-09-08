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
import org.springframework.util.CollectionUtils;

import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

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
 *  - internal/system callers: untouched passthrough.
 *  - the COMPLAINANT (and only on their own complaint): their own steps stay
 *    whole; the closing entry (RESOLVE / REJECT) keeps its comment and
 *    attachments but loses the employee identity; every other employee step
 *    is status-only (no comment, no documents, no assigner/assignes).
 *  - any other CITIZEN: an empty list — a citizen has no business reading
 *    another complaint's chronology, and this endpoint must not become an
 *    existence oracle for it.
 *  - EMPLOYEES: full content (they work the case history). On a CONFIDENTIAL
 *    complaint the complainant's identity inside assigner/assignes is masked
 *    unless the caller is authorized (allowedViewerRoles, default
 *    CONFIDENTIAL_COMPLAINT_VIEWER) — the chronology twin of the
 *    service.citizen masking in PGRService (AC-06).
 */
@Slf4j
@org.springframework.stereotype.Service
public class ChronologyService {

    /** Actions whose comment/attachments are the CRQ's closure exception. */
    private static final Set<String> CLOSING_ACTIONS = Set.of("RESOLVE", "REJECT");

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

    public Object search(RequestInfo requestInfo, String tenantId, String businessIds, Boolean history) {
        StringBuilder url = new StringBuilder(config.getWfHost())
                .append(config.getWfProcessInstanceSearchPath())
                .append("?tenantId=").append(tenantId)
                .append("&businessIds=").append(businessIds);
        if (Boolean.TRUE.equals(history))
            url.append("&history=true");

        Object wfResult = repository.fetchResult(url,
                RequestInfoWrapper.builder().requestInfo(requestInfo).build());
        ObjectNode root = mapper.valueToTree(wfResult);

        if (RequesterKind.of(requestInfo) == RequesterKind.INTERNAL)
            return root;

        // The complaints these instances belong to — who the complainant is and
        // whether the complaint is confidential drive every rule below.
        RequestSearchCriteria criteria = new RequestSearchCriteria();
        criteria.setTenantId(tenantId);
        criteria.setServiceRequestId(businessIds);
        List<ServiceWrapper> complaints = pgrRepository.getServiceWrappers(criteria);
        Map<String, ComplaintContext> byBusinessId = new HashMap<>();
        for (ServiceWrapper w : complaints) {
            Service svc = w.getService();
            boolean confidential = svc.getExtendedAttributes() != null
                    && svc.getExtendedAttributes().getIsConfidentialSafe();
            byBusinessId.put(svc.getServiceRequestId(),
                    new ComplaintContext(svc.getAccountId(), confidential,
                            svc.getExtendedAttributes() != null ? svc.getExtendedAttributes().getCaseRelatedTo() : null));
        }

        boolean confidentialViewer = isConfidentialViewer(requestInfo, tenantId, byBusinessId);
        filterForRequester(root, requestInfo, byBusinessId, confidentialViewer);
        return root;
    }

    /** Viewer check against the template's allowedViewerRoles (default role) — only looked up when needed. */
    private boolean isConfidentialViewer(RequestInfo requestInfo, String tenantId,
                                         Map<String, ComplaintContext> contexts) {
        ComplaintContext confidential = contexts.values().stream()
                .filter(c -> c.confidential).findFirst().orElse(null);
        if (confidential == null)
            return false;
        List<String> viewerRoles = List.of(ROLE_CONFIDENTIAL_VIEWER);
        try {
            ComplaintTemplateTypeConfig cfg = mdmsUtils.fetchComplaintTemplateTypeConfig(
                    requestInfo, tenantId, confidential.caseRelatedTo);
            if (cfg != null && !CollectionUtils.isEmpty(cfg.getAllowedViewerRoles()))
                viewerRoles = cfg.getAllowedViewerRoles();
        } catch (Exception e) {
            log.warn("chronology: template config lookup failed, using the default viewer role", e);
        }
        if (requestInfo.getUserInfo() == null || requestInfo.getUserInfo().getRoles() == null)
            return false;
        final List<String> allowed = viewerRoles;
        return requestInfo.getUserInfo().getRoles().stream().anyMatch(r -> allowed.contains(r.getCode()));
    }

    // ------------------------------------------------------------------
    // Pure filtering core — package-visible for unit tests.
    // ------------------------------------------------------------------

    enum RequesterKind {
        INTERNAL, CITIZEN, EMPLOYEE;

        static RequesterKind of(RequestInfo requestInfo) {
            if (requestInfo == null || requestInfo.getUserInfo() == null)
                return INTERNAL; // machine context — presentation traffic always carries userInfo
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

        ComplaintContext(String accountId, boolean confidential, String caseRelatedTo) {
            this.accountId = accountId;
            this.confidential = confidential;
            this.caseRelatedTo = caseRelatedTo;
        }
    }

    static void filterForRequester(ObjectNode root, RequestInfo requestInfo,
                                   Map<String, ComplaintContext> contexts, boolean confidentialViewer) {
        JsonNode instancesNode = root.get("ProcessInstances");
        if (instancesNode == null || !instancesNode.isArray())
            return;
        ArrayNode instances = (ArrayNode) instancesNode;

        RequesterKind kind = RequesterKind.of(requestInfo);
        // Guarded again here (search() already returns early) so the filter is
        // safe no matter who calls it — internal callers are pure passthrough.
        if (kind == RequesterKind.INTERNAL)
            return;
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
        // complainant's identity in the actor blocks unless authorized.
        if (confidentialViewer)
            return;
        for (JsonNode n : instances) {
            ObjectNode pi = (ObjectNode) n;
            ComplaintContext ctx = contexts.get(text(pi, "businessId"));
            if (ctx == null || !ctx.confidential)
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
     * CRQ §3 for the complainant's own view: own steps stay whole; the closing
     * entry keeps comment + documents but drops the employee identity; every
     * other employee step becomes status-only. nextActions / state / dates are
     * always preserved — the citizen sees THAT the complaint moved.
     */
    private static void filterInstanceForComplainant(ObjectNode pi, String accountId) {
        JsonNode assigner = pi.get("assigner");
        String actorUuid = assigner != null ? text((ObjectNode) assigner, "uuid") : null;
        boolean ownStep = accountId != null && accountId.equals(actorUuid);
        if (ownStep)
            return;
        boolean closing = CLOSING_ACTIONS.contains(text(pi, "action"));
        if (!closing) {
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
