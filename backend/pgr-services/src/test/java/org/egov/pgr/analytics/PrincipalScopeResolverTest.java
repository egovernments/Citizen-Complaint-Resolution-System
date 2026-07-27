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
 *   <li>{@link PrincipalScopeResolver#resolve} for an employee principal: the jurisdiction
 *   resolution added alongside the existing department axis — an employee needs BOTH a
 *   resolvable department AND a resolvable jurisdiction to get a restricted (non-deny) scope;
 *   missing either fails closed via unresolvedScope, exactly like department alone did before.
 *   Tenant-wide roles still bypass regardless of HRMS data.</li>
 * </ul>
 * {@code catalog} is left as an unstubbed mock — {@code isDepartmentScopingDisabled} defaults to
 * {@code false}, matching "scoping enabled" for these tests.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class PrincipalScopeResolverTest {

    @Mock
    private PGRConfiguration config;
    @Mock
    private RestTemplate restTemplate;
    @Mock
    private KpiCatalogService catalog;

    private PrincipalScopeResolver resolver;

    @BeforeEach
    void setup() {
        when(config.getHrmsHost()).thenReturn("http://localhost:8092");
        when(config.getHrmsEndPoint()).thenReturn("/egov-hrms/employees/_search");
        resolver = new PrincipalScopeResolver(config, restTemplate, new ObjectMapper(), catalog);
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

    // --- resolve: employee department + jurisdiction axes ---------------------------------

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

    private RequestInfo requestInfoWith(String type, String... roleCodes) {
        List<Role> roles = roleCodes == null ? null : Arrays.stream(roleCodes)
                .map(c -> Role.builder().code(c).build())
                .collect(java.util.stream.Collectors.toList());
        User user = User.builder().uuid("uuid-1").type(type).roles(roles).build();
        return RequestInfo.builder().userInfo(user).build();
    }
}
