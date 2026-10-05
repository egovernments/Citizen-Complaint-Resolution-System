package org.egov.pgr.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.egov.common.contract.request.RequestInfo;
import org.egov.common.contract.request.User;
import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.repository.ServiceRequestRepository;
import org.egov.pgr.web.models.workflow.ProcessInstance;
import org.egov.pgr.web.models.workflow.ProcessInstanceResponse;
import org.egov.pgr.web.models.workflow.State;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * #2281 review: the own-assigned exception and the "My" filter resolve the complaints an employee
 * currently HOLDS. Workflow's assignee filter alone only sees each complaint's newest transition,
 * so an assignee-less citizen COMMENT used to hide the complaint from its holder.
 */
class WorkflowServiceAssigneeTest {

    private static final String TENANT = "pg.city";
    private static final String LME = "lme-a";
    private static final String PENDING_AT_LME = "state-pendingatlme";
    private static final String PENDING_REASSIGN = "state-pendingforreassignment";
    private static final String PENDING_ASSIGNMENT = "state-pendingforassignment";
    private static final String RESOLVED = "state-resolved";
    private static final String CLOSED = "state-closedafterresolution";

    private ServiceRequestRepository repository;
    private WorkflowService workflowService;
    private final List<String> urls = new ArrayList<>();

    @BeforeEach
    void setup() {
        PGRConfiguration config = new PGRConfiguration();
        config.setWfHost("http://wf");
        config.setWfProcessInstanceSearchPath("/egov-wf/process/_search");
        repository = mock(ServiceRequestRepository.class);
        workflowService = new WorkflowService(config, repository, new ObjectMapper());
    }

    /**
     * Answers process searches the way egov-workflow-v2's getProcessInstanceIds does, over
     * {@code timeline} (every transition, newest first): {@code history=false} keeps each
     * complaint's newest row, {@code assignee} keeps rows naming them, then ORDER BY
     * lastModifiedTime DESC OFFSET ? LIMIT ? — one page across all requested complaints, the
     * limit defaulting to 10 and clamped to {@code maxLimit}.
     */
    private void stubWorkflow(List<ProcessInstance> timeline) {
        when(repository.fetchResultWithTimeout(any(), any())).thenAnswer(inv -> {
            String url = inv.getArgument(0).toString();
            urls.add(url);
            Map<String, String> params = params(url);
            boolean history = Boolean.parseBoolean(params.getOrDefault("history", "false"));
            Set<String> businessIds = params.containsKey("businessIds")
                    ? new HashSet<>(Arrays.asList(params.get("businessIds").split(","))) : null;
            String assignee = params.get("assignee");
            Set<String> seen = new HashSet<>();
            List<ProcessInstance> matching = new ArrayList<>();
            for (ProcessInstance row : timeline) {
                boolean newest = seen.add(row.getBusinessId());
                if (!history && !newest)
                    continue;
                if (businessIds != null && !businessIds.contains(row.getBusinessId()))
                    continue;
                if (assignee != null && row.getAssignes().stream().noneMatch(u -> assignee.equals(u.getUuid())))
                    continue;
                matching.add(row);
            }
            int offset = Integer.parseInt(params.getOrDefault("offset", "0"));
            int limit = Math.min(Integer.parseInt(params.getOrDefault("limit", "10")), maxLimit);
            return response(matching.subList(Math.min(offset, matching.size()), Math.min(offset + limit, matching.size())));
        });
    }

    private int maxLimit = 200;

    private static Map<String, String> params(String url) {
        Map<String, String> params = new HashMap<>();
        for (String pair : url.substring(url.indexOf('?') + 1).split("&")) {
            String[] kv = pair.split("=", 2);
            params.put(kv[0], kv.length > 1 ? kv[1] : "");
        }
        return params;
    }

    @Test
    void citizenCommentAfterAssignDoesNotDropTheHolder() {
        // Live scenario: a ward-B complaint assigned to the ward-A LME, then the citizen comments.
        // The COMMENT is now the newest transition and names nobody.
        ProcessInstance assign = instance("PGR-B", PENDING_AT_LME, LME);
        ProcessInstance comment = instance("PGR-B", PENDING_AT_LME);
        stubWorkflow(List.of(comment, assign));

        Set<String> held = workflowService.getServiceRequestIdsByAssignee(new RequestInfo(), TENANT, LME);

        assertEquals(Set.of("PGR-B"), held);
    }

