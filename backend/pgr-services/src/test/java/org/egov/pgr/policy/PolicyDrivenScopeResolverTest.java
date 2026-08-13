package org.egov.pgr.policy;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.egov.common.contract.request.RequestInfo;
import org.egov.common.contract.request.Role;
import org.egov.common.contract.request.User;
import org.egov.pgr.analytics.PrincipalScopeResolver;
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
 * Covers {@link PolicyDrivenScopeResolver#resolve} — PGR complaint search's real call shape,
 * config-driven via {@link ScopePolicy}: which axes are required (level {@code OWN}) vs
 * unrestricted (level {@code ALL}) for a given caller's roles is read from MDMS, resolved by
 * {@link ScopePolicyEngine}. Deliberately a separate test file/class from
 * {@code PrincipalScopeResolverTest} (Dashboard/Analytics' own {@code ScopeAxis}-based tests) —
 * see {@link PolicyDrivenScopeResolver}'s Javadoc for why the two resolvers are kept apart.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class PolicyDrivenScopeResolverTest {

    @Mock
    private PGRConfiguration config;
    @Mock
    private RestTemplate restTemplate;

    private PolicyDrivenScopeResolver resolver;

    @BeforeEach
    void setup() {
        when(config.getHrmsHost()).thenReturn("http://localhost:8092");
        when(config.getHrmsEndPoint()).thenReturn("/egov-hrms/employees/_search");
        ObjectMapper mapper = new ObjectMapper();
        // isPureCitizen is pure role/type inspection — safe to use a real instance here rather
        // than mocking, since none of these tests exercise its HRMS-calling siblings.
        PrincipalScopeResolver principalScopeResolver = new PrincipalScopeResolver(config, restTemplate, mapper);
        resolver = new PolicyDrivenScopeResolver(config, restTemplate, mapper, principalScopeResolver);
    }

    @Test
    void departmentOnlyPolicyIgnoresJurisdictionEntirely() {
        ScopePolicy policy = ScopePolicy.of(List.of("department"), Map.of("department", ScopeLevel.OWN));
        stubHrms(List.of(Map.of("department", "DEPT_1", "isCurrentAssignment", true)),
                List.of(Map.of("boundary", "WARD_5")));

        PgrSearchScope scope = resolver.resolve(requestInfo("emp1", "EMPLOYEE", "GRO"), "pg.city", 2, policy);

        assertEquals(List.of("DEPT_1"), scope.departmentCodes);
        assertNull(scope.jurisdictionCodes);
    }

    @Test
    void boundaryOnlyPolicyIgnoresDepartmentEntirely() {
        ScopePolicy policy = ScopePolicy.of(List.of("jurisdiction"), Map.of("jurisdiction", ScopeLevel.OWN));
        stubHrms(List.of(Map.of("department", "DEPT_1", "isCurrentAssignment", true)),
                List.of(Map.of("boundary", "WARD_5")));

        PgrSearchScope scope = resolver.resolve(requestInfo("emp1", "EMPLOYEE", "GRO"), "pg.city", 2, policy);

        assertNull(scope.departmentCodes);
        assertEquals(List.of("WARD_5"), scope.jurisdictionCodes);
    }

    @Test
    void departmentAndBoundaryPolicyRestrictsBothIndependently() {
        ScopePolicy policy = ScopePolicy.of(List.of("department", "jurisdiction"),
                Map.of("department", ScopeLevel.OWN, "jurisdiction", ScopeLevel.OWN));
        stubHrms(List.of(Map.of("department", "DEPT_1", "isCurrentAssignment", true)),
                List.of(Map.of("boundary", "WARD_5")));

        PgrSearchScope scope = resolver.resolve(requestInfo("emp1", "EMPLOYEE", "GRO"), "pg.city", 2, policy);

        assertEquals(List.of("DEPT_1"), scope.departmentCodes);
        assertEquals(List.of("WARD_5"), scope.jurisdictionCodes);
    }

    @Test
    void roleConfiguredToSeeAllDepartmentsWithinBoundary() {
        // The concrete "higher role sees all complaints of a boundary across depts" use case:
        // SUPERVISOR's department level is ALL, jurisdiction stays OWN.
        ScopePolicy policy = policyWithRoleScopes(
                List.of("department", "jurisdiction"),
                Map.of("SUPERVISOR", Map.of("department", ScopeLevel.ALL, "jurisdiction", ScopeLevel.OWN)),
                Map.of("department", ScopeLevel.OWN, "jurisdiction", ScopeLevel.OWN));
        stubHrms(List.of(Map.of("department", "DEPT_1", "isCurrentAssignment", true)),
                List.of(Map.of("boundary", "WARD_5")));

        PgrSearchScope scope = resolver.resolve(requestInfo("sup1", "EMPLOYEE", "SUPERVISOR"), "pg.city", 2, policy);

        assertNull(scope.departmentCodes, "unrestricted across departments");
        assertEquals(List.of("WARD_5"), scope.jurisdictionCodes, "still scoped to their own boundary");
    }

    @Test
    void roleConfiguredToSeeAllBoundariesWithinDepartment() {
        // The mirror case: "sees all boundaries within their department".
        ScopePolicy policy = policyWithRoleScopes(
                List.of("department", "jurisdiction"),
                Map.of("DGRO", Map.of("department", ScopeLevel.OWN, "jurisdiction", ScopeLevel.ALL)),
                Map.of("department", ScopeLevel.OWN, "jurisdiction", ScopeLevel.OWN));
        stubHrms(List.of(Map.of("department", "DEPT_1", "isCurrentAssignment", true)),
                List.of(Map.of("boundary", "WARD_5")));

        PgrSearchScope scope = resolver.resolve(requestInfo("dgro1", "EMPLOYEE", "DGRO"), "pg.city", 2, policy);

        assertEquals(List.of("DEPT_1"), scope.departmentCodes, "still scoped to their own department");
        assertNull(scope.jurisdictionCodes, "unrestricted across boundaries");
    }

    @Test
    void policyDrivenFailsClosedWhenNeitherAxisResolvesAnyHrmsData() {
        ScopePolicy policy = ScopePolicy.of(List.of("department", "jurisdiction"),
                Map.of("department", ScopeLevel.OWN, "jurisdiction", ScopeLevel.OWN));
        stubHrms(List.of(), List.of());

        PgrSearchScope scope = resolver.resolve(requestInfo("emp1", "EMPLOYEE", "GRO"), "pg.city", 2, policy);

        assertEquals(List.of("__scope_denied__"), scope.departmentCodes);
    }

    @Test
    void policyDrivenTenantWideRoleBypassesEvenWithNoHrmsDataAtAll() {
        ScopePolicy policy = ScopePolicy.of(List.of("department", "jurisdiction"),
                Map.of("department", ScopeLevel.OWN, "jurisdiction", ScopeLevel.OWN));
        stubHrms(List.of(), List.of());

        PgrSearchScope scope = resolver.resolve(requestInfo("admin1", "EMPLOYEE", "SUPERUSER"), "pg.city", 2, policy);

        assertNull(scope.departmentCodes);
        assertNull(scope.jurisdictionCodes);
    }

    @Test
    void policyDrivenRequiredAxisWithNoHrmsDataDeniesEvenWhenOtherAxisResolves() {
        // department is OWN/required but HRMS has none for this employee, even though jurisdiction
        // resolved fine — a required-but-unresolvable axis denies via its own sentinel (AND
        // semantics in the SQL builder), unlike the "independent axis" Dashboard mode this
        // deliberately differs from.
        ScopePolicy policy = ScopePolicy.of(List.of("department", "jurisdiction"),
                Map.of("department", ScopeLevel.OWN, "jurisdiction", ScopeLevel.OWN));
        stubHrms(List.of(), List.of(Map.of("boundary", "WARD_5")));

        PgrSearchScope scope = resolver.resolve(requestInfo("emp1", "EMPLOYEE", "GRO"), "pg.city", 2, policy);

        assertEquals(List.of("__scope_denied__"), scope.departmentCodes);
        assertEquals(List.of("WARD_5"), scope.jurisdictionCodes);
    }

    @Test
    void missingUserInfoDeniesRatherThanResolvingUnrestricted() {
        // A null userInfo previously produced a PgrSearchScope with every axis null, which
        // downstream reads as tenantWide/unrestricted — must deny instead (CodeRabbit #3775816478).
        ScopePolicy policy = ScopePolicy.of(List.of("department", "jurisdiction"),
                Map.of("department", ScopeLevel.OWN, "jurisdiction", ScopeLevel.OWN));

        PgrSearchScope scope = resolver.resolve(RequestInfo.builder().build(), "pg.city", 2, policy);

        assertEquals(List.of("__scope_denied__"), scope.departmentCodes);
    }

    @Test
    void pureCitizenWithBlankUuidDeniesRatherThanResolvingUnrestricted() {
        ScopePolicy policy = ScopePolicy.of(List.of("department", "jurisdiction"),
                Map.of("department", ScopeLevel.OWN, "jurisdiction", ScopeLevel.OWN));
        User user = new User();
        user.setUuid(" ");
        user.setType("CITIZEN");
        user.setRoles(List.of(Role.builder().code("CITIZEN").build()));
        RequestInfo requestInfo = new RequestInfo();
        requestInfo.setUserInfo(user);

        PgrSearchScope scope = resolver.resolve(requestInfo, "pg.city", 2, policy);

        assertEquals(List.of("__scope_denied__"), scope.departmentCodes);
    }

    /** Builds a policy with explicit per-role overrides — {@link ScopePolicy#of} only sets defaults. */
    private ScopePolicy policyWithRoleScopes(List<String> axes,
            Map<String, Map<String, ScopeLevel>> roleScopes, Map<String, ScopeLevel> defaultScope) {
        Map<String, Object> raw = new HashMap<>();
        raw.put("axes", axes);
        Map<String, Object> roleScopesRaw = new HashMap<>();
        roleScopes.forEach((role, levels) -> {
            Map<String, Object> levelsRaw = new HashMap<>();
            levels.forEach((axis, level) -> levelsRaw.put(axis, level.name()));
            roleScopesRaw.put(role, levelsRaw);
        });
        raw.put("roleScopes", roleScopesRaw);
        Map<String, Object> defaultRaw = new HashMap<>();
        defaultScope.forEach((axis, level) -> defaultRaw.put(axis, level.name()));
        raw.put("default", defaultRaw);
        return ScopePolicy.parse(raw).orElseThrow();
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
     * role (GRO, SUPERVISOR, …) — not just that one role alone. Including both here is what
     * actually exercises {@link ScopePolicyEngine}'s "skip roles with no explicit opinion" logic
     * realistically; a single-role stub previously masked a real bug where EMPLOYEE's implicit
     * default fallback neutralized a functional role's explicit restriction.
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
}
