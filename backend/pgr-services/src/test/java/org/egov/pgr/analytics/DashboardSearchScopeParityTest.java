package org.egov.pgr.analytics;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.egov.common.contract.request.RequestInfo;
import org.egov.common.contract.request.Role;
import org.egov.common.contract.request.User;
import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.policy.AccessPolicyRegistry;
import org.egov.pgr.policy.PgrSearchScope;
import org.egov.pgr.policy.BoundaryHierarchyExpander;
import org.egov.pgr.policy.PolicyDrivenScopeResolver;
import org.egov.pgr.policy.ScopePolicy;
import org.egov.pgr.policy.ScopePolicyEngine;
import org.egov.pgr.policy.SearchAccessPolicyService;
import org.egov.pgr.util.MDMSUtils;
import org.egov.pgr.util.Principals;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.web.client.RestTemplate;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

/**
 * The point of #1050, as an assertion: <b>one principal, one policy, both surfaces agree.</b>
 *
 * <p>Before this, the dashboard and {@code /v2/request/_search} answered the same question with two
 * resolvers reading two different rule sets, and they disagreed — most visibly on jurisdiction,
 * which the analytics resolver deliberately left unresolved, so a ward-scoped GRO was restricted on
 * search and saw every ward on the dashboard.
 *
 * <p>This runs both paths against the real action-2008 policy and the same stubbed HRMS, and
 * asserts the resolved scopes are identical, role by role. It is the regression that would catch a
 * second resolver being reintroduced, whatever it was called.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class DashboardSearchScopeParityTest {

    private static final String TENANT = "pg.city";
    private static final int STATE_LEVEL_LEN = 2;

    /** Action 2008's authored policy, verbatim from the seeded MDMS record. */
    private static final Map<String, Object> ACTION_2008_SCOPE = Map.of(
            "axes", List.of("department", "jurisdiction"),
            "roleScopes", Map.of(
                    "GRO", Map.of("department", "OWN", "jurisdiction", "OWN"),
                    "PGR_LME", Map.of("department", "OWN", "jurisdiction", "OWN"),
                    "SUPERVISOR", Map.of("department", "OWN", "jurisdiction", "ALL")),
            "default", Map.of("department", "OWN", "jurisdiction", "OWN"));

    @Mock private PGRConfiguration config;
    @Mock private RestTemplate restTemplate;
    @Mock private AccessPolicyRegistry registry;
    @Mock private MDMSUtils mdmsUtils;
    @Mock private KpiCatalogService catalog;
    @Mock private BoundaryHierarchyExpander boundaryHierarchyExpander;

    private SearchAccessPolicyService searchScope;
    private AnalyticsRowScopeResolver dashboardScope;

    @BeforeEach
    void setUp() {
        when(config.getHrmsHost()).thenReturn("http://localhost:8092");
        when(config.getHrmsEndPoint()).thenReturn("/egov-hrms/employees/_search");
        // #1827 replaced getScopePolicy with resolveScopeState, which also reports whether the
        // action is genuinely unconfigured. Here it IS configured, so `unconfigured` is false.
        when(registry.resolveScopeState(eq(AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL), any(), anyString(), eq("complaint")))
                .thenReturn(new AccessPolicyRegistry.ScopeResolution(ScopePolicy.parse(ACTION_2008_SCOPE), false));
        when(catalog.isDepartmentScopingDisabled(anyString())).thenReturn(false);
        // No-op passthrough — this test is about search/dashboard PARITY, not descendant
        // expansion, which BoundaryHierarchyExpander(Test) already covers on its own.
        when(boundaryHierarchyExpander.descendantsOf(any(), any(), any(), any()))
                .thenAnswer(inv -> java.util.Set.of(inv.getArgument(3, String.class)));

        PolicyDrivenScopeResolver policyResolver = new PolicyDrivenScopeResolver(
                config, restTemplate, new ObjectMapper(), new Principals(), mdmsUtils, boundaryHierarchyExpander);
        searchScope = new SearchAccessPolicyService(policyResolver, registry, null, null, config);
        dashboardScope = new AnalyticsRowScopeResolver(searchScope, catalog);
    }

    @ParameterizedTest(name = "{0} resolves identically on both surfaces")
    @CsvSource({
            "GRO",
            "PGR_LME",
            "SUPERVISOR",
            "CSR",              // no roleScopes entry — takes the policy's default block
            "PGR_ADMIN",        // likewise; the retired resolver exempted this role by hard-coded list
            "SUPERUSER",
    })
    void theDashboardAndSearchResolveTheSameScopeForTheSameEmployee(String roleCode) {
        stubHrms(List.of(Map.of("department", "DEPT_1", "isCurrentAssignment", true)),
                List.of(Map.of("boundary", "WARD_001", "isActive", true)));
        RequestInfo requestInfo = employee("emp-1", roleCode);

        PgrSearchScope onSearch = searchScope.resolveScope(requestInfo, TENANT, STATE_LEVEL_LEN);
        PgrSearchScope onDashboard = dashboardScope.resolve(requestInfo, TENANT, STATE_LEVEL_LEN);

        assertEquals(describe(onSearch), describe(onDashboard));
    }

    @Test
    void aCitizenIsSelfScopedOnBothSurfaces() {
        RequestInfo requestInfo = citizen("citizen-1");

        assertEquals(describe(searchScope.resolveScope(requestInfo, TENANT, STATE_LEVEL_LEN)),
                describe(dashboardScope.resolve(requestInfo, TENANT, STATE_LEVEL_LEN)));
    }

    @Test
    void anEmployeeWithNoHrmsRecordIsDeniedOnBothSurfaces() {
        // Fail-closed has to be identical too — a scope that denies on one surface and allows on
        // the other is the same class of bug as a scope that differs.
        stubHrms(List.of(), List.of());
        RequestInfo requestInfo = employee("emp-nobody", "PGR_LME");

        assertEquals(describe(searchScope.resolveScope(requestInfo, TENANT, STATE_LEVEL_LEN)),
                describe(dashboardScope.resolve(requestInfo, TENANT, STATE_LEVEL_LEN)));
    }

    @Test
    void theDashboardNowCarriesTheJurisdictionAxisItUsedToDiscard() {
        // The concrete disagreement #1050 existed to close: a ward-scoped GRO. The retired
        // resolver hard-coded boundaryPrefix = null, so the dashboard ignored their ward entirely.
        stubHrms(List.of(Map.of("department", "DEPT_1", "isCurrentAssignment", true)),
                List.of(Map.of("boundary", "WARD_001", "isActive", true)));

        PgrSearchScope scope = dashboardScope.resolve(employee("emp-1", "GRO"), TENANT, STATE_LEVEL_LEN);

        assertEquals(List.of("WARD_001"), scope.jurisdictionCodes);
        assertEquals(List.of("DEPT_1"), scope.departmentCodes,
                "GRO is department-OWN under action 2008");
    }

    @Test
    void theTenantDepartmentScopingSwitchIsTheOnlyThingThatMakesThemDiffer() {
        // #1280 lets a tenant with no departments in its complaint data turn that axis off for the
        // dashboard. It is a second policy source and the only sanctioned divergence; it must
        // narrow nothing else, and must leave jurisdiction and tenant scoping alone.
        when(catalog.isDepartmentScopingDisabled(TENANT)).thenReturn(true);
        stubHrms(List.of(Map.of("department", "DEPT_1", "isCurrentAssignment", true)),
                List.of(Map.of("boundary", "WARD_001", "isActive", true)));
        RequestInfo requestInfo = employee("emp-1", "PGR_LME");

        PgrSearchScope onSearch = searchScope.resolveScope(requestInfo, TENANT, STATE_LEVEL_LEN);
        PgrSearchScope onDashboard = dashboardScope.resolve(requestInfo, TENANT, STATE_LEVEL_LEN);

        assertEquals(List.of("DEPT_1"), onSearch.departmentCodes);
        assertNull(onDashboard.departmentCodes, "the tenant turned the department axis off");
        assertEquals(onSearch.jurisdictionCodes, onDashboard.jurisdictionCodes);
        assertEquals(onSearch.tenantId, onDashboard.tenantId);
        assertEquals(onSearch.tenantStateLevel, onDashboard.tenantStateLevel);
    }

    @Test
    void theTenantSwitchNeverOverturnsADenial() {
        // The engine expresses "you may see nothing" as a department list holding one sentinel.
        // Treating that as an ordinary department axis and dropping it — which #1280's switch does
        // to a real axis — would turn every deny into an unrestricted tenant-wide scope: an
        // unauthorized tenant, an unresolvable principal, or strict mode with no policy would all
        // start returning every row.
        when(catalog.isDepartmentScopingDisabled(TENANT)).thenReturn(true);
        stubHrms(List.of(), List.of());   // no HRMS record -> the engine denies
        RequestInfo requestInfo = employee("emp-nobody", "PGR_LME");

        PgrSearchScope onSearch = searchScope.resolveScope(requestInfo, TENANT, STATE_LEVEL_LEN);
        PgrSearchScope onDashboard = dashboardScope.resolve(requestInfo, TENANT, STATE_LEVEL_LEN);

        assertEquals(List.of(ScopePolicyEngine.UNRESOLVED_SENTINEL), onSearch.departmentCodes);
        assertEquals(describe(onSearch), describe(onDashboard),
                "a denied scope must survive the tenant department-scoping switch untouched");
    }

    @Test
    void aCallerOutsideTheirOwnTenantSubtreeIsDeniedEvenWithTheSwitchOn() {
        // The same fail-open, reached the other way: the tenant-affiliation check denies, and the
        // switch must not undo it.
        when(catalog.isDepartmentScopingDisabled(anyString())).thenReturn(true);
        stubHrms(List.of(Map.of("department", "DEPT_1", "isCurrentAssignment", true)), List.of());
        RequestInfo outsider = employee("emp-elsewhere", "PGR_LME");
        outsider.getUserInfo().setTenantId("pg.othercity");

        PgrSearchScope scope = dashboardScope.resolve(outsider, TENANT, STATE_LEVEL_LEN);

        assertEquals(List.of(ScopePolicyEngine.UNRESOLVED_SENTINEL), scope.departmentCodes,
                "an unauthorized tenant must stay denied");
    }

    @Test
    void anUnconfiguredActionLeavesBothSurfacesUnrestricted() {
        // #1827: an action that is visible but genuinely bare — no scope block, no legacy
        // condition — means nobody authored a policy, so no axis restricts anyone. This is the
        // supported way to run a tenant with ABAC effectively off, and the dashboard has to honour
        // it identically to search, or turning it off would silently only half work.
        when(registry.resolveScopeState(eq(AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL), any(), anyString(), eq("complaint")))
                .thenReturn(new AccessPolicyRegistry.ScopeResolution(java.util.Optional.empty(), true));
        stubHrms(List.of(Map.of("department", "DEPT_1", "isCurrentAssignment", true)),
                List.of(Map.of("boundary", "WARD_001", "isActive", true)));
        RequestInfo requestInfo = employee("emp-1", "PGR_LME");

        PgrSearchScope onSearch = searchScope.resolveScope(requestInfo, TENANT, STATE_LEVEL_LEN);
        PgrSearchScope onDashboard = dashboardScope.resolve(requestInfo, TENANT, STATE_LEVEL_LEN);

        assertNull(onDashboard.departmentCodes, "no authored policy means no department axis");
        assertNull(onDashboard.jurisdictionCodes, "no authored policy means no jurisdiction axis");
        assertEquals(describe(onSearch), describe(onDashboard));
    }

    // ---- helpers ----------------------------------------------------------------------------

    private void stubHrms(List<Map<String, Object>> assignments, List<Map<String, Object>> jurisdictions) {
        Map<String, Object> employee = new HashMap<>();
        employee.put("assignments", assignments);
        employee.put("jurisdictions", jurisdictions);
        when(restTemplate.postForObject(any(String.class), any(), eq(Map.class)))
                .thenReturn(Map.of("Employees", List.of(employee)));
    }

    /** A real HRMS token carries the generic EMPLOYEE marker alongside the functional role. */
    private static RequestInfo employee(String uuid, String roleCode) {
        User user = new User();
        user.setUuid(uuid);
        user.setUserName(uuid);
        user.setType("EMPLOYEE");
        user.setTenantId(TENANT);
        user.setRoles(List.of(Role.builder().code("EMPLOYEE").build(),
                Role.builder().code(roleCode).build()));
        return RequestInfo.builder().userInfo(user).build();
    }

    private static RequestInfo citizen(String uuid) {
        User user = new User();
        user.setUuid(uuid);
        user.setUserName(uuid);
        user.setType("CITIZEN");
        user.setTenantId(TENANT);
        user.setRoles(List.of(Role.builder().code("CITIZEN").build()));
        return RequestInfo.builder().userInfo(user).build();
    }

    private static String describe(PgrSearchScope scope) {
        return "tenant=" + scope.tenantId + " subtree=" + scope.tenantStateLevel
                + " citizen=" + scope.citizenUuid
                + " departments=" + scope.departmentCodes
                + " jurisdictions=" + scope.jurisdictionCodes;
    }

    /** Guards the fixture: the policy above must actually parse, or every assertion is vacuous. */
    @Test
    void theFixturePolicyParses() {
        Optional<ScopePolicy> policy = ScopePolicy.parse(ACTION_2008_SCOPE);
        assertEquals(true, policy.isPresent());
    }
}