    @Test
    void complaintMovedOnOrHandedToSomeoneElseIsNotHeld() {
        // REASSIGN returns it to a queue (state changes); a later ASSIGN names someone else.
        ProcessInstance assignedToMe1 = instance("PGR-REQUEUED", PENDING_AT_LME, LME);
        ProcessInstance reassign = instance("PGR-REQUEUED", PENDING_REASSIGN);
        ProcessInstance assignedToMe2 = instance("PGR-HANDED-ON", PENDING_AT_LME, LME);
        ProcessInstance assignedToOther = instance("PGR-HANDED-ON", PENDING_AT_LME, "lme-other");
        stubWorkflow(List.of(reassign, assignedToOther, assignedToMe1, assignedToMe2));

        assertTrue(workflowService.getServiceRequestIdsByAssignee(new RequestInfo(), TENANT, LME).isEmpty());
    }

    @Test
    void latestTransitionNamingTheAssigneeNeedsNoHistory() {
        ProcessInstance assign = instance("PGR-1", PENDING_AT_LME, LME);
        stubWorkflow(List.of(assign));

        assertEquals(Set.of("PGR-1"), workflowService.getServiceRequestIdsByAssignee(new RequestInfo(), TENANT, LME));
        assertTrue(urls.stream().noneMatch(u -> u.contains("businessIds=")), "no candidates left to walk: " + urls);
    }

    @Test
    void everyWorkflowSearchPassesAnExplicitLimit() {
        // egov-workflow-v2 otherwise returns its default page (10 in the stock jar).
        ProcessInstance assign = instance("PGR-B", PENDING_AT_LME, LME);
        stubWorkflow(List.of(instance("PGR-B", PENDING_AT_LME), assign));

        workflowService.getServiceRequestIdsByAssignee(new RequestInfo(), TENANT, LME);

        assertEquals(4, urls.size(), urls.toString());
        urls.forEach(u -> assertTrue(u.contains("&limit="), u));
        urls.subList(2, 4).forEach(u -> assertTrue(u.contains("limit=" + WorkflowService.HISTORY_PAGE_SIZE), u));
    }

    @Test
    void staleAssignOlderThanAPageOfOtherRowsIsStillFound() {
        // #2281 round 2: the LME was assigned PGR-STALE weeks ago and has closed 60 complaints since
        // (4 rows each, 240 rows newer than the old ASSIGN); now the citizen comments to chase it.
        // One shared history page across all candidates would drop the old ASSIGN row.
        List<ProcessInstance> timeline = new ArrayList<>();
        timeline.add(instance("PGR-STALE", PENDING_AT_LME));
        for (int i = 0; i < 60; i++)
            timeline.addAll(closedComplaint("PGR-CLOSED-" + i, LME));
        timeline.add(instance("PGR-STALE", PENDING_AT_LME, LME));
        timeline.add(instance("PGR-STALE", PENDING_ASSIGNMENT));
        stubWorkflow(timeline);

        assertEquals(Set.of("PGR-STALE"), workflowService.getServiceRequestIdsByAssignee(new RequestInfo(), TENANT, LME));
        // Closed complaints settle on their newest (terminal) transition: only PGR-STALE is walked.
        String walk = urls.get(urls.size() - 1);
        assertTrue(walk.contains("history=true") && walk.contains("businessIds=PGR-STALE&"), walk);
    }

    @Test
    void newestTransitionsAreReadWithoutHistoryBeforeAnyWalk() {
        // Phase 1 must ask for each candidate's newest transition only (history=false); with
        // history=true one long-closed complaint's rows would crowd the others out of the page.
        List<ProcessInstance> timeline = new ArrayList<>();
        timeline.add(instance("PGR-OPEN", PENDING_AT_LME, LME));
        timeline.addAll(closedComplaint("PGR-DONE", LME));
        stubWorkflow(timeline);

        assertEquals(Set.of("PGR-OPEN"), workflowService.getServiceRequestIdsByAssignee(new RequestInfo(), TENANT, LME));
        // PGR-DONE is only a candidate (an older transition named the LME): its newest transition is read
        // with history=false, and being terminal it settles there, so no history walk follows.
        List<String> byId = urls.stream().filter(u -> u.contains("businessIds=")).toList();
        assertEquals(1, byId.size(), urls.toString());
        assertTrue(byId.get(0).contains("history=false") && byId.get(0).contains("businessIds=PGR-DONE&"), urls.toString());
    }

