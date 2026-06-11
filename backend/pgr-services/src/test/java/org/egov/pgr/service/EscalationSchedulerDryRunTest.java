package org.egov.pgr.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.egov.common.contract.request.RequestInfo;
import org.egov.common.utils.MultiStateInstanceUtil;
import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.producer.Producer;
import org.egov.pgr.repository.PGRRepository;
import org.egov.pgr.repository.ServiceRequestRepository;
import org.egov.pgr.util.EscalationSkipReason;
import org.egov.pgr.util.MDMSUtils;
import org.egov.pgr.util.PGRConstants;
import org.egov.pgr.web.models.AuditDetails;
import org.egov.pgr.web.models.EscalationTriggerResponse;
import org.egov.pgr.web.models.RequestSearchCriteria;
import org.egov.pgr.web.models.Service;
import org.egov.pgr.web.models.ServiceWrapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.util.Collections;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Behavioural coverage for the {@code dryRun} path of
 * {@link EscalationScheduler#scanAndEscalateOnce(String, java.util.List, RequestInfo, boolean)}:
 * a breached complaint must be reported as {@code WOULD_ESCALATE} via
 * {@link EscalationService#previewEscalation} while the mutating
 * {@code escalateComplaintWithReason} is never invoked.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
public class EscalationSchedulerDryRunTest {

    @Mock private PGRConfiguration config;
    @Mock private PGRRepository repository;
    @Mock private EscalationService escalationService;
    @Mock private ServiceRequestRepository serviceRequestRepository;
    @Mock private MDMSUtils mdmsUtils;
    @Mock private MultiStateInstanceUtil multiStateInstanceUtil;
    @Mock private Producer producer;

    private EscalationScheduler scheduler;

    @BeforeEach
    void setup() {
        scheduler = new EscalationScheduler(
                config, repository, escalationService, serviceRequestRepository,
                mdmsUtils, new ObjectMapper(), multiStateInstanceUtil, producer);
        when(config.getEscalationMaxDepth()).thenReturn(3);
        when(config.getEscalationDefaultSlaMs()).thenReturn(60_000L); // 1-minute SLA → breached below
        when(config.getEscalationBatchSize()).thenReturn(100);
        when(config.getEscalationIntervalMs()).thenReturn(300_000L);
    }

    @Test
    void dryRun_breachedComplaint_recordsWouldEscalate_andNeverMutates() {
        Service complaint = breachedComplaint("PGR-DRY-1");
        ServiceWrapper wrapper = ServiceWrapper.builder().service(complaint).build();
        // Surface the complaint only for PENDINGATLME so it's scanned exactly once.
        when(repository.getServiceWrappers(any())).thenAnswer(inv -> {
            RequestSearchCriteria criteria = inv.getArgument(0);
            return criteria.getApplicationStatus() != null
                    && criteria.getApplicationStatus().contains(PGRConstants.PENDINGATLME)
                    ? Collections.singletonList(wrapper)
                    : Collections.emptyList();
        });
        when(escalationService.getCurrentAssignees(eq("PGR-DRY-1"), anyString(), any()))
                .thenReturn(Collections.singletonList("emp-1-uuid"));
        when(escalationService.previewEscalation(any(), any(), any(), anyInt(), anyLong(), anyLong()))
                .thenReturn(EscalationService.EscalationResult.builder()
                        .success(true)
                        .reason(EscalationSkipReason.SUCCESS)
                        .detail("would escalate to sup-1 (level 0→1), elapsed=7200000ms, sla=60000ms")
                        .newAssigneeUuid("sup-1")
                        .newLevel(1)
                        .build());

        EscalationTriggerResponse response = scheduler.scanAndEscalateOnce(
                "ke", null, RequestInfo.builder().build(), true);

        assertTrue(response.isDryRun());
        assertEquals(1, response.getScanned());
        // Dry runs never count as real escalations — they surface separately.
        assertEquals(0, response.getEscalated());
        assertEquals(1, response.getWouldEscalate());
        assertTrue(response.getDetails().stream()
                        .anyMatch(d -> "WOULD_ESCALATE".equals(d.getAction())
                                && "PGR-DRY-1".equals(d.getServiceRequestId())),
                "expected a WOULD_ESCALATE outcome for the breached complaint");

        verify(escalationService, never())
                .escalateComplaintWithReason(any(), any(), any(), anyInt(), anyLong(), anyLong());
        verify(producer, never()).push(anyString(), anyString(), any());
    }

    private static Service breachedComplaint(String srid) {
        Service s = new Service();
        s.setServiceRequestId(srid);
        s.setTenantId("ke.bomet");
        s.setServiceCode("svc");
        long twoHoursAgo = System.currentTimeMillis() - 7_200_000L;
        s.setAuditDetails(AuditDetails.builder()
                .createdTime(twoHoursAgo)
                .lastModifiedTime(twoHoursAgo)
                .build());
        return s;
    }
}
