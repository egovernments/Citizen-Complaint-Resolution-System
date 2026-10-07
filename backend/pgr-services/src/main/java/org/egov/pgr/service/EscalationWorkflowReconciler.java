package org.egov.pgr.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import lombok.extern.slf4j.Slf4j;
import org.egov.common.contract.request.RequestInfo;
import org.egov.common.utils.MultiStateInstanceUtil;
import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.repository.ServiceRequestRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

import static org.egov.pgr.util.PGRConstants.ESCALATE;
import static org.egov.pgr.util.PGRConstants.PGR_BUSINESSSERVICE;

/**
 * Keeps the PGR workflow in step with {@code EscalationConfig.eligibleStatuses}.
 *
 * <p>The scheduler escalates by submitting a workflow {@code ESCALATE} transition, which
 * egov-workflow-v2 rejects unless the complaint's current state has that action. Listing a
 * status in MDMS therefore did nothing on its own (#2132). Each scan, this gives every eligible
 * state an {@code ESCALATE} action that authorizes {@code SYSTEM}: a new self-loop carrying the
 * roles that already act on that state, so its holder can also escalate by hand, or SYSTEM added
 * to the state's existing {@code ESCALATE}. It only ever adds:
 * removing a status from MDMS stops automatic escalation but leaves manual escalation alone.</p>
 *
 * <p>workflow-v2 persists asynchronously and caches searches in-JVM, so a search right after a
 * write can return the old graph and pin it in the cache. A state still missing its action after
 * a write is therefore first refreshed (an unchanged update, which evicts the cache) and only
 * re-added if it is still missing after that, so a slow persister never produces a duplicate.</p>
 */
@Component
@Slf4j
public class EscalationWorkflowReconciler {

    static final String SYSTEM_ROLE = "SYSTEM";

    private enum Attempt { ADDED, REFRESHED }

    private final PGRConfiguration config;
    private final ServiceRequestRepository serviceRequestRepository;
    private final ObjectMapper mapper;
    private final MultiStateInstanceUtil multiStateInstanceUtil;
    private final Map<String, Attempt> pending = new ConcurrentHashMap<>();

    @Autowired
    public EscalationWorkflowReconciler(PGRConfiguration config,
                                        ServiceRequestRepository serviceRequestRepository,
                                        ObjectMapper mapper,
                                        MultiStateInstanceUtil multiStateInstanceUtil) {
        this.config = config;
        this.serviceRequestRepository = serviceRequestRepository;
        this.mapper = mapper;
        this.multiStateInstanceUtil = multiStateInstanceUtil;
    }

    /**
     * The tenant that owns the PGR workflow a complaint tenant uses. workflow-v2 answers a city
     * search with its state's graph relabelled as the city, so writes must target the state root.
     */
    public String workflowTenant(String tenantId) {
        return multiStateInstanceUtil.getStateLevelTenant(tenantId);
    }

    /**
     * Ensures every status in {@code eligibleStatuses} has an ESCALATE self-loop in the PGR
     * workflow owned by {@code tenantId}, which must be a {@link #workflowTenant} root.
     */
    public void reconcile(String tenantId, Collection<String> eligibleStatuses, RequestInfo requestInfo) {
        ObjectNode businessService = search(tenantId, requestInfo);
        if (businessService == null) {
            log.warn("No PGR workflow found for tenant {}; cannot enable escalation for {}", tenantId, eligibleStatuses);
            return;
        }

        boolean changed = false;
        boolean refresh = false;
        for (String status : new LinkedHashSet<>(eligibleStatuses)) {
            String key = tenantId + "|" + status;
            ObjectNode state = findState(businessService, status);
            if (state == null) {
                log.warn("Escalation status {} is not a state of tenant {}'s PGR workflow; it cannot escalate",
                        status, tenantId);
                continue;
            }
            if (hasSystemEscalation(state)) {
                pending.remove(key);
                continue;
            }
            Attempt previous = pending.get(key);
            if (previous == Attempt.ADDED) {
                refresh = true;
                pending.put(key, Attempt.REFRESHED);
                continue;
            }
            if (previous == Attempt.REFRESHED) {
                log.warn("ESCALATE on {} for tenant {} did not persist; adding it again", status, tenantId);
            }
            ensureEscalation(state);
            pending.put(key, Attempt.ADDED);
            changed = true;
            log.info("Enabling ESCALATE on PGR workflow state {} for tenant {}", status, tenantId);
        }

        if (changed || refresh) {
            update(businessService, requestInfo);
        }
    }

