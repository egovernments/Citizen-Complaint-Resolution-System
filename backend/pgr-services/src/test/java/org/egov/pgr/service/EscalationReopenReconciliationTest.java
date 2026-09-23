package org.egov.pgr.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.egov.common.contract.request.RequestInfo;
import org.egov.pgr.repository.ServiceRequestRepository;
import org.egov.pgr.util.HRMSUtil;
import org.egov.pgr.web.models.AuditDetails;
import org.egov.pgr.web.models.Service;
import org.egov.pgr.web.models.workflow.ProcessInstance;
import org.egov.pgr.web.models.workflow.ProcessInstanceResponse;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

/**
 * CCRS #2126 — a reopened complaint must start a fresh escalation cycle.
 *
 * <p>{@code prepareUpdate} writes that reset into {@code additionalDetails} on REOPEN, but the
 * reset is not guaranteed to survive: on bomet, complaint PG-PGR-2026-09-23-284821 was reopened
 * with three ESCALATE transitions already in its history and came back carrying pre-reopen
 * metadata ({@code escalationLevel: 1}, no {@code escalationWindowStartedAt}). The old
 * reconciliation counted every historical ESCALATE against the original creation time, so the
 * complaint sat at or above {@code maxDepth} permanently and the scheduler skipped it forever.
 *
 * <p>Workflow history always retains the REOPEN, so it — not metadata — decides where the cycle
 * starts. Each test here fails against the previous {@code reconciledEscalationLevel}.</p>
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
public class EscalationReopenReconciliationTest {

    private static final String COMPLAINT_ID = "PG-PGR-2026-09-23-284821";
    private static final String TENANT_ID = "ke";

    private static final long CREATED_AT = 1_790_150_969_734L;
    private static final long ESCALATE_1 = 1_790_151_219_703L;
    private static final long ESCALATE_2 = 1_790_151_543_000L;
    private static final long ESCALATE_3 = 1_790_151_699_000L;
    private static final long REOPENED_AT = 1_790_153_109_000L;

    @Mock
    private HRMSUtil hrmsUtil;
    @Mock
    private WorkflowService workflowService;
    @Mock
    private ServiceRequestRepository serviceRequestRepository;
    @Mock
    private EscalationConfigurationService configurationService;

    private EscalationService escalationService;
    private final ObjectMapper mapper = new ObjectMapper();

    @BeforeEach
    void setUp() {
        escalationService = new EscalationService(hrmsUtil, workflowService,
                serviceRequestRepository, configurationService, mapper);
        when(workflowService.getprocessInstanceSearchURL(any(), any()))
                .thenReturn(new StringBuilder("http://workflow/_search?tenantId=" + TENANT_ID));
    }

    @Test
    void reopenAfterTheRecordedWindowRestartsTheLadderEvenWhenTheResetWasLost() {
        givenHistory(escalate(ESCALATE_1), escalate(ESCALATE_2), escalate(ESCALATE_3),
                reopen(REOPENED_AT));

        // Exactly what bomet had: pre-reopen metadata, no escalationWindowStartedAt.
        Service complaint = complaint(CREATED_AT, details("escalationLevel", 1,
                "lastEscalatedAt", ESCALATE_1));

        EscalationService.ReconciledEscalation reconciled =
                escalationService.reconcile(complaint, new RequestInfo());

        assertEquals(0, reconciled.level(),
                "rungs consumed before the reopen must not count against the new cycle");
        assertEquals(REOPENED_AT, reconciled.windowStartedAt(),
                "the SLA clock must restart at the reopen, not at complaint creation");
    }

    @Test
    void escalationsAfterAReopenCountTowardTheNewCycle() {
        long afterReopen = REOPENED_AT + 60_000L;
        givenHistory(escalate(ESCALATE_1), escalate(ESCALATE_2), reopen(REOPENED_AT),
                escalate(afterReopen));

        Service complaint = complaint(CREATED_AT, details("escalationLevel", 2,
                "lastEscalatedAt", ESCALATE_2));

        EscalationService.ReconciledEscalation reconciled =
                escalationService.reconcile(complaint, new RequestInfo());

        assertEquals(1, reconciled.level(), "only the post-reopen hop belongs to this cycle");
        assertEquals(REOPENED_AT, reconciled.windowStartedAt());
    }

    @Test
    void aPersistedResetIsHonouredAndHistoryStillGuardsAgainstLaggingMetadata() {
        long afterReopen = REOPENED_AT + 60_000L;
        givenHistory(escalate(ESCALATE_1), reopen(REOPENED_AT), escalate(afterReopen));

        // The REOPEN reset survived this time, so metadata already points at the new cycle —
        // but it lags by one hop, which history must still correct.
        Service complaint = complaint(CREATED_AT, details(
                "escalationLevel", 0,
                "escalationWindowStartedAt", REOPENED_AT));

        EscalationService.ReconciledEscalation reconciled =
                escalationService.reconcile(complaint, new RequestInfo());

        assertEquals(1, reconciled.level(), "workflow history outranks metadata that lags behind");
        assertEquals(REOPENED_AT, reconciled.windowStartedAt());
    }

    @Test
    void withoutAReopenTheOriginalCycleAndItsConsumedRungsAreKept() {
        givenHistory(escalate(ESCALATE_1), escalate(ESCALATE_2), escalate(ESCALATE_3));

        Service complaint = complaint(CREATED_AT, details("escalationLevel", 1,
                "lastEscalatedAt", ESCALATE_1));

        EscalationService.ReconciledEscalation reconciled =
                escalationService.reconcile(complaint, new RequestInfo());

        assertEquals(3, reconciled.level(), "three recorded hops outrank metadata that says one");
        assertEquals(CREATED_AT, reconciled.windowStartedAt());
    }

    private void givenHistory(ProcessInstance... instances) {
        ProcessInstanceResponse response = ProcessInstanceResponse.builder()
                .processInstances(new ArrayList<>(Arrays.asList(instances)))
                .build();
        when(serviceRequestRepository.fetchResult(any(), any()))
                .thenReturn(mapper.convertValue(response, Map.class));
    }

    private static ProcessInstance escalate(long at) {
        return instanceOf("ESCALATE", at);
    }

    private static ProcessInstance reopen(long at) {
        return instanceOf("REOPEN", at);
    }

    private static ProcessInstance instanceOf(String action, long at) {
        return ProcessInstance.builder()
                .action(action)
                .auditDetails(AuditDetails.builder().createdTime(at).build())
                .build();
    }

    private static Service complaint(long createdTime, Map<String, Object> additionalDetails) {
        return Service.builder()
                .serviceRequestId(COMPLAINT_ID)
                .tenantId(TENANT_ID)
                .serviceCode("PWTESTESCALATION")
                .applicationStatus("PENDINGATLME")
                .auditDetails(AuditDetails.builder().createdTime(createdTime).build())
                .additionalDetail(additionalDetails)
                .build();
    }

    private static Map<String, Object> details(Object... keyValuePairs) {
        Map<String, Object> details = new LinkedHashMap<>();
        for (int i = 0; i < keyValuePairs.length; i += 2) {
            details.put((String) keyValuePairs[i], keyValuePairs[i + 1]);
        }
        return details;
    }
}
