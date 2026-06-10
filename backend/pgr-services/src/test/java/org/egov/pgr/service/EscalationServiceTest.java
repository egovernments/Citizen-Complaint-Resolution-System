package org.egov.pgr.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.egov.common.contract.request.RequestInfo;
import org.egov.common.contract.request.User;
import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.producer.Producer;
import org.egov.pgr.repository.ServiceRequestRepository;
import org.egov.pgr.util.EscalationSkipReason;
import org.egov.pgr.util.HRMSUtil;
import org.egov.pgr.web.models.Service;
import org.egov.pgr.web.models.Workflow;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.util.Collections;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Focused unit tests for {@link EscalationService#escalateComplaintWithReason}.
 *
 * <p>These are intentionally narrow — they cover one happy path and the two
 * skip paths that are tractable to mock (no supervisor, workflow rejection).
 * The richer "scan many complaints + breakdown counts" surface is covered
 * by the integration test that drives /escalation/_trigger end-to-end.</p>
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
public class EscalationServiceTest {

    @Mock private HRMSUtil hrmsUtil;
    @Mock private WorkflowService workflowService;
    @Mock private PGRConfiguration config;
    @Mock private Producer producer;
    @Mock private ServiceRequestRepository serviceRequestRepository;
    @Mock private ObjectMapper mapper;

    @InjectMocks
    private EscalationService escalationService;

    private RequestInfo systemRequestInfo;
    private Service complaint;
    private Workflow currentWorkflow;

    @BeforeEach
    void setup() {
        when(config.getEscalationMaxDepth()).thenReturn(3);
        when(config.getUpdateTopic()).thenReturn("update-pgr-topic");
        when(config.getEscalationKafkaTopic()).thenReturn("escalation-topic");

        systemRequestInfo = RequestInfo.builder()
                .userInfo(User.builder().uuid("system-uuid").type("SYSTEM").build())
                .build();

        complaint = Service.builder()
                .serviceRequestId("SR-001")
                .tenantId("ke.bomet")
                .serviceCode("POTHOLE")
                .build();

        currentWorkflow = Workflow.builder()
                .assignes(Collections.singletonList("emp-1-uuid"))
                .build();
    }

    @Test
    void happyPath_returnsSuccess_andPushesUpdateAndEvent() {
        when(hrmsUtil.getSupervisorUuid(eq("emp-1-uuid"), any(), eq("ke.bomet")))
                .thenReturn("supervisor-uuid");

        EscalationService.EscalationResult result =
                escalationService.escalateComplaintWithReason(complaint, currentWorkflow, systemRequestInfo);

        assertTrue(result.isSuccess(), "expected success result");
        assertEquals(EscalationSkipReason.SUCCESS, result.getReason());
        assertEquals("supervisor-uuid", result.getNewAssigneeUuid());
        assertEquals(Integer.valueOf(1), result.getNewLevel());

        // workflow transition + 2 Kafka pushes (update + escalation event)
        verify(workflowService, times(1)).updateWorkflowStatus(any());
        verify(producer, times(1)).push(eq("ke.bomet"), eq("update-pgr-topic"), any());
        verify(producer, times(1)).push(eq("ke.bomet"), eq("escalation-topic"), any());
    }

    @Test
    void noSupervisorInHRMS_returnsSkip_withNoSupervisorReason_andSkipsWorkflow() {
        when(hrmsUtil.getSupervisorUuid(anyString(), any(), anyString())).thenReturn(null);

        EscalationService.EscalationResult result =
                escalationService.escalateComplaintWithReason(complaint, currentWorkflow, systemRequestInfo);

        assertFalse(result.isSuccess());
        assertEquals(EscalationSkipReason.NO_SUPERVISOR_IN_HRMS, result.getReason());

        verify(workflowService, times(0)).updateWorkflowStatus(any());
        verify(producer, times(0)).push(anyString(), anyString(), any());
    }

    @Test
    void workflowTransitionThrows_returnsSkip_withWorkflowTransitionFailedReason() {
        when(hrmsUtil.getSupervisorUuid(eq("emp-1-uuid"), any(), eq("ke.bomet")))
                .thenReturn("supervisor-uuid");
        doThrow(new RuntimeException("workflow says no")).when(workflowService).updateWorkflowStatus(any());

        EscalationService.EscalationResult result =
                escalationService.escalateComplaintWithReason(complaint, currentWorkflow, systemRequestInfo);

        assertFalse(result.isSuccess());
        assertEquals(EscalationSkipReason.WORKFLOW_TRANSITION_FAILED, result.getReason());
        // detail should mention the underlying exception message
        assertNotNull(result.getDetail());
        assertTrue(result.getDetail().contains("workflow says no"));

        // No Kafka publish should have happened — transition failed before that.
        verify(producer, times(0)).push(anyString(), anyString(), any());
    }

    @Test
    void noCurrentAssignees_returnsSkip_withNoAssigneesReason() {
        Workflow empty = Workflow.builder().assignes(Collections.emptyList()).build();

        EscalationService.EscalationResult result =
                escalationService.escalateComplaintWithReason(complaint, empty, systemRequestInfo);

        assertFalse(result.isSuccess());
        assertEquals(EscalationSkipReason.NO_ASSIGNEES, result.getReason());
        verify(workflowService, times(0)).updateWorkflowStatus(any());
    }

    @Test
    void booleanFacade_stillReturnsTrueOnSuccess() {
        when(hrmsUtil.getSupervisorUuid(anyString(), any(), anyString())).thenReturn("sup-1");
        assertTrue(escalationService.escalateComplaint(complaint, currentWorkflow, systemRequestInfo));
    }

    @Test
    void booleanFacade_returnsFalseOnSkip() {
        when(hrmsUtil.getSupervisorUuid(anyString(), any(), anyString())).thenReturn(null);
        assertFalse(escalationService.escalateComplaint(complaint, currentWorkflow, systemRequestInfo));
    }
}
