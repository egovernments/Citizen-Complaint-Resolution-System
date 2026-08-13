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

import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

/**
 * Covers two things this resolver decides:
 * <ul>
 *   <li>{@link PrincipalScopeResolver#isPureCitizen}, the single source of truth for whether a
 *   principal is locked to their OWN complaints (#1071) — a misclassification here is a data
 *   leak, not a cosmetic bug, hence the fail-closed cases below.</li>
 *   <li>{@link PrincipalScopeResolver#resolve} for an employee principal — department scope from
 *   HRMS, fail-closed when no department resolves, tenant-wide roles bypass regardless.</li>
 * </ul>
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

    // --- isPureCitizen -------------------------------------------------------------------

    @Test
    void citizenRole_isPureCitizen() {
        assertTrue(resolver.isPureCitizen(requestInfoWith("CITIZEN", "CITIZEN")));
    }

    @Test
    void citizenWithExtraNonEmployeeRoles_isStillPureCitizen() {
        // the #1100 review point: a citizen may legitimately carry additional citizen-side roles.
        assertTrue(resolver.isPureCitizen(requestInfoWith("CITIZEN", "CITIZEN", "PGR_CITIZEN_EXTRA")));
    }

    @Test
    void employee_isNotPureCitizen() {
        assertFalse(resolver.isPureCitizen(requestInfoWith("EMPLOYEE", "EMPLOYEE", "GRO")));
    }

    @Test
    void employeeAlsoHoldingCitizenRole_isNotPureCitizen() {
        // employee marker wins — such a principal must keep the employee (HRMS) scope path.
        assertFalse(resolver.isPureCitizen(requestInfoWith("EMPLOYEE", "CITIZEN", "EMPLOYEE")));
        assertFalse(resolver.isPureCitizen(requestInfoWith("EMPLOYEE", "CITIZEN", "COMMON_EMPLOYEE")));
    }

    @Test
    void citizenTypeWithNullRoles_failsClosedToPureCitizen() {
        // fail-CLOSED: without the type fallback this returns false, enrichSearchRequest matches
        // neither branch, userIds stays empty and the ownership clause is dropped — reopening #1071.
        assertTrue(resolver.isPureCitizen(requestInfoWith("CITIZEN", (String[]) null)));
    }

    @Test
    void citizenTypeWithEmptyRoles_failsClosedToPureCitizen() {
        assertTrue(resolver.isPureCitizen(requestInfoWith("CITIZEN")));
    }

    @Test
    void citizenTypeWithUnrecognisedRoleCode_failsClosedToPureCitizen() {
        assertTrue(resolver.isPureCitizen(requestInfoWith("CITIZEN", "SOME_OTHER_CITIZEN_ROLE")));
    }

    @Test
    void systemPrincipalWithNoRoles_isNotPureCitizen() {
        // internal/system callers must NOT be self-scoped to a uuid.
        assertFalse(resolver.isPureCitizen(requestInfoWith("SYSTEM")));
    }

    @Test
    void nullRequestInfoOrUserInfo_isNotPureCitizen() {
        assertFalse(resolver.isPureCitizen(null));
        assertFalse(resolver.isPureCitizen(RequestInfo.builder().build()));
    }

    @Test
    void roleCodeIsCaseAndWhitespaceInsensitive() {
        assertTrue(resolver.isPureCitizen(requestInfoWith("CITIZEN", " citizen ")));
        assertFalse(resolver.isPureCitizen(requestInfoWith("EMPLOYEE", "CITIZEN", " employee ")));
    }

    @Test
    void nullRoleEntryIsIgnored() {
        User user = User.builder().uuid("uuid-1").type("CITIZEN")
                .roles(Arrays.asList(null, Role.builder().code("CITIZEN").build()))
                .build();
        assertTrue(resolver.isPureCitizen(RequestInfo.builder().userInfo(user).build()));
    }

    // --- resolve: employee department scope -------------------------------------------------

    @Test
    void resolvesDepartmentForANormalEmployee() {
        stubHrms(List.of(Map.of("department", "SANITATION", "isCurrentAssignment", true)));

        AnalyticsScope scope = resolver.resolve(requestInfo("emp1", "EMPLOYEE", "GRO"), "pg.city", 2);

        assertEquals(List.of("SANITATION"), scope.departmentCodes);
    }

    @Test
    void failsClosedWhenNoDepartmentResolves() {
        stubHrms(List.of());

        AnalyticsScope scope = resolver.resolve(requestInfo("emp1", "EMPLOYEE", "GRO"), "pg.city", 2);

        assertEquals(List.of("__scope_denied__"), scope.departmentCodes);
    }

    @Test
    void tenantWideRoleBypassesEvenWithNoHrmsDataAtAll() {
        stubHrms(List.of());

        AnalyticsScope scope = resolver.resolve(requestInfo("admin1", "EMPLOYEE", "SUPERUSER"), "pg.city", 2);

        assertNull(scope.departmentCodes);
    }

    private void stubHrms(List<Map<String, Object>> assignments) {
        Map<String, Object> employee = new HashMap<>();
        employee.put("assignments", assignments);
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

    private RequestInfo requestInfoWith(String type, String... roleCodes) {
        List<Role> roles = roleCodes == null ? null : Arrays.stream(roleCodes)
                .map(c -> Role.builder().code(c).build())
                .collect(java.util.stream.Collectors.toList());
        User user = User.builder().uuid("uuid-1").type(type).roles(roles).build();
        return RequestInfo.builder().userInfo(user).build();
    }
}
