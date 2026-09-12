package org.egov.pgr.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.egov.common.contract.request.RequestInfo;
import org.egov.common.contract.request.User;
import org.egov.pgr.repository.ServiceRequestRepository;
import org.egov.pgr.util.HRMSUtil;
import org.egov.pgr.web.models.AuditDetails;
import org.egov.pgr.web.models.Service;
import org.egov.pgr.web.models.ServiceRequest;
import org.egov.pgr.web.models.Workflow;
import org.egov.pgr.web.models.workflow.ProcessInstance;
import org.egov.pgr.web.models.workflow.ProcessInstanceResponse;
import org.egov.tracer.model.CustomException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.egov.pgr.service.EscalationService.ASSIGNMENT_CHANGED_AT;
import static org.egov.pgr.service.EscalationService.ESCALATED_FROM;
import static org.egov.pgr.service.EscalationService.ESCALATED_TO;
import static org.egov.pgr.service.EscalationService.ESCALATION_LEVEL;
import static org.egov.pgr.service.EscalationService.ESCALATION_TRIGGER;
import static org.egov.pgr.service.EscalationService.LAST_ESCALATED_AT;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class EscalationServiceTest {

    @Mock private HRMSUtil hrmsUtil;
    @Mock private WorkflowService workflowService;
    @Mock private ServiceRequestRepository repository;
    @Mock private EscalationConfigurationService configurationService;

    private EscalationService service;

    @BeforeEach
    void setUp() {
        service = new EscalationService(hrmsUtil, workflowService, repository,
                configurationService, new ObjectMapper());
        when(configurationService.resolve(any(), anyString())).thenReturn(
                new EscalationConfigurationService.ResolvedEscalationConfig(
                        3, List.of(100L, 200L, 300L), Collections.emptyList(), Collections.emptyMap()));
        when(workflowService.getprocessInstanceSearchURL(anyString(), anyString()))
                .thenReturn(new StringBuilder("http://workflow/process/_search"));
    }

    @Test
    void manualAndAutomaticUseSameTargetDepthAndClockMetadata() {
        stubCurrentAssignee("employee-a");
        when(hrmsUtil.getSupervisorUuid(org.mockito.ArgumentMatchers.eq("employee-a"), any(),
                org.mockito.ArgumentMatchers.eq("ke.bomet")))
                .thenReturn("employee-b");

        Service persisted = complaint(Map.of(ESCALATION_LEVEL, 0, ASSIGNMENT_CHANGED_AT, 10L));
        ServiceRequest manual = request(persisted, manualInfo(), List.of("employee-b"));
        service.prepareUpdate(manual, persisted);

        Map<String, Object> manualDetails = details(manual.getService());
        assertEquals(List.of("employee-b"), manual.getWorkflow().getAssignes());
        assertEquals(1, manualDetails.get(ESCALATION_LEVEL));
        assertEquals(List.of("employee-a"), manualDetails.get(ESCALATED_FROM));
        assertEquals("employee-b", manualDetails.get(ESCALATED_TO));
        assertEquals("MANUAL", manualDetails.get(ESCALATION_TRIGGER));
        assertNotNull(manualDetails.get(LAST_ESCALATED_AT));
        assertEquals(manualDetails.get(LAST_ESCALATED_AT), manualDetails.get(ASSIGNMENT_CHANGED_AT));

        RequestInfo automaticInfo = automaticInfo();
        stubCurrentAssignee("employee-b");
        when(hrmsUtil.getSupervisorUuid("employee-b", automaticInfo, "ke.bomet"))
                .thenReturn("employee-c");
        ServiceRequest automatic = request(persisted, automaticInfo, null);
        service.prepareUpdate(automatic, persisted);

        Map<String, Object> automaticDetails = details(automatic.getService());
        assertEquals(List.of("employee-c"), automatic.getWorkflow().getAssignes());
        assertEquals(2, automaticDetails.get(ESCALATION_LEVEL));
        assertEquals(List.of("employee-b"), automaticDetails.get(ESCALATED_FROM));
        assertEquals("employee-c", automaticDetails.get(ESCALATED_TO));
        assertEquals("AUTOMATIC", automaticDetails.get(ESCALATION_TRIGGER));
    }

    @Test
    void manualEscalationRejectsAnArbitraryEmployee() {
        stubCurrentAssignee("employee-a");
        RequestInfo requestInfo = manualInfo();
        when(hrmsUtil.getSupervisorUuid("employee-a", requestInfo, "ke.bomet"))
                .thenReturn("employee-b");

        CustomException error = assertThrows(CustomException.class,
                () -> service.prepareUpdate(
                        request(complaint(Collections.emptyMap()), requestInfo, List.of("employee-c")),
                        complaint(Collections.emptyMap())));
        assertTrue(error.getMessage().contains("reportingTo"));
    }

    @Test
    void unassignedComplaintCannotEscalate() {
        stubCurrentAssignee();
        CustomException error = assertThrows(CustomException.class,
                () -> service.prepareUpdate(
                        request(complaint(Collections.emptyMap()), manualInfo(), null),
                        complaint(Collections.emptyMap())));
        assertTrue(error.getMessage().contains("ASSIGN"));
    }

    @Test
    void topOfReportingHierarchyCannotEscalate() {
        stubCurrentAssignee("employee-a");
        RequestInfo requestInfo = manualInfo();
        when(hrmsUtil.getSupervisorUuid("employee-a", requestInfo, "ke.bomet"))
                .thenReturn(null);

        CustomException error = assertThrows(CustomException.class,
                () -> service.prepareUpdate(
                        request(complaint(Collections.emptyMap()), requestInfo, null),
                        complaint(Collections.emptyMap())));

        assertTrue(error.getMessage().contains("reportingTo"));
    }

    @Test
    void maxDepthAppliesToManualEscalation() {
        Service persisted = complaint(Map.of(ESCALATION_LEVEL, 3));

        CustomException error = assertThrows(CustomException.class,
                () -> service.prepareUpdate(request(persisted, manualInfo(), null), persisted));

        assertTrue(error.getMessage().contains("maximum escalation depth"));
    }

    @Test
    void commentCannotForgeOrResetServerManagedClock() {
        Map<String, Object> persistedDetails = new LinkedHashMap<>();
        persistedDetails.put(ASSIGNMENT_CHANGED_AT, 1234L);
        persistedDetails.put(ESCALATION_LEVEL, 2);
        Service persisted = complaint(persistedDetails);
        Service incoming = complaint(Map.of(ASSIGNMENT_CHANGED_AT, 9999L, ESCALATION_LEVEL, 99));
        ServiceRequest request = ServiceRequest.builder()
                .requestInfo(manualInfo())
                .service(incoming)
                .workflow(Workflow.builder().action("COMMENT").build())
                .build();

        service.prepareUpdate(request, persisted);

        assertEquals(1234L, details(incoming).get(ASSIGNMENT_CHANGED_AT));
        assertEquals(2, details(incoming).get(ESCALATION_LEVEL));
    }

    @Test
    void assignmentStartsClockAndResetsHierarchyDepth() {
        Service persisted = complaint(Map.of(ASSIGNMENT_CHANGED_AT, 1234L, ESCALATION_LEVEL, 2));
        Service incoming = complaint(Collections.emptyMap());
        ServiceRequest request = ServiceRequest.builder()
                .requestInfo(manualInfo())
                .service(incoming)
                .workflow(Workflow.builder().action("ASSIGN").assignes(List.of("employee-x")).build())
                .build();

        service.prepareUpdate(request, persisted);

        Map<String, Object> result = details(incoming);
        assertEquals(0, result.get(ESCALATION_LEVEL));
        assertTrue(((Number) result.get(ASSIGNMENT_CHANGED_AT)).longValue() > 1234L);
    }

    @Test
    void dedicatedAssignmentClockWinsOverLaterAuditUpdate() {
        Service complaint = complaint(Map.of(ASSIGNMENT_CHANGED_AT, 1000L));
        complaint.setAuditDetails(AuditDetails.builder().createdTime(100L).lastModifiedTime(9000L).build());
        assertEquals(1000L, service.escalationWindowStartedAt(complaint));
    }

    private void stubCurrentAssignee(String... uuids) {
        List<User> users = java.util.Arrays.stream(uuids)
                .map(uuid -> User.builder().uuid(uuid).build())
                .toList();
        ProcessInstanceResponse response = ProcessInstanceResponse.builder()
                .processInstances(List.of(ProcessInstance.builder().assignes(users).build()))
                .build();
        when(repository.fetchResult(any(StringBuilder.class), any())).thenReturn(response);
    }

    private Service complaint(Map<String, Object> additionalDetails) {
        return Service.builder()
                .id("id-1")
                .serviceRequestId("PGR-1")
                .tenantId("ke.bomet")
                .serviceCode("ROAD.POTHOLE")
                .additionalDetail(new LinkedHashMap<>(additionalDetails))
                .build();
    }

    private ServiceRequest request(Service complaint, RequestInfo info, List<String> assignees) {
        return ServiceRequest.builder()
                .requestInfo(info)
                .service(complaint)
                .workflow(Workflow.builder().action("ESCALATE").assignes(assignees).build())
                .build();
    }

    private RequestInfo manualInfo() {
        return RequestInfo.builder().userInfo(User.builder().uuid("human").type("EMPLOYEE").build()).build();
    }

    private RequestInfo automaticInfo() {
        return RequestInfo.builder().userInfo(User.builder().uuid("system").type("SYSTEM").build()).build();
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> details(Service complaint) {
        return (Map<String, Object>) complaint.getAdditionalDetail();
    }
}
