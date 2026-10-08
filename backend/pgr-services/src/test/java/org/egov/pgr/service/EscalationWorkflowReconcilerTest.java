package org.egov.pgr.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.egov.common.contract.request.RequestInfo;
import org.egov.common.contract.request.User;
import org.egov.common.utils.MultiStateInstanceUtil;
import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.repository.ServiceRequestRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** EscalationConfig.eligibleStatuses is enough to make a state escalate (#2132). */
class EscalationWorkflowReconcilerTest {

    private static final String SEARCH = "/businessservice/_search";
    private static final String UPDATE = "/businessservice/_update";
    private static final String LME = "11111111-1111-1111-1111-111111111111";
    private static final String QUEUE = "22222222-2222-2222-2222-222222222222";
    private static final String RESOLVED = "33333333-3333-3333-3333-333333333333";

    private final ObjectMapper mapper = new ObjectMapper();
    private ServiceRequestRepository repository;
    private EscalationWorkflowReconciler reconciler;
    private final RequestInfo requestInfo = RequestInfo.builder()
            .userInfo(User.builder().uuid("system").build()).build();

    @BeforeEach
    void setUp() {
        PGRConfiguration config = mock(PGRConfiguration.class);
        when(config.getWfHost()).thenReturn("http://wf");
        when(config.getWfBusinessServiceSearchPath()).thenReturn(SEARCH);
        when(config.getWfBusinessServiceUpdatePath()).thenReturn(UPDATE);
        repository = mock(ServiceRequestRepository.class);
        reconciler = new EscalationWorkflowReconciler(config, repository, mapper, mock(MultiStateInstanceUtil.class));
    }

    private static Map<String, Object> action(String name, String nextState, String... roles) {
        return Map.of("uuid", name + nextState, "action", name, "nextState", nextState,
                "roles", List.of(roles), "active", true);
    }

    private static Map<String, Object> workflow(List<Map<String, Object>> lmeActions) {
        return Map.of("BusinessServices", List.of(Map.of(
                "tenantId", "ke", "businessService", "PGR", "uuid", "bs",
                "states", List.of(
                        Map.of("uuid", LME, "state", "PENDINGATLME", "actions", lmeActions),
                        Map.of("uuid", QUEUE, "state", "PENDINGFORREASSIGNMENT", "actions", List.of(
                                action("COMMENT", QUEUE, "CITIZEN"),
                                action("ASSIGN", LME, "GRO", "PGR_VIEWER"),
                                action("REJECT", RESOLVED, "GRO", "PGR_VIEWER")))))));
    }

    private static final List<Map<String, Object>> LME_WITH_ESCALATE = List.of(
            action("RESOLVE", RESOLVED, "PGR_LME", "PGR_VIEWER"),
            action("ESCALATE", LME, "PGR_LME", "PGR_VIEWER", "SYSTEM"));

    private void searchReturns(Map<String, Object> response) {
        when(repository.fetchResult(argThat(url -> url != null && url.toString().contains(SEARCH)), any()))
                .thenReturn(response);
    }

    private List<JsonNode> updates() {
        ArgumentCaptor<Object> bodies = ArgumentCaptor.forClass(Object.class);
        verify(repository, org.mockito.Mockito.atLeast(0))
                .fetchResult(argThat(url -> url != null && url.toString().contains(UPDATE)), bodies.capture());
        List<JsonNode> result = new ArrayList<>();
        for (Object body : bodies.getAllValues()) {
            result.add(mapper.valueToTree(body).path("BusinessServices").get(0));
        }
        return result;
    }

    private static List<JsonNode> escalateActions(JsonNode businessService, String stateName) {
        List<JsonNode> found = new ArrayList<>();
        for (JsonNode state : businessService.path("states")) {
            if (stateName.equals(state.path("state").asText())) {
                state.path("actions").forEach(a -> {
                    if ("ESCALATE".equals(a.path("action").asText())) found.add(a);
                });
            }
        }
        return found;
    }

    @Test
    void addsAnEscalateSelfLoopToAnEligibleStateWithItsHolderRolesAndSystem() {
        searchReturns(workflow(LME_WITH_ESCALATE));

        reconciler.reconcile("ke", List.of("PENDINGATLME", "PENDINGFORREASSIGNMENT"), requestInfo);

        List<JsonNode> updates = updates();
        assertEquals(1, updates.size());
        List<JsonNode> added = escalateActions(updates.get(0), "PENDINGFORREASSIGNMENT");
        assertEquals(1, added.size());
        JsonNode escalate = added.get(0);
        assertEquals(QUEUE, escalate.path("nextState").asText());
        assertTrue(escalate.path("active").asBoolean());
        assertEquals(List.of("GRO", "PGR_VIEWER", "SYSTEM"),
                mapper.convertValue(escalate.path("roles"), List.class));
        assertTrue(escalate.path("uuid").isMissingNode(), "workflow-v2 assigns the uuid of a new action");
        assertEquals(1, escalateActions(updates.get(0), "PENDINGATLME").size());
    }

    @Test
    void leavesTheWorkflowAloneWhenEveryEligibleStateCanAlreadyEscalate() {
        searchReturns(workflow(LME_WITH_ESCALATE));

        reconciler.reconcile("ke", List.of("PENDINGATLME"), requestInfo);

        verify(repository, never()).fetchResult(argThat(url -> url != null && url.toString().contains(UPDATE)), any());
    }

    @Test
    void authorizesSystemOnAnExistingManualOnlyEscalate() {
        searchReturns(workflow(List.of(action("ESCALATE", LME, "PGR_LME"))));

        reconciler.reconcile("ke", List.of("PENDINGATLME"), requestInfo);

        List<JsonNode> escalate = escalateActions(updates().get(0), "PENDINGATLME");
        assertEquals(1, escalate.size());
        assertEquals(List.of("PGR_LME", "SYSTEM"), mapper.convertValue(escalate.get(0).path("roles"), List.class));
    }

    @Test
    void neverAddsASecondEscalateBesideALegacyTransition() {
        String supervisor = "44444444-4444-4444-4444-444444444444";
        searchReturns(workflow(List.of(action("ESCALATE", supervisor, "PGR_LME", "SYSTEM"))));
        reconciler.reconcile("ke", List.of("PENDINGATLME"), requestInfo);
        verify(repository, never()).fetchResult(argThat(url -> url != null && url.toString().contains(UPDATE)), any());

        searchReturns(workflow(List.of(action("ESCALATE", supervisor, "PGR_LME"))));
        reconciler.reconcile("ke", List.of("PENDINGATLME"), requestInfo);
        List<JsonNode> escalate = escalateActions(updates().get(0), "PENDINGATLME");
        assertEquals(1, escalate.size());
        assertEquals(supervisor, escalate.get(0).path("nextState").asText());
        assertEquals(List.of("PGR_LME", "SYSTEM"), mapper.convertValue(escalate.get(0).path("roles"), List.class));
    }

    @Test
    void aStaleSearchAfterAWriteRefreshesInsteadOfAddingADuplicate() {
        searchReturns(workflow(LME_WITH_ESCALATE));
        List<String> statuses = List.of("PENDINGFORREASSIGNMENT");

        reconciler.reconcile("ke", statuses, requestInfo);   // adds
        reconciler.reconcile("ke", statuses, requestInfo);   // still missing: refresh only
        reconciler.reconcile("ke", statuses, requestInfo);   // still missing after a refresh: add again

        List<JsonNode> updates = updates();
        assertEquals(3, updates.size());
        assertEquals(1, escalateActions(updates.get(0), "PENDINGFORREASSIGNMENT").size());
        assertEquals(0, escalateActions(updates.get(1), "PENDINGFORREASSIGNMENT").size());
        assertEquals(1, escalateActions(updates.get(2), "PENDINGFORREASSIGNMENT").size());
    }

    @Test
    void ignoresAStatusTheWorkflowDoesNotHave() {
        searchReturns(workflow(LME_WITH_ESCALATE));

        reconciler.reconcile("ke", List.of("NOSUCHSTATE"), requestInfo);

        verify(repository, times(1)).fetchResult(any(), any());
    }
}
