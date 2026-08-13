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
 *   <li>{@link PrincipalScopeResolver#resolve} for an employee principal under the default
 *   {@link PrincipalScopeResolver.ScopeAxis#DEPARTMENT_AND_JURISDICTION} axis (Dashboard/Analytics'
 *   call shape) — department and jurisdiction are independent axes: an employee needs at least ONE
 *   of them to resolve to get a restricted (non-deny) scope; only "neither resolved" fails closed.
 *   Tenant-wide roles still bypass regardless of HRMS data. PGR search's own
 *   {@link PrincipalScopeResolver.ScopeAxis#JURISDICTION_ONLY} axis is covered separately.</li>
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
    void scopesByDepartmentAloneWhenNoJurisdictionAssigned() {
        // Department and jurisdiction are independent axes (some tenants don't track department at
        // all): resolving one but not the other scopes by the one that resolved, rather than
        // denying outright — only "neither axis resolved" fails closed (see below).
        stubHrms(List.of(Map.of("department", "SANITATION", "isCurrentAssignment", true)), List.of());

        AnalyticsScope scope = resolver.resolve(requestInfo("emp1", "EMPLOYEE", "GRO"), "pg.city", 2);

        assertEquals(List.of("SANITATION"), scope.departmentCodes);
        assertNull(scope.jurisdictionCodes);
    }

    @Test
    void scopesByJurisdictionAloneWhenNoDepartmentAssigned() {
        stubHrms(List.of(), List.of(Map.of("boundary", "WARD_5")));

        AnalyticsScope scope = resolver.resolve(requestInfo("emp1", "EMPLOYEE", "GRO"), "pg.city", 2);

        assertNull(scope.departmentCodes);
        assertEquals(List.of("WARD_5"), scope.jurisdictionCodes);
    }

    @Test
    void failsClosedWhenNeitherDepartmentNorJurisdictionResolve() {
        stubHrms(List.of(), List.of());

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

    // --- ScopeAxis.JURISDICTION_ONLY (PGR search's own call shape) -----------------------------

    @Test
    void jurisdictionOnlyScopesByJurisdictionEvenWhenHrmsAlsoHasADepartment() {
        // The exact "force jurisdiction-only" scenario: an employee whose HRMS record has BOTH a
        // department AND a jurisdiction. PGR search never looks at department at all — this isn't
        // an optional/missing-data fallback, it's structural for this axis.
        stubHrms(List.of(Map.of("department", "SANITATION", "isCurrentAssignment", true)),
                List.of(Map.of("boundary", "WARD_5")));

        AnalyticsScope scope = resolver.resolve(requestInfo("emp1", "EMPLOYEE", "GRO"), "pg.city", 2,
                PrincipalScopeResolver.ScopeAxis.JURISDICTION_ONLY);

        assertNull(scope.departmentCodes);
        assertEquals(List.of("WARD_5"), scope.jurisdictionCodes);
    }

    @Test
    void jurisdictionOnlyFailsClosedWhenNoJurisdictionEvenWithADepartmentAssigned() {
        // Department being present is irrelevant to this axis — no jurisdiction means denied,
        // full stop, unlike DEPARTMENT_AND_JURISDICTION where department alone would scope it.
        stubHrms(List.of(Map.of("department", "SANITATION", "isCurrentAssignment", true)), List.of());

        AnalyticsScope scope = resolver.resolve(requestInfo("emp1", "EMPLOYEE", "GRO"), "pg.city", 2,
                PrincipalScopeResolver.ScopeAxis.JURISDICTION_ONLY);

        assertEquals(List.of("__scope_denied__"), scope.departmentCodes);
    }

    @Test
    void jurisdictionOnlyTenantWideRoleBypassesEvenWithNoHrmsDataAtAll() {
        stubHrms(List.of(), List.of());

        AnalyticsScope scope = resolver.resolve(requestInfo("admin1", "EMPLOYEE", "SUPERUSER"), "pg.city", 2,
                PrincipalScopeResolver.ScopeAxis.JURISDICTION_ONLY);

        assertNull(scope.departmentCodes);
        assertNull(scope.jurisdictionCodes);
    }

    private void stubHrms(List<Map<String, Object>> assignments, List<Map<String, Object>> jurisdictions) {
        Map<String, Object> employee = new HashMap<>();
        employee.put("assignments", assignments);
        employee.put("jurisdictions", jurisdictions);
        Map<String, Object> hrmsResponse = Map.of("Employees", List.of(employee));
        when(restTemplate.postForObject(any(String.class), any(), eq(Map.class))).thenReturn(hrmsResponse);
    }

    /**
     * A real HRMS-issued token carries the generic EMPLOYEE marker role ALONGSIDE the functional
     * role (GRO, SUPERVISOR, …) — not just that one role alone; stubbed that way here to match.
     */
    private RequestInfo requestInfo(String uuid, String type, String roleCode) {
        User user = new User();
        user.setUuid(uuid);
        user.setUserName(uuid);
        user.setType(type);
        user.setRoles("EMPLOYEE".equals(roleCode)
                ? List.of(Role.builder().code(roleCode).build())
                : List.of(Role.builder().code("EMPLOYEE").build(), Role.builder().code(roleCode).build()));
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
