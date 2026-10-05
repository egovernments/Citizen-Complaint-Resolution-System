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
import java.util.List;
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

    /** Stubs workflow: latest-only assignee search, history assignee search, batched history search. */
    private void stubWorkflow(List<ProcessInstance> latestNamingLme, List<ProcessInstance> everNamingLme,
                              List<ProcessInstance> histories) {
        when(repository.fetchResult(any(), any())).thenAnswer(inv -> {
            String url = inv.getArgument(0).toString();
            urls.add(url);
            if (url.contains("assignee=") && url.contains("history=false"))
                return response(latestNamingLme);
            if (url.contains("assignee=") && url.contains("history=true"))
                return response(everNamingLme);
            if (url.contains("businessIds="))
                return response(histories);
            throw new AssertionError("unexpected workflow call " + url);
        });
    }

    @Test
    void citizenCommentAfterAssignDoesNotDropTheHolder() {
        // Live scenario: a ward-B complaint assigned to the ward-A LME, then the citizen comments.
        // The COMMENT is now the newest transition and names nobody.
        ProcessInstance assign = instance("PGR-B", PENDING_AT_LME, LME);
        ProcessInstance comment = instance("PGR-B", PENDING_AT_LME);
        stubWorkflow(List.of(), List.of(assign), List.of(comment, assign));

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
        stubWorkflow(List.of(), List.of(assignedToMe1, assignedToMe2),
                List.of(reassign, assignedToOther, assignedToMe1, assignedToMe2));

        assertTrue(workflowService.getServiceRequestIdsByAssignee(new RequestInfo(), TENANT, LME).isEmpty());
    }

    @Test
    void latestTransitionNamingTheAssigneeNeedsNoHistory() {
        ProcessInstance assign = instance("PGR-1", PENDING_AT_LME, LME);
        stubWorkflow(List.of(assign), List.of(assign), List.of());

        assertEquals(Set.of("PGR-1"), workflowService.getServiceRequestIdsByAssignee(new RequestInfo(), TENANT, LME));
        assertTrue(urls.stream().noneMatch(u -> u.contains("businessIds=")), "no candidates left to walk: " + urls);
    }

    @Test
    void everyWorkflowSearchPassesAnExplicitLimit() {
        // egov-workflow-v2 otherwise returns its default page (10 in the stock jar).
        ProcessInstance assign = instance("PGR-B", PENDING_AT_LME, LME);
        stubWorkflow(List.of(), List.of(assign), List.of(instance("PGR-B", PENDING_AT_LME), assign));

        workflowService.getServiceRequestIdsByAssignee(new RequestInfo(), TENANT, LME);

        assertEquals(3, urls.size(), urls.toString());
        urls.forEach(u -> assertTrue(u.contains("limit=" + WorkflowService.ASSIGNEE_SEARCH_LIMIT), u));
    }

    @Test
    void historyFailureKeepsTheLatestTransitionResult() {
        ProcessInstance assign = instance("PGR-1", PENDING_AT_LME, LME);
        when(repository.fetchResult(any(), any())).thenAnswer(inv -> {
            String url = inv.getArgument(0).toString();
            if (url.contains("history=false"))
                return response(List.of(assign));
            return null; // ServiceRequestRepository's shape for a failed call
        });

        assertEquals(Set.of("PGR-1"), workflowService.getServiceRequestIdsByAssignee(new RequestInfo(), TENANT, LME));
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
