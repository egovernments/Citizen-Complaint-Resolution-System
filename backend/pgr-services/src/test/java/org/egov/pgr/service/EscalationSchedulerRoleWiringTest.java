package org.egov.pgr.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.egov.common.contract.request.RequestInfo;
import org.egov.common.utils.MultiStateInstanceUtil;
import org.egov.mdms.model.MdmsCriteriaReq;
import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.producer.Producer;
import org.egov.pgr.repository.PGRRepository;
import org.egov.pgr.repository.ServiceRequestRepository;
import org.egov.pgr.util.EscalationSkipReason;
import org.egov.pgr.util.MDMSUtils;
import org.egov.pgr.util.PGRConstants;
import org.egov.pgr.web.models.AuditDetails;
import org.egov.pgr.web.models.EscalationTriggerResponse;
import org.egov.pgr.web.models.EscalationTriggerResponse.EscalationOutcome;
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

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Wiring-level coverage for the role-escalation branch at the NO_ASSIGNEES
 * insertion point of {@link EscalationScheduler#scanAndEscalateOnce}:
 *
 * <ol>
 *   <li>the backward-compat pin — roleEscalation absent/disabled means the
 *       unassigned complaint records NO_ASSIGNEES byte-identical to today and
 *       NONE of the role machinery (resolver, RoleSupervisors MDMS fetch,
 *       HRMS) is ever touched;</li>
 *   <li>ROLE_NOT_MAPPED when the watched state has no acting-role entry;</li>
 *   <li>resolver-skip provenance flowing into the structured outcome;</li>
 *   <li>the maxPerScan blast-radius cap (defer as NO_ASSIGNEES, no new enum);</li>
 *   <li>dry-run and real role paths with provenance fields set.</li>
 * </ol>
 *
 * <p>Same mock harness as {@link EscalationSchedulerScanWiringTest}; the role
 * resolution itself is covered by {@link EscalationServiceRoleResolverTest},
 * so {@code resolveRoleTarget} is stubbed here.</p>
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
public class EscalationSchedulerRoleWiringTest {

    @Mock private PGRConfiguration config;
    @Mock private PGRRepository repository;
    @Mock private EscalationService escalationService;
    @Mock private ServiceRequestRepository serviceRequestRepository;
    @Mock private MDMSUtils mdmsUtils;
    @Mock private MultiStateInstanceUtil multiStateInstanceUtil;
    @Mock private Producer producer;

    private EscalationScheduler scheduler;

    /** Every MDMS master name the scheduler fetched during the scan. */
    private final List<String> fetchedMasters = new ArrayList<>();

    @BeforeEach
    void setup() {
        scheduler = new EscalationScheduler(
                config, repository, escalationService, serviceRequestRepository,
                mdmsUtils, new ObjectMapper(), multiStateInstanceUtil, producer);
        when(config.getEscalationMaxDepth()).thenReturn(3);
        when(config.getEscalationDefaultSlaMs()).thenReturn(60_000L); // 1-minute SLA → breached below
        when(config.getEscalationBatchSize()).thenReturn(100);
        when(config.getEscalationIntervalMs()).thenReturn(300_000L);
        when(mdmsUtils.getMdmsSearchUrl()).thenReturn(new StringBuilder("http://mdms/_search"));
        when(multiStateInstanceUtil.getStateLevelTenant(anyString())).thenReturn("ke");
        // Unassigned everywhere in this class.
        when(escalationService.getCurrentAssignees(anyString(), anyString(), any()))
                .thenReturn(Collections.emptyList());
    }

    /**
     * THE backward-compat pin: roleEscalation ABSENT ⇒ an unassigned breached
     * complaint records NO_ASSIGNEES with detail "workflow returned 0
     * assignees" exactly as today, with no provenance fields, and zero
     * role-machinery interactions (no resolver call ⇒ no HRMS, no
     * CRS.RoleSupervisors MDMS fetch).
     */
    @Test
    void roleEscalationAbsent_noAssigneesSkip_byteIdenticalToToday() {
        stubMdms(new HashMap<>(), null); // policy seeded, no roleEscalation key
        surfaceForPendingAtLme(breachedUnassignedComplaint("PGR-PIN-1"));

        EscalationTriggerResponse response = scheduler.scanAndEscalateOnce(
                "ke", null, RequestInfo.builder().build(), false);

        assertCompatNoAssigneesPin(response, "PGR-PIN-1");
    }

    /** Same pin with roleEscalation PRESENT but enabled=false. */
    @Test
    void roleEscalationDisabled_noAssigneesSkip_byteIdenticalToToday() {
        Map<String, Object> roleEscalation = new HashMap<>();
        roleEscalation.put("enabled", false);
        roleEscalation.put("actingRoleByState", Collections.singletonMap(PGRConstants.PENDINGATLME, "GRO"));
        Map<String, Object> policy = new HashMap<>();
        policy.put("roleEscalation", roleEscalation);
        stubMdms(policy, null);
        surfaceForPendingAtLme(breachedUnassignedComplaint("PGR-PIN-2"));

        EscalationTriggerResponse response = scheduler.scanAndEscalateOnce(
                "ke", null, RequestInfo.builder().build(), false);

        assertCompatNoAssigneesPin(response, "PGR-PIN-2");
    }

    /** Enabled, but the complaint's state has no actingRoleByState entry ⇒ ROLE_NOT_MAPPED (slaSource still recorded). */
    @Test
    void enabledButStateUnmapped_recordsRoleNotMapped() {
        stubMdms(enabledPolicy(Collections.singletonMap(PGRConstants.PENDINGFORASSIGNMENT, "GRO"), null), null);
        surfaceForPendingAtLme(breachedUnassignedComplaint("PGR-RNM-1"));

        EscalationTriggerResponse response = scheduler.scanAndEscalateOnce(
                "ke", null, RequestInfo.builder().build(), false);

        assertEquals(0, response.getEscalated());
        assertEquals(Integer.valueOf(1),
                response.getSkipBreakdown().get(EscalationSkipReason.ROLE_NOT_MAPPED.name()));
        EscalationOutcome outcome = outcomeFor(response, "PGR-RNM-1");
        assertEquals("SKIPPED", outcome.getAction());
        assertEquals(EscalationSkipReason.ROLE_NOT_MAPPED.name(), outcome.getReason());
        assertTrue(outcome.getDetail().contains(PGRConstants.PENDINGATLME));
        assertEquals(PGRConstants.SLA_SOURCE_V0, outcome.getSlaSource());
        verify(escalationService, never())
                .resolveRoleTarget(any(), any(), any(), any(), any(), any(), any());
    }

    /** A resolver skip carries its provenance (strategy/candidates/departmentFiltered) into the outcome. */
    @Test
    void resolverSkip_provenanceFlowsIntoOutcome() {
        stubMdms(enabledPolicy(Collections.singletonMap(PGRConstants.PENDINGATLME, "GRO"), null), null);
        surfaceForPendingAtLme(breachedUnassignedComplaint("PGR-AMB-1"));
        when(escalationService.resolveRoleTarget(eq("GRO"), any(), any(), any(), any(), any(), any()))
                .thenReturn(EscalationService.RoleResolution.builder()
                        .strategy(EscalationService.STRATEGY_R2_LADDER)
                        .actingRole("GRO")
                        .department("DEPT_18")
                        .candidateCount(2)
                        .departmentFiltered(true)
                        .skipReason(EscalationSkipReason.ROLE_SUPERVISOR_AMBIGUOUS)
                        .detail("2 holders of ladder role PGR_SUPERVISOR")
                        .build());

        EscalationTriggerResponse response = scheduler.scanAndEscalateOnce(
                "ke", null, RequestInfo.builder().build(), false);

        assertEquals(Integer.valueOf(1),
                response.getSkipBreakdown().get(EscalationSkipReason.ROLE_SUPERVISOR_AMBIGUOUS.name()));
        EscalationOutcome outcome = outcomeFor(response, "PGR-AMB-1");
        assertEquals(EscalationSkipReason.ROLE_SUPERVISOR_AMBIGUOUS.name(), outcome.getReason());
        assertEquals(EscalationService.STRATEGY_R2_LADDER, outcome.getResolutionStrategy());
        assertEquals("GRO", outcome.getActingRole());
        assertEquals(Integer.valueOf(2), outcome.getCandidateCount());
        assertEquals(Boolean.TRUE, outcome.getDepartmentFiltered());
        assertTrue(outcome.getDetail().contains("strategy=R2_LADDER"));
        assertTrue(outcome.getDetail().contains("candidates=2"));
        assertTrue(outcome.getDetail().contains("departmentFiltered=true"));
        verify(escalationService, never())
                .escalateToRoleTarget(any(), any(), any(), anyInt(), anyLong(), anyLong(), any());
    }

    /** maxPerScan=1 + two resolvable complaints ⇒ one escalates, the second defers as NO_ASSIGNEES. */
    @Test
    void maxPerScan_defersOverflowAsNoAssignees() {
        stubMdms(enabledPolicy(Collections.singletonMap(PGRConstants.PENDINGATLME, "GRO"), 1), null);
        surfaceForPendingAtLme(
                breachedUnassignedComplaint("PGR-CAP-1"),
                breachedUnassignedComplaint("PGR-CAP-2"));
        when(escalationService.resolveRoleTarget(eq("GRO"), any(), any(), any(), any(), any(), any()))
                .thenReturn(successResolution());
        when(escalationService.escalateToRoleTarget(any(), eq("target-uuid"), any(), anyInt(), anyLong(), anyLong(), any()))
                .thenReturn(EscalationService.EscalationResult.success("target-uuid", 1));

        EscalationTriggerResponse response = scheduler.scanAndEscalateOnce(
                "ke", null, RequestInfo.builder().build(), false);

        assertEquals(1, response.getEscalated());
        assertEquals(1, response.getSkipped());
        assertEquals(Integer.valueOf(1),
                response.getSkipBreakdown().get(EscalationSkipReason.NO_ASSIGNEES.name()));
        assertTrue(response.getDetails().stream().anyMatch(d ->
                        "SKIPPED".equals(d.getAction())
                                && EscalationSkipReason.NO_ASSIGNEES.name().equals(d.getReason())
                                && "role escalation deferred — maxPerScan reached".equals(d.getDetail())),
                "the overflow complaint must defer with the documented detail, not a new enum value");
        verify(escalationService, times(1))
                .escalateToRoleTarget(any(), any(), any(), anyInt(), anyLong(), anyLong(), any());
    }

    /** Dry-run role path: WOULD_ESCALATE with provenance, zero mutations. */
    @Test
    void dryRun_rolePath_wouldEscalateWithProvenance_zeroMutations() {
        stubMdms(enabledPolicy(Collections.singletonMap(PGRConstants.PENDINGATLME, "GRO"), null), null);
        surfaceForPendingAtLme(breachedUnassignedComplaint("PGR-DRYR-1"));
        when(escalationService.resolveRoleTarget(eq("GRO"), any(), any(), any(), any(), any(), any()))
                .thenReturn(successResolution());
        when(escalationService.previewRoleEscalation(any(), eq("target-uuid"), any(), anyInt(), anyLong(), anyLong(), any()))
                .thenReturn(EscalationService.EscalationResult.builder()
                        .success(true)
                        .reason(EscalationSkipReason.SUCCESS)
                        .detail("would escalate to target-uuid (level 0→1, acting role GRO via R1_PIN), elapsed=7200000ms, sla=60000ms")
                        .newAssigneeUuid("target-uuid")
                        .newLevel(1)
                        .build());

        EscalationTriggerResponse response = scheduler.scanAndEscalateOnce(
                "ke", null, RequestInfo.builder().build(), true);

        assertEquals(0, response.getEscalated());
        assertEquals(1, response.getWouldEscalate());
        EscalationOutcome outcome = outcomeFor(response, "PGR-DRYR-1");
        assertEquals("WOULD_ESCALATE", outcome.getAction());
        assertEquals(EscalationService.STRATEGY_R1_PIN, outcome.getResolutionStrategy());
        assertEquals("GRO", outcome.getActingRole());
        assertEquals(Integer.valueOf(1), outcome.getCandidateCount());
        assertEquals(Boolean.TRUE, outcome.getDepartmentFiltered());

        verify(escalationService, never())
                .escalateToRoleTarget(any(), any(), any(), anyInt(), anyLong(), anyLong(), any());
        verify(producer, never()).push(anyString(), anyString(), any());
    }

    /** Real role path: ESCALATED with provenance, target = the resolved uuid. */
    @Test
    void realRolePath_escalatesToResolvedTarget_withProvenance() {
        stubMdms(enabledPolicy(Collections.singletonMap(PGRConstants.PENDINGATLME, "GRO"), null), null);
        surfaceForPendingAtLme(breachedUnassignedComplaint("PGR-REAL-1"));
        EscalationService.RoleResolution resolution = successResolution();
        when(escalationService.resolveRoleTarget(eq("GRO"), any(), any(), any(), any(), any(), any()))
                .thenReturn(resolution);
        when(escalationService.escalateToRoleTarget(any(), eq("target-uuid"), any(), anyInt(), anyLong(), anyLong(), any()))
                .thenReturn(EscalationService.EscalationResult.success("target-uuid", 1));

        EscalationTriggerResponse response = scheduler.scanAndEscalateOnce(
                "ke", null, RequestInfo.builder().build(), false);

        assertEquals(1, response.getEscalated());
        EscalationOutcome outcome = outcomeFor(response, "PGR-REAL-1");
        assertEquals("ESCALATED", outcome.getAction());
        assertEquals(EscalationSkipReason.SUCCESS.name(), outcome.getReason());
        assertEquals("fromLevel=0 toLevel=1", outcome.getDetail());
        assertEquals(EscalationService.STRATEGY_R1_PIN, outcome.getResolutionStrategy());
        assertEquals("GRO", outcome.getActingRole());
        verify(escalationService).escalateToRoleTarget(
                any(), eq("target-uuid"), any(), anyInt(), anyLong(), anyLong(), eq(resolution));
        verify(escalationService, never())
                .escalateComplaintWithReason(any(), any(), any(), anyInt(), anyLong(), anyLong());
    }

    // ---------------------------------------------------------------------
    // helpers
    // ---------------------------------------------------------------------

    /** Shared assertions for the two backward-compat pins. */
    private void assertCompatNoAssigneesPin(EscalationTriggerResponse response, String srid) {
        assertEquals(0, response.getEscalated());
        assertEquals(1, response.getSkipped());
        assertEquals(Integer.valueOf(1),
                response.getSkipBreakdown().get(EscalationSkipReason.NO_ASSIGNEES.name()));

        EscalationOutcome outcome = outcomeFor(response, srid);
        assertEquals("SKIPPED", outcome.getAction());
        assertEquals(EscalationSkipReason.NO_ASSIGNEES.name(), outcome.getReason());
        assertEquals("workflow returned 0 assignees", outcome.getDetail());
        assertNull(outcome.getResolutionStrategy());
        assertNull(outcome.getActingRole());
        assertNull(outcome.getCandidateCount());
        assertNull(outcome.getDepartmentFiltered());

        // Zero role-machinery interactions: no resolution (⇒ no HRMS lookups),
        // no role escalate/preview, no CRS.RoleSupervisors MDMS fetch.
        verify(escalationService, never())
                .resolveRoleTarget(any(), any(), any(), any(), any(), any(), any());
        verify(escalationService, never())
                .escalateToRoleTarget(any(), any(), any(), anyInt(), anyLong(), anyLong(), any());
        verify(escalationService, never())
                .previewRoleEscalation(any(), any(), any(), anyInt(), anyLong(), anyLong(), any());
        assertFalse(fetchedMasters.contains("RoleSupervisors"),
                "disabled tenants must not pay the CRS.RoleSupervisors fetch");

        // Wire-format pin: the app ObjectMapper uses default ALWAYS inclusion,
        // so without field-level NON_NULL the four role-provenance fields would
        // serialize as null keys on every disabled-path detail row. A
        // disabled-path response must keep today's EXACT key set — slaSource
        // stays even when null (ALWAYS inclusion is part of the pinned format),
        // and no role keys appear.
        JsonNode detailRow = new ObjectMapper().valueToTree(response).get("details").get(0);
        Set<String> keys = new LinkedHashSet<>();
        detailRow.fieldNames().forEachRemaining(keys::add);
        assertEquals(
                new HashSet<>(Arrays.asList("serviceRequestId", "action", "reason", "detail", "slaSource")),
                new HashSet<>(keys),
                "disabled-path detail rows must serialize the exact pre-role-escalation key set");
    }

    private static EscalationOutcome outcomeFor(EscalationTriggerResponse response, String srid) {
        return response.getDetails().stream()
                .filter(d -> srid.equals(d.getServiceRequestId()))
                .findFirst()
                .orElseThrow(() -> new AssertionError("no outcome for " + srid));
    }

    private static EscalationService.RoleResolution successResolution() {
        return EscalationService.RoleResolution.builder()
                .targetUuid("target-uuid")
                .strategy(EscalationService.STRATEGY_R1_PIN)
                .actingRole("GRO")
                .candidateCount(1)
                .departmentFiltered(true)
                .build();
    }

    private static Map<String, Object> enabledPolicy(Map<String, String> actingRoleByState, Integer maxPerScan) {
        Map<String, Object> roleEscalation = new HashMap<>();
        roleEscalation.put("enabled", true);
        roleEscalation.put("actingRoleByState", actingRoleByState);
        if (maxPerScan != null) {
            roleEscalation.put("maxPerScan", maxPerScan);
        }
        Map<String, Object> policy = new HashMap<>();
        policy.put("roleEscalation", roleEscalation);
        return policy;
    }

    /**
     * Answers the scheduler's MDMS fetches (recording every master name): the
     * CRS.EscalationPolicy master returns the given singleton row, the
     * CRS.RoleSupervisors master returns the given rows (when non-null), every
     * other master returns null ("not seeded").
     */
    private void stubMdms(Map<String, Object> policyRow, List<Map<String, Object>> roleSupervisorRows) {
        when(serviceRequestRepository.fetchResult(any(), any())).thenAnswer(inv -> {
            Object body = inv.getArgument(1);
            if (body instanceof MdmsCriteriaReq) {
                String master = ((MdmsCriteriaReq) body).getMdmsCriteria().getModuleDetails().get(0)
                        .getMasterDetails().get(0).getName();
                fetchedMasters.add(master);
                if ("EscalationPolicy".equals(master) && policyRow != null) {
                    return mdmsRoot("EscalationPolicy", Collections.singletonList(policyRow));
                }
                if ("RoleSupervisors".equals(master) && roleSupervisorRows != null) {
                    return mdmsRoot("RoleSupervisors", roleSupervisorRows);
                }
            }
            return null;
        });
    }

    private static Map<String, Object> mdmsRoot(String master, List<Map<String, Object>> rows) {
        Map<String, Object> crs = new HashMap<>();
        crs.put(master, rows);
        Map<String, Object> mdmsRes = new HashMap<>();
        mdmsRes.put("CRS", crs);
        Map<String, Object> root = new HashMap<>();
        root.put("MdmsRes", mdmsRes);
        return root;
    }

    /** Surfaces the complaints only for PENDINGATLME so each is scanned exactly once. */
    private void surfaceForPendingAtLme(Service... complaints) {
        List<ServiceWrapper> wrappers = new ArrayList<>();
        for (Service complaint : complaints) {
            wrappers.add(ServiceWrapper.builder().service(complaint).build());
        }
        when(repository.getServiceWrappers(any())).thenAnswer(inv -> {
            RequestSearchCriteria criteria = inv.getArgument(0);
            return criteria.getApplicationStatus() != null
                    && criteria.getApplicationStatus().contains(PGRConstants.PENDINGATLME)
                    ? wrappers
                    : Collections.emptyList();
        });
    }

    private static Service breachedUnassignedComplaint(String srid) {
        Service s = new Service();
        s.setServiceRequestId(srid);
        s.setTenantId("ke.bomet");
        s.setServiceCode("svc");
        s.setApplicationStatus(PGRConstants.PENDINGATLME);
        long twoHoursAgo = System.currentTimeMillis() - 7_200_000L;
        s.setAuditDetails(AuditDetails.builder()
                .createdTime(twoHoursAgo)
                .lastModifiedTime(twoHoursAgo)
                .build());
        return s;
    }
}
