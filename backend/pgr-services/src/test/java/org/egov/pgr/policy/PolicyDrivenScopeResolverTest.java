package org.egov.pgr.policy;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.egov.common.contract.request.RequestInfo;
import org.egov.common.contract.request.Role;
import org.egov.common.contract.request.User;
import org.egov.pgr.analytics.KpiCatalogService;
import org.egov.pgr.util.Principals;
import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.util.MDMSUtils;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.web.client.RestTemplate;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * Covers {@link PolicyDrivenScopeResolver#resolve} — PGR complaint search's real call shape,
 * config-driven via {@link ScopePolicy}: which axes are required (level {@code OWN}) vs
 * unrestricted (level {@code ALL}) for a given caller's roles is read from MDMS, resolved by
 * {@link ScopePolicyEngine}. Deliberately a separate test file/class from
 * {@code AnalyticsRowScopeResolverTest} (the dashboard's adapter over this same resolver) —
 * see {@link PolicyDrivenScopeResolver}'s Javadoc for why the two resolvers are kept apart.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class PolicyDrivenScopeResolverTest {

    @Mock
    private PGRConfiguration config;
    @Mock
    private RestTemplate restTemplate;
    @Mock
    private KpiCatalogService catalog;
    @Mock
    private MDMSUtils mdmsUtils;

    private PolicyDrivenScopeResolver resolver;

    @BeforeEach
    void setup() {
        when(config.getHrmsHost()).thenReturn("http://localhost:8092");
        when(config.getHrmsEndPoint()).thenReturn("/egov-hrms/employees/_search");
        ObjectMapper mapper = new ObjectMapper();
        // isPureCitizen is pure role/type inspection — safe to use a real instance here rather
        // than mocking, since none of these tests exercise its HRMS-calling siblings.
        // Unstubbed mdmsUtils.getDepartmentCodeToNameMap defaults to an empty map (Mockito's
        // built-in empty-collection default), which is exactly "no dual-read expansion available"
        // — the department-code lists these tests assert on are left unchanged.
        resolver = new PolicyDrivenScopeResolver(config, restTemplate, mapper, new Principals(), mdmsUtils);
    }

    @Test
    void departmentScopeExpandsToIncludeTheDisplayNameForDualRead() {
        // Complaints created before this system stored the department CODE still have the
        // display NAME in that field (see PGRService#getDepartmentFromMDMS) — the resolved scope
        // must include both so a department-scoped search still matches those historical rows.
        when(mdmsUtils.getDepartmentCodeToNameMap(any(), eq("pg.city"))).thenReturn(Map.of("DEPT_1", "Public Works"));
        ScopePolicy policy = ScopePolicy.of(List.of("department"), Map.of("department", ScopeLevel.OWN));
        stubHrms(List.of(Map.of("department", "DEPT_1", "isCurrentAssignment", true)), List.of());

        PgrSearchScope scope = resolver.resolve(requestInfo("emp1", "EMPLOYEE", "GRO"), "pg.city", 2, policy);

        assertEquals(List.of("DEPT_1", "Public Works"), scope.departmentCodes);
    }

    @Test
    void deniedDepartmentScopeIsNeverExpandedWithADisplayName() {
        // The deny-all sentinel is not a real code — it must never be looked up (wasted call) or,
        // worse, accidentally resolve to a real department name.
        ScopePolicy policy = ScopePolicy.of(List.of("department"), Map.of("department", ScopeLevel.OWN));
        stubHrms(List.of(), List.of());

        PgrSearchScope scope = resolver.resolve(requestInfo("emp1", "EMPLOYEE", "GRO"), "pg.city", 2, policy);

        assertEquals(List.of("__scope_denied__"), scope.departmentCodes);
        verifyNoInteractions(mdmsUtils);
    }

    @Test
    void hrmsLookupUrlEncodesSpecialCharactersInTheUsername() {
        // An HRMS-linked username with '&'/'=' must not be able to inject extra query params or
        // corrupt the query string — it has to survive as the LITERAL value of 'codes' (#1441 review).
        when(config.getHrmsHost()).thenReturn("http://localhost:8092");
        when(config.getHrmsEndPoint()).thenReturn("/egov-hrms/employees/_search");
        stubHrms(List.of(Map.of("department", "DEPT_1", "isCurrentAssignment", true)), List.of());
        ScopePolicy policy = ScopePolicy.of(List.of("department"), Map.of("department", ScopeLevel.OWN));

        resolver.resolve(requestInfo("user&name=x", "EMPLOYEE", "GRO"), "pg.city", 2, policy);

        ArgumentCaptor<String> urlCaptor = ArgumentCaptor.forClass(String.class);
        verify(restTemplate).postForObject(urlCaptor.capture(), any(), eq(Map.class));
        String url = urlCaptor.getValue();
        assertFalse(url.contains("&name="), "the '&' must be encoded, not read as a new query param");
        assertTrue(url.contains("codes=user%26name%3Dx"), "actual URL: " + url);
    }

    @Test
    void inactiveDepartmentAssignmentIsExcludedFromScope() {
        ScopePolicy policy = ScopePolicy.of(List.of("department"), Map.of("department", ScopeLevel.OWN));
        stubHrms(List.of(
                Map.of("department", "DEPT_OLD", "isCurrentAssignment", false),
                Map.of("department", "DEPT_NEW", "isCurrentAssignment", true)), List.of());

        PgrSearchScope scope = resolver.resolve(requestInfo("emp1", "EMPLOYEE", "GRO"), "pg.city", 2, policy);

        assertEquals(List.of("DEPT_NEW"), scope.departmentCodes);
    }

    @Test
    void inactiveJurisdictionIsExcludedFromScope() {
        // A transferred employee's HRMS record still lists their previous ward as isActive=false —
        // it must not stay permanently unioned into the scope after the transfer (#1441 review).
        ScopePolicy policy = ScopePolicy.of(List.of("jurisdiction"), Map.of("jurisdiction", ScopeLevel.OWN));
        stubHrms(List.of(), List.of(
                Map.of("boundary", "WARD_OLD", "isActive", false),
                Map.of("boundary", "WARD_NEW", "isActive", true)));

        PgrSearchScope scope = resolver.resolve(requestInfo("emp1", "EMPLOYEE", "GRO"), "pg.city", 2, policy);

        assertEquals(List.of("WARD_NEW"), scope.jurisdictionCodes);
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
    void roleWithNoExplicitPolicyOpinionAndNoHrmsDataIsDeniedNotBypassed() {
        // The exact vulnerability this fix closes: a hard-coded "tenant-wide" role (SUPERUSER) must
        // NOT get a free pass just because HRMS has no record for it — with no explicit roleScopes
        // entry, SUPERUSER falls through to the policy's OWN/OWN default like anyone else, and with
        // no HRMS data to satisfy that OWN requirement, it must be denied.
        ScopePolicy policy = ScopePolicy.of(List.of("department", "jurisdiction"),
                Map.of("department", ScopeLevel.OWN, "jurisdiction", ScopeLevel.OWN));
        stubHrms(List.of(), List.of());

        PgrSearchScope scope = resolver.resolve(requestInfo("admin1", "EMPLOYEE", "SUPERUSER"), "pg.city", 2, policy);

        assertEquals(List.of("__scope_denied__"), scope.departmentCodes);
        assertEquals(List.of("__scope_denied__"), scope.jurisdictionCodes);
    }

    @Test
    void roleExplicitlyGrantedAllRemainsUnrestrictedEvenWithNoHrmsDataAtAll() {
        // The correct realization of "only an explicit policy ALL can remove a restriction": when
        // the authored policy itself grants SUPERUSER ALL on both axes, a caller with zero HRMS data
        // still resolves unrestricted — this is a policy decision, not a hard-coded role shortcut.
        ScopePolicy policy = policyWithRoleScopes(
                List.of("department", "jurisdiction"),
                Map.of("SUPERUSER", Map.of("department", ScopeLevel.ALL, "jurisdiction", ScopeLevel.ALL)),
                Map.of("department", ScopeLevel.OWN, "jurisdiction", ScopeLevel.OWN));
        stubHrms(List.of(), List.of());

        PgrSearchScope scope = resolver.resolve(requestInfo("admin1", "EMPLOYEE", "SUPERUSER"), "pg.city", 2, policy);

        assertNull(scope.departmentCodes);
        assertNull(scope.jurisdictionCodes);
    }

    @Test
    void crossTenantRequestDeniesEvenWithoutAnyRolePrivilege() {
        // A regular department-restricted employee whose home tenant is "pg.cityA" must be denied
        // outright when the search targets a sibling tenant "pg.cityB" — never reach HRMS/role
        // resolution for a tenant they have no affiliation with.
        ScopePolicy policy = ScopePolicy.of(List.of("department", "jurisdiction"),
                Map.of("department", ScopeLevel.OWN, "jurisdiction", ScopeLevel.OWN));
        stubHrms(List.of(Map.of("department", "DEPT_1", "isCurrentAssignment", true)),
                List.of(Map.of("boundary", "WARD_5")));

        PgrSearchScope scope = resolver.resolve(
                requestInfo("emp1", "EMPLOYEE", "GRO", "pg.cityA"), "pg.cityB", 2, policy);

        assertEquals(List.of("__scope_denied__"), scope.departmentCodes);
    }

    @Test
    void crossTenantRequestDeniesEvenForATenantWideRole() {
        // The exact vulnerability this check closes: a hard-coded tenant-wide role (SUPERUSER)
        // must NOT be able to widen into a tenant it has no home affiliation with just by naming
        // it in the search criteria — even though that role would otherwise get a fully
        // unrestricted scope (see policyDrivenTenantWideRoleBypassesEvenWithNoHrmsDataAtAll).
        ScopePolicy policy = ScopePolicy.of(List.of("department", "jurisdiction"),
                Map.of("department", ScopeLevel.OWN, "jurisdiction", ScopeLevel.OWN));

        PgrSearchScope scope = resolver.resolve(
                requestInfo("admin1", "EMPLOYEE", "SUPERUSER", "pg.cityA"), "pg.cityB", 2, policy);

        assertEquals(List.of("__scope_denied__"), scope.departmentCodes);
    }

    @Test
    void stateLevelCallerMayNarrowIntoOwnSubtreeTenant() {
        // The legitimate mirror case: a state-wide identity ("pg") searching a city under its own
        // subtree ("pg.city") must resolve normally, not be denied.
        ScopePolicy policy = ScopePolicy.of(List.of("department", "jurisdiction"),
                Map.of("department", ScopeLevel.OWN, "jurisdiction", ScopeLevel.OWN));
        stubHrms(List.of(Map.of("department", "DEPT_1", "isCurrentAssignment", true)),
                List.of(Map.of("boundary", "WARD_5")));

        PgrSearchScope scope = resolver.resolve(
                requestInfo("emp1", "EMPLOYEE", "GRO", "pg"), "pg.city", 2, policy);

        assertEquals(List.of("DEPT_1"), scope.departmentCodes);
    }

    @Test
    void missingCallerHomeTenantDeniesRatherThanTrustingTheRequestedTenant() {
        ScopePolicy policy = ScopePolicy.of(List.of("department", "jurisdiction"),
                Map.of("department", ScopeLevel.OWN, "jurisdiction", ScopeLevel.OWN));

        PgrSearchScope scope = resolver.resolve(
                requestInfo("emp1", "EMPLOYEE", "GRO", null), "pg.city", 2, policy);

        assertEquals(List.of("__scope_denied__"), scope.departmentCodes);
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
     *
     * <p>Home tenant defaults to {@code "pg.city"} — the same tenantId every test in this file
     * resolves against — so the tenant/subtree authorization check added alongside this class
     * passes for the "normal" cases; {@link #requestInfo(String, String, String, String)} lets a
     * test override it to exercise cross-tenant denial.
     */
    private RequestInfo requestInfo(String uuid, String type, String roleCode) {
        return requestInfo(uuid, type, roleCode, "pg.city");
    }

    private RequestInfo requestInfo(String uuid, String type, String roleCode, String homeTenantId) {
        User user = new User();
        user.setUuid(uuid);
        user.setUserName(uuid);
        user.setType(type);
        user.setTenantId(homeTenantId);
        user.setRoles("EMPLOYEE".equals(roleCode)
                ? List.of(Role.builder().code(roleCode).build())
                : List.of(Role.builder().code("EMPLOYEE").build(), Role.builder().code(roleCode).build()));
        RequestInfo requestInfo = new RequestInfo();
        requestInfo.setUserInfo(user);
        return requestInfo;
    }
}
