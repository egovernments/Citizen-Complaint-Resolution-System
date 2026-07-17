package org.egov.pgr.analytics;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.egov.common.contract.request.RequestInfo;
import org.egov.common.contract.request.Role;
import org.egov.common.contract.request.User;
import org.egov.pgr.config.PGRConfiguration;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.web.client.RestTemplate;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

/**
 * #1280: pins how PrincipalScopeResolver consults dss.DashboardConfig.departmentScoping.
 *
 * - "enforced" (the fail-safe default, including when no DashboardConfig record exists):
 *   department scoping works exactly as today — HRMS resolution, department IN scope,
 *   fail-closed sentinel for unresolvable constrained employees.
 * - "disabled": the HRMS call is skipped ENTIRELY and the employee gets the unrestricted
 *   (tenant-only) scope. Citizen self-scope is untouched.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
public class PrincipalScopeResolverDeptScopingTest {

    private static final int STATE_LEN = 1;   // "ke" state root; "ke.bomet" city

    @Mock private PGRConfiguration config;
    @Mock private RestTemplate restTemplate;
    @Mock private KpiCatalogService catalog;

    private PrincipalScopeResolver resolver;

    @BeforeEach
    public void setUp() {
        when(config.getHrmsHost()).thenReturn("http://egov-hrms:8080");
        when(config.getHrmsEndPoint()).thenReturn("/egov-hrms/employees/_search");
        resolver = new PrincipalScopeResolver(config, restTemplate, new ObjectMapper(), catalog);
    }

    private static RequestInfo employeeRequest(String userName, String... roleCodes) {
        User u = User.builder().userName(userName).uuid("emp-uuid").type("EMPLOYEE")
                .roles(rolesOf(roleCodes)).build();
        return RequestInfo.builder().userInfo(u).build();
    }

    private static List<Role> rolesOf(String... codes) {
        return java.util.Arrays.stream(codes)
                .map(c -> Role.builder().code(c).build())
                .collect(java.util.stream.Collectors.toList());
    }

    /** HRMS /_search response with one employee holding one active WATER assignment. */
    private void stubHrmsWithDepartment(String dept) {
        Map<String, Object> resp = Map.of("Employees", List.of(
                Map.of("assignments", List.of(
                        Map.of("isCurrentAssignment", true, "department", dept)))));
        when(restTemplate.postForObject(anyString(), any(), eq(Map.class))).thenReturn(resp);
    }

    @Test
    public void enforcedDefaultResolvesDepartmentsFromHrmsAsToday() {
        when(catalog.isDepartmentScopingDisabled(anyString())).thenReturn(false);
        stubHrmsWithDepartment("WATER");

        AnalyticsScope s = resolver.resolve(employeeRequest("EMP-1", "PGR_LME"), "ke.bomet", STATE_LEN);

        assertEquals(List.of("WATER"), s.departmentCodes);
        assertNull(s.citizenUuid);
        assertEquals("ke.bomet", s.tenantId);
        verify(restTemplate).postForObject(anyString(), any(), eq(Map.class));
    }

    @Test
    public void enforcedDefaultKeepsFailClosedSentinelWhenHrmsHasNoRecord() {
        when(catalog.isDepartmentScopingDisabled(anyString())).thenReturn(false);
        when(restTemplate.postForObject(anyString(), any(), eq(Map.class)))
                .thenReturn(Map.of("Employees", List.of()));

        AnalyticsScope s = resolver.resolve(employeeRequest("EMP-1", "PGR_LME"), "ke.bomet", STATE_LEN);

        assertEquals(List.of("__scope_denied__"), s.departmentCodes);   // fail-closed unchanged
    }

    @Test
    public void disabledSkipsHrmsEntirelyAndReturnsUnrestrictedEmployeeScope() {
        when(catalog.isDepartmentScopingDisabled(anyString())).thenReturn(true);

        AnalyticsScope s = resolver.resolve(employeeRequest("EMP-1", "PGR_LME"), "ke.bomet", STATE_LEN);

        assertNull(s.departmentCodes);          // no department axis
        assertNull(s.boundaryPrefix);
        assertNull(s.citizenUuid);
        assertEquals("ke.bomet", s.tenantId);   // tenant scoping untouched
        assertFalse(s.tenantStateLevel);
        verifyNoInteractions(restTemplate);     // HRMS never called
    }

    @Test
    public void disabledKeepsStateLevelTenantSemantics() {
        when(catalog.isDepartmentScopingDisabled(anyString())).thenReturn(true);

        AnalyticsScope s = resolver.resolve(employeeRequest("EMP-1", "PGR_LME"), "ke", STATE_LEN);

        assertTrue(s.tenantStateLevel);
        assertNull(s.departmentCodes);
    }

    @Test
    public void citizenSelfScopeIsUntouchedByDisabled() {
        when(catalog.isDepartmentScopingDisabled(anyString())).thenReturn(true);
        User citizen = User.builder().userName("9876543210").uuid("citizen-uuid").type("CITIZEN")
                .roles(rolesOf("CITIZEN")).build();

        AnalyticsScope s = resolver.resolve(RequestInfo.builder().userInfo(citizen).build(),
                "ke.bomet", STATE_LEN);

        assertEquals("citizen-uuid", s.citizenUuid);   // still self-scoped
        assertNull(s.departmentCodes);
        // pure-citizen path returns before the employee branch — config not even consulted
        verifyNoInteractions(catalog, restTemplate);
    }
}