    @Test
    void longHistoriesAcrossChunksAreWalkedWithOffsetPaging() {
        // 30 open complaints, each assigned to the LME and then commented on 9 times: 330 rows,
        // more than one chunk and more than one page per chunk.
        List<ProcessInstance> timeline = new ArrayList<>();
        for (int c = 0; c < 9; c++)
            for (int i = 0; i < 30; i++)
                timeline.add(instance("PGR-" + i, PENDING_AT_LME));
        for (int i = 0; i < 30; i++)
            timeline.add(instance("PGR-" + i, PENDING_AT_LME, LME));
        for (int i = 0; i < 30; i++)
            timeline.add(instance("PGR-" + i, PENDING_ASSIGNMENT));
        stubWorkflow(timeline);
        maxLimit = 100; // stock egov.wf.max.limit

        Set<String> held = workflowService.getServiceRequestIdsByAssignee(new RequestInfo(), TENANT, LME);

        assertEquals(30, held.size(), held.toString());
        assertTrue(urls.stream().anyMatch(u -> u.contains("history=true") && !u.contains("offset=0")),
                "expected a second page: " + urls);
        assertTrue(urls.size() <= 4 + WorkflowService.MAX_HISTORY_CALLS, urls.toString());
    }

    @Test
    void historyWalkStopsAtTheCallBudgetAndOmitsTheUndecided() {
        // 150 open complaints whose ASSIGN sits under 99 comments each: no walk decides within the
        // budget, so the lookup stops there and admits nothing it could not prove.
        List<ProcessInstance> timeline = new ArrayList<>();
        for (int c = 0; c < 99; c++)
            for (int i = 0; i < 150; i++)
                timeline.add(instance("PGR-" + i, PENDING_AT_LME));
        for (int i = 0; i < 150; i++)
            timeline.add(instance("PGR-" + i, PENDING_AT_LME, LME));
        stubWorkflow(timeline);

        assertTrue(workflowService.getServiceRequestIdsByAssignee(new RequestInfo(), TENANT, LME).isEmpty());
        assertEquals(2 + 2 + WorkflowService.MAX_HISTORY_CALLS, urls.size(), urls.toString());
    }

    @Test
    void historyFailureKeepsTheLatestTransitionResult() {
        ProcessInstance assign = instance("PGR-1", PENDING_AT_LME, LME);
        when(repository.fetchResultWithTimeout(any(), any())).thenAnswer(inv -> {
            String url = inv.getArgument(0).toString();
            if (url.contains("history=false"))
                return response(List.of(assign));
            return null; // ServiceRequestRepository's shape for a failed call
        });

        assertEquals(Set.of("PGR-1"), workflowService.getServiceRequestIdsByAssignee(new RequestInfo(), TENANT, LME));
    }

    /** APPLY, ASSIGN to {@code lme}, RESOLVE, RATE (terminal) — newest first. */
    private static List<ProcessInstance> closedComplaint(String businessId, String lme) {
        ProcessInstance rate = instance(businessId, CLOSED);
        rate.getState().setIsTerminateState(true);
        return List.of(rate, instance(businessId, RESOLVED), instance(businessId, PENDING_AT_LME, lme),
                instance(businessId, PENDING_ASSIGNMENT));
    }

    private static ProcessInstanceResponse response(List<ProcessInstance> instances) {
        return ProcessInstanceResponse.builder().processInstances(instances).build();
    }

    private static ProcessInstance instance(String businessId, String stateUuid, String... assignees) {
        List<User> users = new ArrayList<>();
        Arrays.stream(assignees).forEach(uuid -> {
            User user = new User();
            user.setUuid(uuid);
            users.add(user);
        });
        State state = new State();
        state.setUuid(stateUuid);
        return ProcessInstance.builder().businessId(businessId).state(state).assignes(users).build();
    }
}
