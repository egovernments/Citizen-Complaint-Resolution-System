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

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

/**
 * Verifies the jurisdiction resolution added alongside the existing department axis: an employee
 * needs BOTH a resolvable department AND a resolvable jurisdiction to get a restricted (non-deny)
 * scope — missing either fails closed via unresolvedScope, exactly like department alone did
 * before. Tenant-wide roles still bypass regardless of HRMS data.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class PrincipalScopeResolverTest {

    @Mock
    private PGRConfiguration config;
    @Mock
    private RestTemplate restTemplate;

    private PrincipalScopeResolver resolver;

    @BeforeEach
    void setup() {
        when(config.getHrmsHost()).thenReturn("http://localhost:8092");
        when(config.getHrmsEndPoint()).thenReturn("/egov-hrms/employees/_search");
        resolver = new PrincipalScopeResolver(config, restTemplate, new ObjectMapper());
    }

    @Test
    void resolvesBothDepartmentsAndJurisdictionsForANormalEmployee() {
        stubHrms(List.of(Map.of("department", "SANITATION", "isCurrentAssignment", true)),
                List.of(Map.of("boundary", "WARD_5")));

        AnalyticsScope scope = resolver.resolve(requestInfo("emp1", "EMPLOYEE", "GRO"), "pg.city", 2);

        assertEquals(List.of("SANITATION"), scope.departmentCodes);
        assertEquals(List.of("WARD_5"), scope.jurisdictionCodes);
    }

    @Test
    void failsClosedWhenDepartmentResolvedButNoJurisdictionAssigned() {
        stubHrms(List.of(Map.of("department", "SANITATION", "isCurrentAssignment", true)), List.of());

        AnalyticsScope scope = resolver.resolve(requestInfo("emp1", "EMPLOYEE", "GRO"), "pg.city", 2);

        assertEquals(List.of("__scope_denied__"), scope.departmentCodes);
    }

    @Test
    void failsClosedWhenJurisdictionResolvedButNoDepartmentAssigned() {
        stubHrms(List.of(), List.of(Map.of("boundary", "WARD_5")));

        AnalyticsScope scope = resolver.resolve(requestInfo("emp1", "EMPLOYEE", "GRO"), "pg.city", 2);

        assertEquals(List.of("__scope_denied__"), scope.departmentCodes);
    }

    @Test
    void tenantWideRoleBypassesEvenWithNoHrmsDataAtAll() {
        stubHrms(List.of(), List.of());

        AnalyticsScope scope = resolver.resolve(requestInfo("admin1", "EMPLOYEE", "SUPERUSER"), "pg.city", 2);

        assertNull(scope.departmentCodes);
        assertNull(scope.jurisdictionCodes);
    }

    @Test
    void unionsJurisdictionsAcrossMultipleAssignments() {
        stubHrms(List.of(Map.of("department", "SANITATION", "isCurrentAssignment", true)),
                List.of(Map.of("boundary", "WARD_5"), Map.of("boundary", "WARD_6")));

        AnalyticsScope scope = resolver.resolve(requestInfo("emp1", "EMPLOYEE", "GRO"), "pg.city", 2);

        assertEquals(List.of("WARD_5", "WARD_6"), scope.jurisdictionCodes);
    }

    private void stubHrms(List<Map<String, Object>> assignments, List<Map<String, Object>> jurisdictions) {
        Map<String, Object> employee = new HashMap<>();
        employee.put("assignments", assignments);
        employee.put("jurisdictions", jurisdictions);
        Map<String, Object> hrmsResponse = Map.of("Employees", List.of(employee));
        when(restTemplate.postForObject(any(String.class), any(), eq(Map.class))).thenReturn(hrmsResponse);
    }

    private RequestInfo requestInfo(String uuid, String type, String roleCode) {
        User user = new User();
        user.setUuid(uuid);
        user.setUserName(uuid);
        user.setType(type);
        user.setRoles(List.of(Role.builder().code(roleCode).build()));
        RequestInfo requestInfo = new RequestInfo();
        requestInfo.setUserInfo(user);
        return requestInfo;
    }
}