    /**
     * Authorizes SYSTEM on the state's existing ESCALATE action, or adds an ESCALATE self-loop
     * carrying the state's holder roles. A state never gets a second ESCALATE: a deployment whose
     * ESCALATE still targets a legacy state keeps that transition (see the self-loop migration).
     */
    void ensureEscalation(ObjectNode state) {
        String stateUuid = state.path("uuid").asText();
        ArrayNode actions = state.has("actions") && state.get("actions").isArray()
                ? (ArrayNode) state.get("actions") : state.putArray("actions");

        for (JsonNode action : actions) {
            if (ESCALATE.equalsIgnoreCase(action.path("action").asText())) {
                ArrayNode roles = action.has("roles") && action.get("roles").isArray()
                        ? (ArrayNode) action.get("roles") : ((ObjectNode) action).putArray("roles");
                if (!containsSystem(roles)) {
                    roles.add(SYSTEM_ROLE);
                }
                ((ObjectNode) action).put("active", true);
                return;
            }
        }

        // The roles that move a complaint out of this state are the ones that hold it there.
        Set<String> roles = new LinkedHashSet<>();
        for (JsonNode action : actions) {
            if (!stateUuid.equals(action.path("nextState").asText())) {
                action.path("roles").forEach(role -> roles.add(role.asText()));
            }
        }
        roles.add(SYSTEM_ROLE);

        ObjectNode escalate = actions.addObject();
        escalate.put("action", ESCALATE);
        escalate.put("nextState", stateUuid);
        escalate.put("active", true);
        ArrayNode roleArray = escalate.putArray("roles");
        roles.forEach(roleArray::add);
    }

    static boolean hasSystemEscalation(JsonNode state) {
        for (JsonNode action : state.path("actions")) {
            if (ESCALATE.equalsIgnoreCase(action.path("action").asText())
                    && !"false".equals(action.path("active").asText("true"))
                    && containsSystem(action.path("roles"))) {
                return true;
            }
        }
        return false;
    }

    private static boolean containsSystem(JsonNode roles) {
        for (JsonNode role : roles) {
            if (SYSTEM_ROLE.equals(role.asText())) {
                return true;
            }
        }
        return false;
    }

    private static ObjectNode findState(JsonNode businessService, String status) {
        for (JsonNode state : businessService.path("states")) {
            String name = state.path("state").asText(null);
            String applicationStatus = state.path("applicationStatus").asText(null);
            if (status.equalsIgnoreCase(name) || status.equalsIgnoreCase(applicationStatus)) {
                return (ObjectNode) state;
            }
        }
        return null;
    }

    private ObjectNode search(String tenantId, RequestInfo requestInfo) {
        StringBuilder url = new StringBuilder(config.getWfHost())
                .append(config.getWfBusinessServiceSearchPath())
                .append("?tenantId=").append(tenantId)
                .append("&businessServices=").append(PGR_BUSINESSSERVICE);
        Object result = serviceRequestRepository.fetchResult(url, Map.of("RequestInfo", requestInfo));
        JsonNode services = mapper.valueToTree(result).path("BusinessServices");
        for (JsonNode service : services) {
            if (PGR_BUSINESSSERVICE.equalsIgnoreCase(service.path("businessService").asText())
                    && tenantId.toLowerCase(Locale.ROOT).equals(service.path("tenantId").asText().toLowerCase(Locale.ROOT))) {
                return (ObjectNode) service;
            }
        }
        return null;
    }

    private void update(ObjectNode businessService, RequestInfo requestInfo) {
        StringBuilder url = new StringBuilder(config.getWfHost()).append(config.getWfBusinessServiceUpdatePath());
        ObjectNode request = mapper.createObjectNode();
        request.set("RequestInfo", mapper.valueToTree(requestInfo));
        request.putArray("BusinessServices").add(businessService);
        serviceRequestRepository.fetchResult(url, request);
    }
}
