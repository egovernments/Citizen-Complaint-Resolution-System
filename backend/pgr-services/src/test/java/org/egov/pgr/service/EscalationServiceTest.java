package org.egov.pgr.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.egov.common.contract.request.RequestInfo;
import org.egov.common.contract.request.User;
import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.producer.Producer;
import org.egov.pgr.repository.ServiceRequestRepository;
import org.egov.pgr.util.EscalationSkipReason;
import org.egov.pgr.util.HRMSUtil;
import org.egov.pgr.web.models.AuditDetails;
import org.egov.pgr.web.models.Service;
import org.egov.pgr.web.models.ServiceRequest;
import org.egov.pgr.web.models.Workflow;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.util.Collections;
import java.util.HashMap;
import java.util.Map;

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
                escalationService.escalateComplaintWithReason(complaint, currentWorkflow, systemRequestInfo,
                        3, 7_200_000L, 3_600_000L);

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
                escalationService.escalateComplaintWithReason(complaint, currentWorkflow, systemRequestInfo,
                        3, 7_200_000L, 3_600_000L);

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
                escalationService.escalateComplaintWithReason(complaint, currentWorkflow, systemRequestInfo,
                        3, 7_200_000L, 3_600_000L);

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
                escalationService.escalateComplaintWithReason(complaint, empty, systemRequestInfo,
                        3, 7_200_000L, 3_600_000L);

        assertFalse(result.isSuccess());
        assertEquals(EscalationSkipReason.NO_ASSIGNEES, result.getReason());
        verify(workflowService, times(0)).updateWorkflowStatus(any());
    }

    @Test
    void previewEscalation_zeroMutations_returnsSupervisorUuid() {
        when(hrmsUtil.getSupervisorUuid(eq("emp-1-uuid"), any(), eq("ke.bomet")))
                .thenReturn("supervisor-uuid");

        EscalationService.EscalationResult result =
                escalationService.previewEscalation(complaint, currentWorkflow, systemRequestInfo,
                        3, 7_200_000L, 3_600_000L);

        assertTrue(result.isSuccess());
        assertEquals("supervisor-uuid", result.getNewAssigneeUuid());
        assertEquals(Integer.valueOf(1), result.getNewLevel());
        assertNotNull(result.getDetail());
        assertTrue(result.getDetail().contains("would escalate to supervisor-uuid"));

        // Dry-run must not mutate anything: no workflow transition, no Kafka.
        verify(workflowService, times(0)).updateWorkflowStatus(any());
        verify(producer, times(0)).push(anyString(), anyString(), any());
    }

    @Test
    void happyPath_refreshesAuditLastModified_soNextTickGetsFreshSlaWindow() {
        long testStart = System.currentTimeMillis();
        long staleTime = testStart - 100_000L;
        complaint.setAuditDetails(AuditDetails.builder()
                .createdTime(staleTime)
                .lastModifiedTime(staleTime)
                .lastModifiedBy("old-user-uuid")
                .build());
        when(hrmsUtil.getSupervisorUuid(eq("emp-1-uuid"), any(), eq("ke.bomet")))
                .thenReturn("supervisor-uuid");

        EscalationService.EscalationResult result =
                escalationService.escalateComplaintWithReason(complaint, currentWorkflow, systemRequestInfo,
                        3, 7_200_000L, 3_600_000L);

        assertTrue(result.isSuccess());
        // The persister maps lastmodifiedtime from this object — it must be
        // refreshed to "now" so the next scheduler tick measures elapsed time
        // from the escalation moment, not the pre-escalation timestamp.
        assertNotNull(complaint.getAuditDetails().getLastModifiedTime());
        assertTrue(complaint.getAuditDetails().getLastModifiedTime() >= testStart,
                "lastModifiedTime must be refreshed on successful escalation (fresh SLA window per level)");
        assertEquals("system-uuid", complaint.getAuditDetails().getLastModifiedBy());
    }

    @Test
    void previewEscalation_leavesAuditDetailsUntouched() {
        long staleTime = System.currentTimeMillis() - 100_000L;
        complaint.setAuditDetails(AuditDetails.builder()
                .createdTime(staleTime)
                .lastModifiedTime(staleTime)
                .lastModifiedBy("old-user-uuid")
                .build());
        when(hrmsUtil.getSupervisorUuid(eq("emp-1-uuid"), any(), eq("ke.bomet")))
                .thenReturn("supervisor-uuid");

        EscalationService.EscalationResult result =
                escalationService.previewEscalation(complaint, currentWorkflow, systemRequestInfo,
                        3, 7_200_000L, 3_600_000L);

        assertTrue(result.isSuccess());
        // Dry-run is read-only: the SLA clock must NOT be reset.
        assertEquals(Long.valueOf(staleTime), complaint.getAuditDetails().getLastModifiedTime());
        assertEquals("old-user-uuid", complaint.getAuditDetails().getLastModifiedBy());
    }

    @Test
    void commentEnrichment_includesNameAndDesignation_whenHrmsSummaryResolves() {
        when(hrmsUtil.getSupervisorUuid(eq("emp-1-uuid"), any(), eq("ke.bomet")))
                .thenReturn("supervisor-uuid");
        Map<String, String> summary = new HashMap<>();
        summary.put("name", "Jane Wanjiku");
        summary.put("designation", "DEPT_HEAD");
        when(hrmsUtil.getEmployeeSummary(eq("supervisor-uuid"), any(), eq("ke.bomet")))
                .thenReturn(summary);

        EscalationService.EscalationResult result =
                escalationService.escalateComplaintWithReason(complaint, currentWorkflow, systemRequestInfo,
                        3, 36_000_000L, 14_400_000L); // elapsed 10h, SLA 4h

        assertTrue(result.isSuccess());
        ArgumentCaptor<ServiceRequest> captor = ArgumentCaptor.forClass(ServiceRequest.class);
        verify(workflowService).updateWorkflowStatus(captor.capture());
        assertEquals("Auto-escalated to Jane Wanjiku (DEPT_HEAD): SLA breached at level 0 (elapsed 10h > SLA 4h)",
                captor.getValue().getWorkflow().getComments());
    }

    @Test
    void commentEnrichment_nameOnlyTier_whenDesignationMissingFromSummary() {
        when(hrmsUtil.getSupervisorUuid(eq("emp-1-uuid"), any(), eq("ke.bomet")))
                .thenReturn("supervisor-uuid");
        // Partial HRMS summary: designation read failed, name resolved.
        Map<String, String> summary = new HashMap<>();
        summary.put("name", "Jane Wanjiku");
        when(hrmsUtil.getEmployeeSummary(eq("supervisor-uuid"), any(), eq("ke.bomet")))
                .thenReturn(summary);

        EscalationService.EscalationResult result =
                escalationService.escalateComplaintWithReason(complaint, currentWorkflow, systemRequestInfo,
                        3, 36_000_000L, 14_400_000L); // elapsed 10h, SLA 4h

        assertTrue(result.isSuccess());
        ArgumentCaptor<ServiceRequest> captor = ArgumentCaptor.forClass(ServiceRequest.class);
        verify(workflowService).updateWorkflowStatus(captor.capture());
        // Name-only tier: human-readable name, no "(designation)" and no raw uuid.
        assertEquals("Auto-escalated to Jane Wanjiku: SLA breached at level 0 (elapsed 10h > SLA 4h)",
                captor.getValue().getWorkflow().getComments());
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
