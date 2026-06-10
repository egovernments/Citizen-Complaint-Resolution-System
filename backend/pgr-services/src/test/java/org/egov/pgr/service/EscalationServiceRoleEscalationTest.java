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
 * Focused unit tests for {@link EscalationService#escalateToRoleTarget} and
 * {@link EscalationService#previewRoleEscalation} — the role-path twins of
 * the named-assignee escalate/preview pair. The resolution itself is covered
 * by {@link EscalationServiceRoleResolverTest}; here it arrives pre-built.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
public class EscalationServiceRoleEscalationTest {

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
    private EscalationService.RoleResolution resolution;

    @BeforeEach
    void setup() {
        when(config.getUpdateTopic()).thenReturn("update-pgr-topic");
        when(config.getEscalationKafkaTopic()).thenReturn("escalation-topic");

        systemRequestInfo = RequestInfo.builder()
                .userInfo(User.builder().uuid("system-uuid").type("SYSTEM").build())
                .build();

        complaint = Service.builder()
                .serviceRequestId("SR-ROLE-001")
                .tenantId("ke.bomet")
                .serviceCode("POTHOLE")
                .build();

        resolution = EscalationService.RoleResolution.builder()
                .targetUuid("target-uuid")
                .strategy(EscalationService.STRATEGY_R1_PIN)
                .actingRole("GRO")
                .department("DEPT_18")
                .candidateCount(1)
                .departmentFiltered(true)
                .build();
    }

    @Test
    void escalateToRoleTarget_happyPath_assignsTargetWithRoleComment() {
        Map<String, String> summary = new HashMap<>();
        summary.put("name", "Jane Wanjiku");
        summary.put("designation", "DEPT_HEAD");
        when(hrmsUtil.getEmployeeSummary(eq("target-uuid"), any(), eq("ke.bomet"))).thenReturn(summary);

        EscalationService.EscalationResult result = escalationService.escalateToRoleTarget(
                complaint, "target-uuid", systemRequestInfo, 3, 36_000_000L, 14_400_000L, resolution);

        assertTrue(result.isSuccess());
        assertEquals("target-uuid", result.getNewAssigneeUuid());
        assertEquals(Integer.valueOf(1), result.getNewLevel());

        ArgumentCaptor<ServiceRequest> captor = ArgumentCaptor.forClass(ServiceRequest.class);
        verify(workflowService).updateWorkflowStatus(captor.capture());
        assertEquals(Collections.singletonList("target-uuid"), captor.getValue().getWorkflow().getAssignes());
        assertEquals("Auto-escalated (no recorded assignee): assigned to Jane Wanjiku (DEPT_HEAD)"
                        + " — acting role GRO (elapsed 10h > SLA 4h)",
                captor.getValue().getWorkflow().getComments());

        verify(producer, times(1)).push(eq("ke.bomet"), eq("update-pgr-topic"), any());
        verify(producer, times(1)).push(eq("ke.bomet"), eq("escalation-topic"), any());
    }

    /** The Kafka escalation event must carry the role-resolution provenance. */
    @Test
    @SuppressWarnings("unchecked")
    void escalateToRoleTarget_kafkaEventCarriesProvenance() {
        EscalationService.EscalationResult result = escalationService.escalateToRoleTarget(
                complaint, "target-uuid", systemRequestInfo, 3, 36_000_000L, 14_400_000L, resolution);

        assertTrue(result.isSuccess());
        ArgumentCaptor<Object> eventCaptor = ArgumentCaptor.forClass(Object.class);
        verify(producer).push(eq("ke.bomet"), eq("escalation-topic"), eventCaptor.capture());
        Map<String, Object> event = (Map<String, Object>) eventCaptor.getValue();
        assertEquals(Boolean.TRUE, event.get("roleEscalation"));
        assertEquals("GRO", event.get("actingRole"));
        assertEquals(EscalationService.STRATEGY_R1_PIN, event.get("resolutionStrategy"));
        assertEquals(1, event.get("candidateCount"));
        assertEquals(Boolean.TRUE, event.get("departmentFiltered"));
        assertEquals("target-uuid", event.get("newAssignee"));
        assertEquals(Collections.emptyList(), event.get("previousAssignees"));
    }

    /** PRD P6: the role path resets the SLA clock exactly like the named-assignee path. */
    @Test
    void escalateToRoleTarget_refreshesAuditLastModified() {
        long testStart = System.currentTimeMillis();
        long staleTime = testStart - 100_000L;
        complaint.setAuditDetails(AuditDetails.builder()
                .createdTime(staleTime)
                .lastModifiedTime(staleTime)
                .lastModifiedBy("old-user-uuid")
                .build());

        EscalationService.EscalationResult result = escalationService.escalateToRoleTarget(
                complaint, "target-uuid", systemRequestInfo, 3, 7_200_000L, 3_600_000L, resolution);

        assertTrue(result.isSuccess());
        assertTrue(complaint.getAuditDetails().getLastModifiedTime() >= testStart,
                "lastModifiedTime must be refreshed so the next level gets a fresh SLA window");
        assertEquals("system-uuid", complaint.getAuditDetails().getLastModifiedBy());
    }

    /** Tenant-wide retry fired (departmentFiltered=false with a department) ⇒ comment notes the fallback. */
    @Test
    void escalateToRoleTarget_departmentFallback_notedInComment() {
        EscalationService.RoleResolution fallbackResolution = EscalationService.RoleResolution.builder()
                .targetUuid("target-uuid")
                .strategy(EscalationService.STRATEGY_R2_LADDER)
                .actingRole("GRO")
                .department("DEPT_18")
                .candidateCount(1)
                .departmentFiltered(false)
                .build();

        escalationService.escalateToRoleTarget(
                complaint, "target-uuid", systemRequestInfo, 3, 36_000_000L, 14_400_000L, fallbackResolution);

        ArgumentCaptor<ServiceRequest> captor = ArgumentCaptor.forClass(ServiceRequest.class);
        verify(workflowService).updateWorkflowStatus(captor.capture());
        assertTrue(captor.getValue().getWorkflow().getComments().endsWith(", department fallback"),
                "the unfiltered-retry provenance must be visible in the audit comment");
    }

    /** Empty HRMS summary ⇒ uuid-tier comment, never a blank name. */
    @Test
    void escalateToRoleTarget_uuidFallbackComment_whenSummaryEmpty() {
        when(hrmsUtil.getEmployeeSummary(anyString(), any(), anyString())).thenReturn(new HashMap<>());

        escalationService.escalateToRoleTarget(
                complaint, "target-uuid", systemRequestInfo, 3, 36_000_000L, 14_400_000L, resolution);

        ArgumentCaptor<ServiceRequest> captor = ArgumentCaptor.forClass(ServiceRequest.class);
        verify(workflowService).updateWorkflowStatus(captor.capture());
        assertEquals("Auto-escalated (no recorded assignee): assigned to target-uuid"
                        + " — acting role GRO (elapsed 10h > SLA 4h)",
                captor.getValue().getWorkflow().getComments());
    }

    @Test
    void escalateToRoleTarget_workflowRejection_returnsTransitionFailedSkip() {
        doThrow(new RuntimeException("workflow says no")).when(workflowService).updateWorkflowStatus(any());

        EscalationService.EscalationResult result = escalationService.escalateToRoleTarget(
                complaint, "target-uuid", systemRequestInfo, 3, 7_200_000L, 3_600_000L, resolution);

        assertFalse(result.isSuccess());
        assertEquals(EscalationSkipReason.WORKFLOW_TRANSITION_FAILED, result.getReason());
        assertTrue(result.getDetail().contains("workflow says no"));
        verify(producer, times(0)).push(anyString(), anyString(), any());
    }

    @Test
    void escalateToRoleTarget_maxDepth_skips() {
        Map<String, Object> details = new HashMap<>();
        details.put("escalationLevel", 3);
        complaint.setAdditionalDetail(details);

        EscalationService.EscalationResult result = escalationService.escalateToRoleTarget(
                complaint, "target-uuid", systemRequestInfo, 3, 7_200_000L, 3_600_000L, resolution);

        assertFalse(result.isSuccess());
        assertEquals(EscalationSkipReason.MAX_DEPTH_REACHED, result.getReason());
        verify(workflowService, times(0)).updateWorkflowStatus(any());
        verify(producer, times(0)).push(anyString(), anyString(), any());
    }

    @Test
    void previewRoleEscalation_zeroMutations_returnsTargetUuid() {
        long staleTime = System.currentTimeMillis() - 100_000L;
        complaint.setAuditDetails(AuditDetails.builder()
                .createdTime(staleTime)
                .lastModifiedTime(staleTime)
                .lastModifiedBy("old-user-uuid")
                .build());

        EscalationService.EscalationResult result = escalationService.previewRoleEscalation(
                complaint, "target-uuid", systemRequestInfo, 3, 7_200_000L, 3_600_000L, resolution);

        assertTrue(result.isSuccess());
        assertEquals("target-uuid", result.getNewAssigneeUuid());
        assertEquals(Integer.valueOf(1), result.getNewLevel());
        assertTrue(result.getDetail().contains("would escalate to target-uuid"));
        assertTrue(result.getDetail().contains(EscalationService.STRATEGY_R1_PIN));

        // Dry-run is read-only: no transition, no Kafka, clock untouched.
        verify(workflowService, times(0)).updateWorkflowStatus(any());
        verify(producer, times(0)).push(anyString(), anyString(), any());
        assertEquals(Long.valueOf(staleTime), complaint.getAuditDetails().getLastModifiedTime());
        assertEquals("old-user-uuid", complaint.getAuditDetails().getLastModifiedBy());
    }
}
