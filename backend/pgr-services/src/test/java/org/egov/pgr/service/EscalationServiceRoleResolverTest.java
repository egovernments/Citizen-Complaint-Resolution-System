package org.egov.pgr.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.egov.common.contract.request.RequestInfo;
import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.producer.Producer;
import org.egov.pgr.repository.ServiceRequestRepository;
import org.egov.pgr.util.EscalationSkipReason;
import org.egov.pgr.util.HRMSUtil;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Unit coverage for {@link EscalationService#resolveRoleTarget} — the
 * R1 (pin) → R2 (ladder) → R3 (reportingTo consensus) cascade that picks
 * exactly one person (or a structured skip) for an unattended complaint's
 * acting role. HRMS is mocked at the {@link HRMSUtil} boundary.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
public class EscalationServiceRoleResolverTest {

    @Mock private HRMSUtil hrmsUtil;
    @Mock private WorkflowService workflowService;
    @Mock private PGRConfiguration config;
    @Mock private Producer producer;
    @Mock private ServiceRequestRepository serviceRequestRepository;
    @Mock private ObjectMapper mapper;

    @InjectMocks
    private EscalationService escalationService;

    private RequestInfo requestInfo;
    private Map<String, EscalationService.RoleResolution> cache;

    @BeforeEach
    void setup() {
        requestInfo = RequestInfo.builder().build();
        cache = new HashMap<>();
    }

    /** R1: active (role, "ALL") pin wins outright — no role search at all. */
    @Test
    void r1Pin_activeEmployee_resolvesDirectly() {
        List<Map<String, Object>> pins = Collections.singletonList(pinRow("GRO", "ALL", "pin-uuid"));
        when(hrmsUtil.isActiveEmployee(eq("pin-uuid"), eq("ke.bomet"), any())).thenReturn(true);

        EscalationService.RoleResolution res = escalationService.resolveRoleTarget(
                "GRO", null, pins, ladderPolicy("GRO", "PGR_SUPERVISOR"), requestInfo, "ke.bomet", cache);

        assertNull(res.getSkipReason());
        assertEquals("pin-uuid", res.getTargetUuid());
        assertEquals(EscalationService.STRATEGY_R1_PIN, res.getStrategy());
        assertEquals("GRO", res.getActingRole());
        assertEquals(Integer.valueOf(1), res.getCandidateCount());
        verify(hrmsUtil, never()).searchEmployeesByRole(anyString(), any(), anyString(), any());
    }

    /** R1: the exact (role, department) row beats the (role, "ALL") default. */
    @Test
    void r1Pin_departmentRowBeatsTenantWideRow() {
        List<Map<String, Object>> pins = Arrays.asList(
                pinRow("GRO", "ALL", "all-uuid"),
                pinRow("GRO", "DEPT_18", "dept-uuid"));
        when(hrmsUtil.isActiveEmployee(anyString(), anyString(), any())).thenReturn(true);

        EscalationService.RoleResolution res = escalationService.resolveRoleTarget(
                "GRO", "DEPT_18", pins, ladderPolicy("GRO", "PGR_SUPERVISOR"), requestInfo, "ke.bomet", cache);

        assertEquals("dept-uuid", res.getTargetUuid());
        assertEquals(EscalationService.STRATEGY_R1_PIN, res.getStrategy());
        assertEquals(Boolean.TRUE, res.getDepartmentFiltered());
    }

    /** R1 stale pin (not an active HRMS employee) falls through to the ladder, noted in detail. */
    @Test
    void r1StalePin_fallsThroughToLadder() {
        List<Map<String, Object>> pins = Collections.singletonList(pinRow("GRO", "ALL", "stale-uuid"));
        when(hrmsUtil.isActiveEmployee(eq("stale-uuid"), anyString(), any())).thenReturn(false);
        when(hrmsUtil.searchEmployeesByRole(eq("PGR_SUPERVISOR"), isNull(), eq("ke.bomet"), any()))
                .thenReturn(Collections.singletonList(employee("sup-uuid", null)));

        EscalationService.RoleResolution res = escalationService.resolveRoleTarget(
                "GRO", null, pins, ladderPolicy("GRO", "PGR_SUPERVISOR"), requestInfo, "ke.bomet", cache);

        assertNull(res.getSkipReason());
        assertEquals("sup-uuid", res.getTargetUuid());
        assertEquals(EscalationService.STRATEGY_R2_LADDER, res.getStrategy());
        assertTrue(res.getDetail().contains("stale pin stale-uuid"),
                "the fallthrough must be reconstructable from the detail");
    }

    /** R2: exactly one ladder-role holder in the complaint's department. */
    @Test
    void r2Ladder_exactlyOne_departmentFiltered() {
        when(hrmsUtil.searchEmployeesByRole(eq("PGR_SUPERVISOR"), eq("DEPT_18"), eq("ke.bomet"), any()))
                .thenReturn(Collections.singletonList(employee("sup-uuid", null)));

        EscalationService.RoleResolution res = escalationService.resolveRoleTarget(
                "GRO", "DEPT_18", Collections.emptyList(), ladderPolicy("GRO", "PGR_SUPERVISOR"),
                requestInfo, "ke.bomet", cache);

        assertNull(res.getSkipReason());
        assertEquals("sup-uuid", res.getTargetUuid());
        assertEquals(EscalationService.STRATEGY_R2_LADDER, res.getStrategy());
        assertEquals(Integer.valueOf(1), res.getCandidateCount());
        assertEquals(Boolean.TRUE, res.getDepartmentFiltered());
    }

    /** R2: two holders ⇒ skip-don't-guess with candidateCount=2. */
    @Test
    void r2Ladder_twoCandidates_ambiguous() {
        when(hrmsUtil.searchEmployeesByRole(eq("PGR_SUPERVISOR"), eq("DEPT_18"), eq("ke.bomet"), any()))
                .thenReturn(Arrays.asList(employee("sup-1", null), employee("sup-2", null)));

        EscalationService.RoleResolution res = escalationService.resolveRoleTarget(
                "GRO", "DEPT_18", Collections.emptyList(), ladderPolicy("GRO", "PGR_SUPERVISOR"),
                requestInfo, "ke.bomet", cache);

        assertEquals(EscalationSkipReason.ROLE_SUPERVISOR_AMBIGUOUS, res.getSkipReason());
        assertNull(res.getTargetUuid());
        assertEquals(Integer.valueOf(2), res.getCandidateCount());
        assertEquals(Boolean.TRUE, res.getDepartmentFiltered());
    }

    /** R2: zero in-department ⇒ tenant-wide retry; a single unfiltered hit wins with departmentFiltered=false. */
    @Test
    void r2Ladder_zeroFiltered_unfilteredRetryHit() {
        when(hrmsUtil.searchEmployeesByRole(eq("PGR_SUPERVISOR"), eq("DEPT_18"), eq("ke.bomet"), any()))
                .thenReturn(Collections.emptyList());
        when(hrmsUtil.searchEmployeesByRole(eq("PGR_SUPERVISOR"), isNull(), eq("ke.bomet"), any()))
                .thenReturn(Collections.singletonList(employee("sup-uuid", null)));

        EscalationService.RoleResolution res = escalationService.resolveRoleTarget(
                "GRO", "DEPT_18", Collections.emptyList(), ladderPolicy("GRO", "PGR_SUPERVISOR"),
                requestInfo, "ke.bomet", cache);

        assertNull(res.getSkipReason());
        assertEquals("sup-uuid", res.getTargetUuid());
        assertEquals(Boolean.FALSE, res.getDepartmentFiltered());
    }

    /** R2: zero filtered AND zero unfiltered ⇒ NO_ROLE_SUPERVISOR. */
    @Test
    void r2Ladder_zeroThenZero_noRoleSupervisor() {
        when(hrmsUtil.searchEmployeesByRole(eq("PGR_SUPERVISOR"), any(), eq("ke.bomet"), any()))
                .thenReturn(Collections.emptyList());

        EscalationService.RoleResolution res = escalationService.resolveRoleTarget(
                "GRO", "DEPT_18", Collections.emptyList(), ladderPolicy("GRO", "PGR_SUPERVISOR"),
                requestInfo, "ke.bomet", cache);

        assertEquals(EscalationSkipReason.NO_ROLE_SUPERVISOR, res.getSkipReason());
        assertEquals(Integer.valueOf(0), res.getCandidateCount());
    }

    /** A configured ladder is authoritative: its exhaustion must NOT fall through to R3. */
    @Test
    void r2Ladder_exhaustion_neverFallsThroughToR3() {
        when(hrmsUtil.searchEmployeesByRole(eq("PGR_SUPERVISOR"), any(), eq("ke.bomet"), any()))
                .thenReturn(Collections.emptyList());

        EscalationService.RoleResolution res = escalationService.resolveRoleTarget(
                "GRO", "DEPT_18", Collections.emptyList(), ladderPolicy("GRO", "PGR_SUPERVISOR"),
                requestInfo, "ke.bomet", cache);

        assertEquals(EscalationSkipReason.NO_ROLE_SUPERVISOR, res.getSkipReason());
        assertEquals(EscalationService.STRATEGY_R2_LADDER, res.getStrategy());
        // R3 would search the acting role itself — must never happen.
        verify(hrmsUtil, never()).searchEmployeesByRole(eq("GRO"), any(), anyString(), any());
    }

    /** R3 (no ladder entry): all acting-role holders report to the same person ⇒ consensus target. */
    @Test
    void r3Reporting_consensusHit() {
        when(hrmsUtil.searchEmployeesByRole(eq("GRO"), isNull(), eq("ke.bomet"), any()))
                .thenReturn(Arrays.asList(employee("lme-1", "boss-uuid"), employee("lme-2", "boss-uuid")));

        EscalationService.RoleResolution res = escalationService.resolveRoleTarget(
                "GRO", null, Collections.emptyList(), ladderPolicy("OTHER_ROLE", "PGR_SUPERVISOR"),
                requestInfo, "ke.bomet", cache);

        assertNull(res.getSkipReason());
        assertEquals("boss-uuid", res.getTargetUuid());
        assertEquals(EscalationService.STRATEGY_R3_REPORTING, res.getStrategy());
        assertEquals(Integer.valueOf(1), res.getCandidateCount());
    }

    /** R3: holders split across two reportingTo uuids ⇒ ambiguous. */
    @Test
    void r3Reporting_split_ambiguous() {
        when(hrmsUtil.searchEmployeesByRole(eq("GRO"), isNull(), eq("ke.bomet"), any()))
                .thenReturn(Arrays.asList(employee("lme-1", "boss-1"), employee("lme-2", "boss-2")));

        EscalationService.RoleResolution res = escalationService.resolveRoleTarget(
                "GRO", null, Collections.emptyList(), ladderPolicy("OTHER_ROLE", "PGR_SUPERVISOR"),
                requestInfo, "ke.bomet", cache);

        assertEquals(EscalationSkipReason.ROLE_SUPERVISOR_AMBIGUOUS, res.getSkipReason());
        assertEquals(Integer.valueOf(2), res.getCandidateCount());
        assertEquals(EscalationService.STRATEGY_R3_REPORTING, res.getStrategy());
    }

    /** R3: holders exist but none has a reportingTo ⇒ NO_ROLE_SUPERVISOR. */
    @Test
    void r3Reporting_noReportingTo_noRoleSupervisor() {
        when(hrmsUtil.searchEmployeesByRole(eq("GRO"), isNull(), eq("ke.bomet"), any()))
                .thenReturn(Collections.singletonList(employee("lme-1", null)));

        EscalationService.RoleResolution res = escalationService.resolveRoleTarget(
                "GRO", null, Collections.emptyList(), ladderPolicy("OTHER_ROLE", "PGR_SUPERVISOR"),
                requestInfo, "ke.bomet", cache);

        assertEquals(EscalationSkipReason.NO_ROLE_SUPERVISOR, res.getSkipReason());
        assertEquals(Integer.valueOf(0), res.getCandidateCount());
    }

    /** Per-scan memoization: the second resolution for the same (actingRole, department) key hits the cache. */
    @Test
    void memoization_secondCallSameKey_hitsHrmsOnce() {
        when(hrmsUtil.searchEmployeesByRole(eq("PGR_SUPERVISOR"), eq("DEPT_18"), eq("ke.bomet"), any()))
                .thenReturn(Collections.singletonList(employee("sup-uuid", null)));
        Map<String, Object> policy = ladderPolicy("GRO", "PGR_SUPERVISOR");

        EscalationService.RoleResolution first = escalationService.resolveRoleTarget(
                "GRO", "DEPT_18", Collections.emptyList(), policy, requestInfo, "ke.bomet", cache);
        EscalationService.RoleResolution second = escalationService.resolveRoleTarget(
                "GRO", "DEPT_18", Collections.emptyList(), policy, requestInfo, "ke.bomet", cache);

        assertSame(first, second, "second complaint with the same key must reuse the cached resolution");
        verify(hrmsUtil, times(1)).searchEmployeesByRole(anyString(), any(), anyString(), any());
    }

    // ---------------------------------------------------------------------
    // helpers
    // ---------------------------------------------------------------------

    private static Map<String, Object> ladderPolicy(String actingRole, String ladderRole) {
        Map<String, Object> ladder = new HashMap<>();
        ladder.put(actingRole, ladderRole);
        Map<String, Object> roleEscalation = new HashMap<>();
        roleEscalation.put("enabled", true);
        roleEscalation.put("supervisorRoleByRole", ladder);
        Map<String, Object> policy = new HashMap<>();
        policy.put("roleEscalation", roleEscalation);
        return policy;
    }

    private static Map<String, Object> pinRow(String role, String department, String assigneeUuid) {
        Map<String, Object> row = new HashMap<>();
        row.put("role", role);
        row.put("department", department);
        row.put("assigneeUuid", assigneeUuid);
        row.put("isActive", true);
        return row;
    }

    private static Map<String, String> employee(String uuid, String reportingTo) {
        Map<String, String> employee = new HashMap<>();
        employee.put("uuid", uuid);
        if (reportingTo != null) {
            employee.put("reportingTo", reportingTo);
        }
        return employee;
    }
}
