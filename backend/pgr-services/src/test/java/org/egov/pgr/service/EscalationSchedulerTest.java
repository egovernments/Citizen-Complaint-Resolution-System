package org.egov.pgr.service;

import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.repository.PGRRepository;
import org.egov.pgr.web.models.AuditDetails;
import org.egov.pgr.web.models.RequestSearchCriteria;
import org.egov.pgr.web.models.Service;
import org.egov.pgr.web.models.ServiceRequest;
import org.egov.pgr.web.models.ServiceWrapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Collections;
import java.util.List;
import java.util.Map;

import static org.egov.pgr.service.EscalationService.ASSIGNMENT_CHANGED_AT;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class EscalationSchedulerTest {

    @Mock private PGRConfiguration config;
    @Mock private PGRRepository repository;
    @Mock private EscalationService escalationService;
    @Mock private EscalationConfigurationService configurationService;
    @Mock private PGRService pgrService;

    @Test
    void dueDecisionUsesAssignmentClockAndSubmitsThroughNormalUpdatePath() {
        EscalationScheduler scheduler = new EscalationScheduler(
                config, repository, escalationService, configurationService, pgrService);
        long assignmentTime = System.currentTimeMillis() - 1_000L;
        Service complaint = Service.builder()
                .id("id-1")
                .tenantId("ke.bomet")
                .serviceRequestId("PGR-1")
                .serviceCode("ROAD.POTHOLE")
                .applicationStatus("PENDINGATLME")
                .additionalDetail(Map.of(ASSIGNMENT_CHANGED_AT, assignmentTime))
                // A recent ordinary edit must not postpone the escalation.
                .auditDetails(AuditDetails.builder().lastModifiedTime(System.currentTimeMillis()).build())
                .build();

        when(config.getEscalationEnabled()).thenReturn(true);
        when(config.getUiAppHostMap()).thenReturn(Map.of("ke", "https://example.invalid"));
        when(config.getEgovInternalMicroserviceUserUuid()).thenReturn("system-user");
        when(config.getEscalationBatchSize()).thenReturn(100);
        when(configurationService.resolve(any(), any())).thenReturn(
                new EscalationConfigurationService.ResolvedEscalationConfig(
                        3, List.of(100L), Collections.emptyList(), Collections.emptyMap()));
        when(escalationService.escalationLevel(complaint)).thenReturn(0);
        when(escalationService.escalationWindowStartedAt(complaint)).thenReturn(assignmentTime);
        when(repository.getServiceWrappers(any(RequestSearchCriteria.class))).thenAnswer(invocation -> {
            RequestSearchCriteria criteria = invocation.getArgument(0);
            return criteria.getApplicationStatus().contains("PENDINGATLME")
                    ? List.of(ServiceWrapper.builder().service(complaint).build())
                    : Collections.emptyList();
        });

        scheduler.scanAndEscalate();

        ArgumentCaptor<ServiceRequest> request = ArgumentCaptor.forClass(ServiceRequest.class);
        verify(pgrService).update(request.capture());
        assertEquals("ESCALATE", request.getValue().getWorkflow().getAction());
        assertNull(request.getValue().getWorkflow().getAssignes());
        assertEquals("SYSTEM", request.getValue().getRequestInfo().getUserInfo().getType());
    }

    @Test
    void batchSizePagesThroughEveryComplaintInsteadOfCappingTheRun() {
        EscalationScheduler scheduler = new EscalationScheduler(
                config, repository, escalationService, configurationService, pgrService);
        long assignmentTime = System.currentTimeMillis() - 1_000L;
        Service first = dueComplaint("PGR-1", assignmentTime);
        Service second = dueComplaint("PGR-2", assignmentTime);
        Service third = dueComplaint("PGR-3", assignmentTime);

        when(config.getEscalationEnabled()).thenReturn(true);
        when(config.getUiAppHostMap()).thenReturn(Map.of("ke", "https://example.invalid"));
        when(config.getEgovInternalMicroserviceUserUuid()).thenReturn("system-user");
        when(config.getEscalationBatchSize()).thenReturn(2);
        when(configurationService.resolve(any(), any())).thenReturn(
                new EscalationConfigurationService.ResolvedEscalationConfig(
                        3, List.of(100L), Collections.emptyList(), Collections.emptyMap()));
        when(escalationService.escalationLevel(any(Service.class))).thenReturn(0);
        when(escalationService.escalationWindowStartedAt(any(Service.class))).thenReturn(assignmentTime);
        when(repository.getServiceWrappers(any(RequestSearchCriteria.class))).thenAnswer(invocation -> {
            RequestSearchCriteria criteria = invocation.getArgument(0);
            if (!criteria.getApplicationStatus().contains("PENDINGATLME")) {
                return Collections.emptyList();
            }
            if (criteria.getOffset() == 0) {
                return List.of(wrapper(first), wrapper(second));
            }
            return criteria.getOffset() == 2 ? List.of(wrapper(third)) : Collections.emptyList();
        });

        scheduler.scanAndEscalate();

        verify(pgrService, times(3)).update(any(ServiceRequest.class));
        ArgumentCaptor<RequestSearchCriteria> criteria = ArgumentCaptor.forClass(RequestSearchCriteria.class);
        verify(repository, times(3)).getServiceWrappers(criteria.capture());
        assertEquals(List.of(0, 2), criteria.getAllValues().stream()
                .filter(value -> value.getApplicationStatus().contains("PENDINGATLME"))
                .map(RequestSearchCriteria::getOffset)
                .toList());
    }

    private Service dueComplaint(String serviceRequestId, long assignmentTime) {
        return Service.builder()
                .id("id-" + serviceRequestId)
                .tenantId("ke.bomet")
                .serviceRequestId(serviceRequestId)
                .serviceCode("ROAD.POTHOLE")
                .applicationStatus("PENDINGATLME")
                .additionalDetail(Map.of(ASSIGNMENT_CHANGED_AT, assignmentTime))
                .build();
    }

    private ServiceWrapper wrapper(Service service) {
        return ServiceWrapper.builder().service(service).build();
    }
}
