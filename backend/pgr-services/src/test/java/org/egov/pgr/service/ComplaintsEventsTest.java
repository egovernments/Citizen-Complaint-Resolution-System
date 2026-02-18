package org.egov.pgr.service;

import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.producer.Producer;
import org.egov.pgr.repository.PGRRepository;
import org.egov.pgr.util.MDMSUtils;
import org.egov.pgr.validator.ServiceRequestValidator;
import org.egov.pgr.web.models.*;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.MockitoJUnitRunner;

import java.util.*;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

@RunWith(MockitoJUnitRunner.class)
public class ComplaintsEventsTest {
    @Mock
    private EnrichmentService enrichmentService;
    @Mock
    private UserService userService;
    @Mock
    private WorkflowService workflowService;
    @Mock
    private ServiceRequestValidator serviceRequestValidator;
    @Mock
    private ServiceRequestValidator validator;
    @Mock
    private Producer producer;
    @Mock
    private PGRConfiguration config;
    @Mock
    private PGRRepository repository;
    @Mock
    private MDMSUtils mdmsUtils;
    @Mock
    private ComplaintDomainEventService complaintDomainEventService;

    @InjectMocks
    private PGRService pgrService;

    @InjectMocks
    private ComplaintDomainEventService domainEventService;

    private ServiceRequest request;

    @Before
    public void setup() {
        request = buildRequest("APPLY", "PENDINGFORASSIGNMENT", "pb.amritsar");
        when(config.getCreateTopic()).thenReturn("save-pgr-request");
        when(config.getInboxCreateTopic()).thenReturn("inbox-pgr-events");
        when(config.getUpdateTopic()).thenReturn("update-pgr-request");
        when(config.getInboxUpdateTopic()).thenReturn("inbox-pgr-events");
        when(mdmsUtils.mDMSCall(any(ServiceRequest.class))).thenReturn(buildMdmsData());
        when(config.getIsComplaintsDomainEventEnabled()).thenReturn(true);
        when(config.getComplaintsDomainEventsTopic()).thenReturn("complaints.domain.events");
        when(config.getComplaintsDomainEventDefaultLocale()).thenReturn("en_IN");
    }

    @Test
    public void shouldPublishDomainEventOnCreateAndKeepExistingPersisterPushes() {
        pgrService.create(request);

        verify(complaintDomainEventService).publishWorkflowTransitionEvent(eq(request), eq("PENDINGFORASSIGNMENT"));
        verify(producer).push("pb.amritsar", "save-pgr-request", request);
        verify(producer).push("pb.amritsar", "inbox-pgr-events", request);
    }

    @Test
    public void shouldPublishDomainEventOnUpdateAndKeepExistingPersisterPushes() {
        request.getWorkflow().setAction("ASSIGN");
        request.getService().setApplicationStatus("PENDINGFORASSIGNMENT");
        doAnswer(invocation -> {
            ServiceRequest req = invocation.getArgument(0);
            req.getService().setApplicationStatus("PENDINGATLME");
            return "PENDINGATLME";
        }).when(workflowService).updateWorkflowStatus(any(ServiceRequest.class));

        pgrService.update(request);

        verify(complaintDomainEventService).publishWorkflowTransitionEvent(eq(request), eq("PENDINGFORASSIGNMENT"));
        verify(producer).push("pb.amritsar", "update-pgr-request", request);
        verify(producer).push("pb.amritsar", "inbox-pgr-events", request);
    }

    @Test
    public void shouldPublishExpectedDomainEventPayload() {
        ServiceRequest eventRequest = buildRequest("ASSIGN", "PENDINGATLME", "pb.amritsar");
        domainEventService.publishWorkflowTransitionEvent(eventRequest, "PENDINGFORASSIGNMENT");

        ArgumentCaptor<Object> payloadCaptor = ArgumentCaptor.forClass(Object.class);
        verify(producer).push(eq("pb.amritsar"), eq("complaints.domain.events"), payloadCaptor.capture());

        Map<String, Object> payload = (Map<String, Object>) payloadCaptor.getValue();
        assertEquals("COMPLAINTS_WORKFLOW_TRANSITIONED", payload.get("eventType"));
        assertEquals("COMPLAINTS.WORKFLOW.ASSIGN", payload.get("eventName"));
        assertEquals("Complaints", payload.get("module"));
        assertEquals("COMPLAINT", payload.get("entityType"));
        assertEquals("CMP-123", payload.get("entityId"));

        Map<String, Object> workflow = (Map<String, Object>) payload.get("workflow");
        assertEquals("ASSIGN", workflow.get("action"));
        assertEquals("PENDINGFORASSIGNMENT", workflow.get("fromState"));
        assertEquals("PENDINGATLME", workflow.get("toState"));

        Map<String, Object> context = (Map<String, Object>) payload.get("context");
        assertEquals("en_IN", context.get("locale"));

        List<Map<String, Object>> stakeholders = (List<Map<String, Object>>) payload.get("stakeholders");
        assertNotNull(stakeholders);
        assertEquals(2, stakeholders.size());
    }

    @Test
    public void shouldNotPublishWhenDisabled() {
        when(config.getIsComplaintsDomainEventEnabled()).thenReturn(false);
        domainEventService.publishWorkflowTransitionEvent(buildRequest("ASSIGN", "PENDINGATLME", "pb.amritsar"),
                "PENDINGFORASSIGNMENT");
        verify(producer, never()).push(any(), any(), any());
    }

    private static ServiceRequest buildRequest(String action, String status, String tenantId) {
        org.egov.common.contract.request.User actor = org.egov.common.contract.request.User.builder()
                .uuid("actor-uuid")
                .type("EMPLOYEE")
                .tenantId(tenantId)
                .build();

        org.egov.common.contract.request.RequestInfo requestInfo = new org.egov.common.contract.request.RequestInfo();
        requestInfo.setUserInfo(actor);

        User citizen = User.builder()
                .uuid("citizen-uuid")
                .mobileNumber("9999999999")
                .build();

        Address address = Address.builder()
                .id(UUID.randomUUID().toString())
                .tenantId(tenantId)
                .locality(Boundary.builder().code("LOC1").build())
                .geoLocation(GeoLocation.builder().latitude(31.63).longitude(74.87).build())
                .build();

        Service service = Service.builder()
                .id(UUID.randomUUID().toString())
                .tenantId(tenantId)
                .serviceCode("POTHOLE")
                .serviceRequestId("CMP-123")
                .applicationStatus(status)
                .source("web")
                .accountId("citizen-uuid")
                .citizen(citizen)
                .address(address)
                .auditDetails(AuditDetails.builder().createdBy("citizen-uuid").createdTime(System.currentTimeMillis()).build())
                .build();

        Workflow workflow = Workflow.builder()
                .action(action)
                .assignes(Collections.singletonList("employee-uuid"))
                .build();

        return ServiceRequest.builder().requestInfo(requestInfo).service(service).workflow(workflow).build();
    }

    private static Map<String, Object> buildMdmsData() {
        Map<String, Object> serviceDef = new HashMap<>();
        serviceDef.put("serviceCode", "POTHOLE");
        serviceDef.put("department", "SANITATION");

        Map<String, Object> rainmaker = new HashMap<>();
        rainmaker.put("ServiceDefs", Collections.singletonList(serviceDef));

        Map<String, Object> mdmsRes = new HashMap<>();
        mdmsRes.put("RAINMAKER-PGR", rainmaker);

        Map<String, Object> data = new HashMap<>();
        data.put("MdmsRes", mdmsRes);
        return data;
    }
}
