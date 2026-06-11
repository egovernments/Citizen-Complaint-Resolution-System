package org.egov.pgr.util;

import org.egov.common.contract.request.RequestInfo;
import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.repository.ServiceRequestRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

/**
 * Unit coverage for the two HRMS trust signals the role-escalation resolver
 * depends on:
 * <ul>
 *   <li>{@link HRMSUtil#searchEmployeesByRole} — truncation detected on the
 *       RAW page (BEFORE department filtering) and transport failures
 *       distinguished from "no holders";</li>
 *   <li>{@link HRMSUtil#isActiveEmployee} — tri-state, so a transient HRMS
 *       blip ({@code null}) is never conflated with a stale pin
 *       ({@code FALSE}).</li>
 * </ul>
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
public class HRMSUtilRoleSearchTest {

    @Mock private ServiceRequestRepository serviceRequestRepository;
    @Mock private PGRConfiguration config;

    @InjectMocks
    private HRMSUtil hrmsUtil;

    private RequestInfo requestInfo;

    @BeforeEach
    void setup() {
        when(config.getHrmsHost()).thenReturn("http://hrms");
        when(config.getHrmsEndPoint()).thenReturn("/employees/_search");
        requestInfo = RequestInfo.builder().build();
    }

    /**
     * THE silent-truncation guard: 100 raw rows (a full page) that filter
     * down to exactly one in-department holder must be flagged truncated —
     * the resolver maps that to ROLE_SUPERVISOR_AMBIGUOUS instead of a false
     * exactly-one verdict.
     */
    @Test
    void fullRawPage_flagsTruncation_beforeDepartmentFiltering() {
        when(serviceRequestRepository.fetchResult(any(), any()))
                .thenReturn(employeesResponse(HRMSUtil.ROLE_SEARCH_LIMIT));

        HRMSUtil.RoleSearchResult result =
                hrmsUtil.searchEmployeesByRole("PGR_SUPERVISOR", "DEPT_0", "ke.bomet", requestInfo);

        assertTrue(result.isTruncated(), "a raw page at the limit may be missing holders");
        assertFalse(result.isFailed());
        assertEquals(1, result.getEmployees().size(),
                "filtering still runs — exactly why the check must precede it");
    }

    @Test
    void partialRawPage_notTruncated() {
        when(serviceRequestRepository.fetchResult(any(), any()))
                .thenReturn(employeesResponse(HRMSUtil.ROLE_SEARCH_LIMIT - 1));

        HRMSUtil.RoleSearchResult result =
                hrmsUtil.searchEmployeesByRole("PGR_SUPERVISOR", null, "ke.bomet", requestInfo);

        assertFalse(result.isTruncated());
        assertFalse(result.isFailed());
        assertEquals(HRMSUtil.ROLE_SEARCH_LIMIT - 1, result.getEmployees().size());
    }

    /** Transport failure ⇒ failed, never an empty "no holders" list. */
    @Test
    void transportFailure_flagsFailed() {
        when(serviceRequestRepository.fetchResult(any(), any()))
                .thenThrow(new RuntimeException("connection refused"));

        HRMSUtil.RoleSearchResult result =
                hrmsUtil.searchEmployeesByRole("PGR_SUPERVISOR", null, "ke.bomet", requestInfo);

        assertTrue(result.isFailed());
        assertTrue(result.getEmployees().isEmpty());
    }

    /** fetchResult swallows transport errors into null — that is a failure too, not "no holders". */
    @Test
    void nullResponse_flagsFailed() {
        when(serviceRequestRepository.fetchResult(any(), any())).thenReturn(null);

        HRMSUtil.RoleSearchResult result =
                hrmsUtil.searchEmployeesByRole("PGR_SUPERVISOR", null, "ke.bomet", requestInfo);

        assertTrue(result.isFailed());
    }

    /** A genuinely empty Employees array IS "no holders" — not failed, not truncated. */
    @Test
    void emptyEmployees_isNoHolders_notFailure() {
        when(serviceRequestRepository.fetchResult(any(), any())).thenReturn(employeesResponse(0));

        HRMSUtil.RoleSearchResult result =
                hrmsUtil.searchEmployeesByRole("PGR_SUPERVISOR", null, "ke.bomet", requestInfo);

        assertFalse(result.isFailed());
        assertFalse(result.isTruncated());
        assertTrue(result.getEmployees().isEmpty());
    }

    /** Tri-state pin check: exactly-one active ⇒ TRUE. */
    @Test
    void isActiveEmployee_exactlyOne_true() {
        when(serviceRequestRepository.fetchResult(any(), any())).thenReturn(employeesResponse(1));

        assertEquals(Boolean.TRUE, hrmsUtil.isActiveEmployee("uuid-0", "ke.bomet", requestInfo));
    }

    /** Tri-state pin check: HRMS answered with zero matches ⇒ FALSE (genuinely stale pin). */
    @Test
    void isActiveEmployee_zeroMatches_false() {
        when(serviceRequestRepository.fetchResult(any(), any())).thenReturn(employeesResponse(0));

        assertEquals(Boolean.FALSE, hrmsUtil.isActiveEmployee("gone-uuid", "ke.bomet", requestInfo));
    }

    /** Tri-state pin check: lookup FAILURE ⇒ null, never FALSE — a blip must not bypass an operator pin. */
    @Test
    void isActiveEmployee_lookupFailure_null() {
        when(serviceRequestRepository.fetchResult(any(), any()))
                .thenThrow(new RuntimeException("connection refused"));
        assertNull(hrmsUtil.isActiveEmployee("pin-uuid", "ke.bomet", requestInfo));

        // null response (fetchResult swallows transport errors) is a failure too.
        org.mockito.Mockito.reset(serviceRequestRepository);
        when(serviceRequestRepository.fetchResult(any(), any())).thenReturn(null);
        assertNull(hrmsUtil.isActiveEmployee("pin-uuid", "ke.bomet", requestInfo));
    }

    // ---------------------------------------------------------------------
    // helpers
    // ---------------------------------------------------------------------

    /**
     * HRMS response with {@code count} employees, each holding a CURRENT
     * assignment in its own department ({@code DEPT_<i>}) so a department
     * filter keeps exactly one of them.
     */
    private static Map<String, Object> employeesResponse(int count) {
        List<Object> employees = new ArrayList<>();
        for (int i = 0; i < count; i++) {
            Map<String, Object> assignment = new HashMap<>();
            assignment.put("isCurrentAssignment", true);
            assignment.put("department", "DEPT_" + i);
            Map<String, Object> employee = new HashMap<>();
            employee.put("uuid", "uuid-" + i);
            employee.put("assignments", Collections.singletonList(assignment));
            employees.add(employee);
        }
        Map<String, Object> root = new HashMap<>();
        root.put("Employees", employees);
        return root;
    }
}
