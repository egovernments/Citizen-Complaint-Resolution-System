package org.egov.pgr.policy;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.egov.common.contract.request.RequestInfo;
import org.egov.common.contract.request.User;
import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.util.MDMSUtils;
import org.egov.pgr.web.models.Address;
import org.egov.pgr.web.models.Boundary;
import org.egov.pgr.web.models.Service;
import org.egov.pgr.web.models.ServiceWrapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * Uses the real {@link AccessPolicyRegistry} and real {@link PolicyEvaluator}, with only the
 * outbound accesscontrol call ({@link MDMSUtils#fetchAccessControlActions}) mocked to return the
 * same JsonLogic condition shipped in ACCESSCONTROL-ACTIONS-TEST.actions-test (id 2008) — so this
 * exercises the actual condition contract, not a stand-in. Most {@code enforce()} tests construct
 * a {@link PgrSearchScope} directly (bypassing {@link PolicyDrivenScopeResolver}, which makes an
 * HRMS call) — the {@code resolveScope()} tests near the bottom instead mock the resolver to
 * verify what {@link ScopePolicy} actually gets fetched/passed through.
 *
 * <p>PGR complaint search's scoping rule (which axes are required per role) is declared by
 * {@code resource.complaint.scope} on the actiontest action record — see {@link ScopePolicyEngine}.
 * When no {@code scope} block is configured, the fallback depends on whether the action has a
 * legacy hand-authored {@code condition}: if it does, an in-code jurisdiction-only default
 * ({@link SearchAccessPolicyService#DEFAULT_SCOPE_POLICY}) applies; if it has neither, the action
 * is treated as genuinely never configured and gets
 * {@link SearchAccessPolicyService#UNRESTRICTED_SCOPE_POLICY} instead — see the
 * {@code resolveScope()} tests near the bottom. A previous per-tenant
 * {@code dss.DashboardConfig.departmentScoping} toggle used to vary this at runtime and has been
 * removed.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class SearchAccessPolicyServiceTest {

    private static final String TENANT_ID = "pg.city";
    private static final ObjectMapper MAPPER = new ObjectMapper();

    @Mock
    private MDMSUtils mdmsUtils;

    private SearchAccessPolicyService service;

    @BeforeEach
    void setup() {
        Map<String, Object> condition = Map.of(
                "or", List.of(
                        Map.of("==", List.of(Map.of("var", "user.attributes.tenantWide"), true)),
                        Map.of("and", List.of(
                                Map.of("==", List.of(Map.of("var", "user.type"), "CITIZEN")),
                                Map.of("==", List.of(Map.of("var", "resource.complaint.accountId"), Map.of("var", "user.uuid")))
                        )),
                        Map.of("and", List.of(
                                Map.of("==", List.of(Map.of("var", "user.type"), "EMPLOYEE")),
                                Map.of("in", List.of(Map.of("var", "resource.complaint.boundary"), Map.of("var", "user.attributes.jurisdictions")))
                        ))
                ));
        Map<String, Object> action = Map.of("id", 2008, "url", AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL, "condition", condition);
        when(mdmsUtils.fetchAccessControlActions(any(), eq(TENANT_ID), eq(AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL)))
                .thenReturn(List.of(action));

        AccessPolicyRegistry registry = new AccessPolicyRegistry(mdmsUtils, new ObjectMapper(), new PGRConfiguration());
        service = new SearchAccessPolicyService(null, registry, new PolicyEvaluator(), new PolicyInputBuilder(), new PGRConfiguration());
    }

    @Test
    void citizenScopeKeepsOnlyTheirOwnComplaint() {
        PgrSearchScope scope = new PgrSearchScope(TENANT_ID, false, "citizen-1", null, null);
        RequestInfo requestInfo = requestInfo("citizen-1", "CITIZEN");

        ServiceWrapper own = wrapper("citizen-1", "NA", "WARD_5", TENANT_ID);
        ServiceWrapper someoneElses = wrapper("citizen-2", "NA", "WARD_5", TENANT_ID);

        List<ServiceWrapper> result = service.enforce(requestInfo, TENANT_ID, scope, List.of(own, someoneElses));

        assertEquals(1, result.size());
        assertEquals("citizen-1", result.get(0).getService().getAccountId());
    }

    /**
     * wrapper() builds additionalDetail as a JsonNode (matching PGRRowMapper's real shape, not a
     * plain Map) — this is what actually caught the extractDepartment() bug that only checked
     * `instanceof Map` and silently returned null for every department-scoped check on real
     * search results. Retained even though department no longer affects this condition, since
     * PGRRowMapper's shape is still what buildResourceDoc() has to handle correctly.
     */
    @Test
    void employeeScopeKeepsOnlyMatchingJurisdictionComplaintsRegardlessOfDepartment() {
        // PGR search is jurisdiction-based ONLY: two complaints in DIFFERENT departments but the
        // SAME (matching) jurisdiction are both kept; department plays no role in this decision.
        PgrSearchScope scope = new PgrSearchScope(TENANT_ID, false, null, null, List.of("WARD_5"));
        RequestInfo requestInfo = requestInfo("emp-1", "EMPLOYEE");

        ServiceWrapper sanitationWard5 = wrapper("citizen-1", "SANITATION", "WARD_5", TENANT_ID);
        ServiceWrapper roadsWard5 = wrapper("citizen-2", "ROADS", "WARD_5", TENANT_ID);

        List<ServiceWrapper> result = service.enforce(requestInfo, TENANT_ID, scope, List.of(sanitationWard5, roadsWard5));

        assertEquals(2, result.size());
    }

    @Test
    void employeeWithWrongJurisdictionIsDeniedRegardlessOfDepartment() {
        PgrSearchScope scope = new PgrSearchScope(TENANT_ID, false, null, null, List.of("WARD_5"));
        RequestInfo requestInfo = requestInfo("emp-1", "EMPLOYEE");

        ServiceWrapper sanitationWard9 = wrapper("citizen-1", "SANITATION", "WARD_9", TENANT_ID);

        List<ServiceWrapper> result = service.enforce(requestInfo, TENANT_ID, scope, List.of(sanitationWard9));

        assertTrue(result.isEmpty());
    }

    @Test
    void departmentAloneScopeIsDeniedSinceJurisdictionIsTheOnlyAxisThatMatters() {
        // A department-only scope (5-arg ctor, jurisdictionCodes null) is not something
        // PolicyDrivenScopeResolver can actually produce for PGR anymore — this is a defensive
        // check that the condition itself doesn't fall back to department if such a scope were
        // ever constructed some other way.
        PgrSearchScope scope = new PgrSearchScope(TENANT_ID, false, null, List.of("SANITATION"), null);
        RequestInfo requestInfo = requestInfo("emp-1", "EMPLOYEE");

        ServiceWrapper sanitationWard5 = wrapper("citizen-1", "SANITATION", "WARD_5", TENANT_ID);

        List<ServiceWrapper> result = service.enforce(requestInfo, TENANT_ID, scope, List.of(sanitationWard5));

        assertTrue(result.isEmpty());
    }

    @Test
    void tenantWideScopeKeepsEverythingRegardlessOfJurisdiction() {
        PgrSearchScope scope = new PgrSearchScope(TENANT_ID, false, null, null, null);
        RequestInfo requestInfo = requestInfo("admin-1", "EMPLOYEE");

        ServiceWrapper a = wrapper("citizen-1", "SANITATION", "WARD_5", TENANT_ID);
        ServiceWrapper b = wrapper("citizen-2", "ROADS", "WARD_9", TENANT_ID);

        List<ServiceWrapper> result = service.enforce(requestInfo, TENANT_ID, scope, List.of(a, b));

        assertEquals(2, result.size());
    }

    @Test
    void failClosedSentinelScopeDropsEverything() {
        PgrSearchScope scope = new PgrSearchScope(TENANT_ID, false, null, List.of("__scope_denied__"), null);
        RequestInfo requestInfo = requestInfo("emp-1", "EMPLOYEE");

        ServiceWrapper a = wrapper("citizen-1", "SANITATION", "WARD_5", TENANT_ID);

        List<ServiceWrapper> result = service.enforce(requestInfo, TENANT_ID, scope, List.of(a));

        assertTrue(result.isEmpty());
    }

    @Test
    void mdmsUnavailableFailsClosedAndDropsEverything() {
        // A genuine accesscontrol call FAILURE — distinct from a confirmed-empty "policy not
        // defined" result (see AccessPolicyRegistryTest), which is now backward-compatibly allowed.
        // An outage must still fail closed, or a whole tenant would go unrestricted during one.
        when(mdmsUtils.fetchAccessControlActions(any(), eq("ke.nairobi"), eq(AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL)))
                .thenThrow(new AccessControlUnavailableException("boom", new RuntimeException("boom")));
        PgrSearchScope scope = new PgrSearchScope("ke.nairobi", false, null, null, null);
        RequestInfo requestInfo = requestInfo("admin-1", "EMPLOYEE");

        ServiceWrapper a = wrapper("citizen-1", "SANITATION", "WARD_5", "ke.nairobi");

        List<ServiceWrapper> result = service.enforce(requestInfo, "ke.nairobi", scope, List.of(a));

        assertTrue(result.isEmpty());
    }

    // --- resolveScope(): fetches the MDMS scope policy, falls back when not configured -----------

    @Test
    void resolveScopeFetchesTheMdmsScopePolicyAndPassesItToTheResolver() {
        Map<String, Object> scope = Map.of("axes", List.of("department"), "default", Map.of("department", "OWN"));
        Map<String, Object> resource = Map.of("complaint", Map.of("scope", scope));
        Map<String, Object> action = Map.of("id", 2008, "url", AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL, "resource", resource);
        when(mdmsUtils.fetchAccessControlActions(any(), eq(TENANT_ID), eq(AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL)))
                .thenReturn(List.of(action));
        AccessPolicyRegistry registryWithScope = new AccessPolicyRegistry(mdmsUtils, new ObjectMapper(), new PGRConfiguration());
        PolicyDrivenScopeResolver mockResolver = mock(PolicyDrivenScopeResolver.class);
        SearchAccessPolicyService serviceWithMockResolver =
                new SearchAccessPolicyService(mockResolver, registryWithScope, new PolicyEvaluator(), new PolicyInputBuilder(), new PGRConfiguration());
        RequestInfo requestInfo = requestInfo("emp-1", "EMPLOYEE");

        serviceWithMockResolver.resolveScope(requestInfo, TENANT_ID, 2);

        ArgumentCaptor<ScopePolicy> captor = ArgumentCaptor.forClass(ScopePolicy.class);
        verify(mockResolver).resolve(eq(requestInfo), eq(TENANT_ID), eq(2), captor.capture());
        assertEquals(ScopeLevel.OWN, captor.getValue().levelFor("ANY_ROLE", "department"));
    }

    @Test
    void resolveScopeFallsBackToJurisdictionOnlyDefaultWhenNoScopeConfigured() {
        // No 'scope' block on the mocked action (@BeforeEach's action only has a hand-authored
        // condition) — must fall back to the jurisdiction-only default, not fail or pass null.
        PolicyDrivenScopeResolver mockResolver = mock(PolicyDrivenScopeResolver.class);
        AccessPolicyRegistry registryNoScope = new AccessPolicyRegistry(mdmsUtils, new ObjectMapper(), new PGRConfiguration());
        SearchAccessPolicyService serviceWithMockResolver =
                new SearchAccessPolicyService(mockResolver, registryNoScope, new PolicyEvaluator(), new PolicyInputBuilder(), new PGRConfiguration());
        RequestInfo requestInfo = requestInfo("emp-1", "EMPLOYEE");

        serviceWithMockResolver.resolveScope(requestInfo, TENANT_ID, 2);

        ArgumentCaptor<ScopePolicy> captor = ArgumentCaptor.forClass(ScopePolicy.class);
        verify(mockResolver).resolve(eq(requestInfo), eq(TENANT_ID), eq(2), captor.capture());
        assertEquals(ScopeLevel.ALL, captor.getValue().levelFor("ANY_ROLE", "department"));
        assertEquals(ScopeLevel.OWN, captor.getValue().levelFor("ANY_ROLE", "jurisdiction"));
    }

    @Test
    void resolveScopeIsFullyUnrestrictedWhenActionHasNeitherScopeNorCondition() {
        // Distinct from resolveScopeFallsBackToJurisdictionOnlyDefaultWhenNoScopeConfigured above:
        // that test's action has a legacy hand-authored condition (@BeforeEach), so
        // DEFAULT_SCOPE_POLICY's jurisdiction requirement is still intentional. Here the action is
        // visible but has NEVER had any policy authored at all — Tier-2
        // (AccessPolicyRegistry#getCondition) already treats that as backward-compatible-allow, so
        // Tier-1 must not silently require HRMS jurisdiction data nobody configured.
        Map<String, Object> action = Map.of("id", 2008, "url", AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL, "enabled", true);
        when(mdmsUtils.fetchAccessControlActions(any(), eq(TENANT_ID), eq(AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL)))
                .thenReturn(List.of(action));
        AccessPolicyRegistry registryUnconfigured = new AccessPolicyRegistry(mdmsUtils, new ObjectMapper(), new PGRConfiguration());
        PolicyDrivenScopeResolver mockResolver = mock(PolicyDrivenScopeResolver.class);
        SearchAccessPolicyService serviceWithMockResolver =
                new SearchAccessPolicyService(mockResolver, registryUnconfigured, new PolicyEvaluator(), new PolicyInputBuilder(), new PGRConfiguration());
        RequestInfo requestInfo = requestInfo("emp-1", "EMPLOYEE");

        serviceWithMockResolver.resolveScope(requestInfo, TENANT_ID, 2);

        ArgumentCaptor<ScopePolicy> captor = ArgumentCaptor.forClass(ScopePolicy.class);
        verify(mockResolver).resolve(eq(requestInfo), eq(TENANT_ID), eq(2), captor.capture());
        assertTrue(captor.getValue().getAxes().isEmpty(), "no axes declared — no restriction on department or jurisdiction");
        // resolveScope() used to call registry.getScopePolicy() then registry.isPolicyUnconfigured()
        // separately, each independently re-fetching on a cache miss — a real double-fetch/doubled
        // hot-path-load bug (#1827 review). Both facts must now come from ONE fetch.
        verify(mdmsUtils, times(1)).fetchAccessControlActions(any(), eq(TENANT_ID), eq(AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL));
    }

    @Test
    void resolveScopeIsFullyUnrestrictedWhenNoActionIsVisibleAtAll() {
        // Same "genuinely unconfigured" treatment as the neither-scope-nor-condition case above —
        // no MDMS entry visible at all is the SAME "not configured for this deployment" signal
        // AccessPolicyRegistry#getCondition already treats as backward-compatible-allow.
        when(mdmsUtils.fetchAccessControlActions(any(), eq(TENANT_ID), eq(AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL)))
                .thenReturn(List.of());
        AccessPolicyRegistry registryNoAction = new AccessPolicyRegistry(mdmsUtils, new ObjectMapper(), new PGRConfiguration());
        PolicyDrivenScopeResolver mockResolver = mock(PolicyDrivenScopeResolver.class);
        SearchAccessPolicyService serviceWithMockResolver =
                new SearchAccessPolicyService(mockResolver, registryNoAction, new PolicyEvaluator(), new PolicyInputBuilder(), new PGRConfiguration());
        RequestInfo requestInfo = requestInfo("emp-1", "EMPLOYEE");

        serviceWithMockResolver.resolveScope(requestInfo, TENANT_ID, 2);

        ArgumentCaptor<ScopePolicy> captor = ArgumentCaptor.forClass(ScopePolicy.class);
        verify(mockResolver).resolve(eq(requestInfo), eq(TENANT_ID), eq(2), captor.capture());
        assertTrue(captor.getValue().getAxes().isEmpty());
        verify(mdmsUtils, times(1)).fetchAccessControlActions(any(), eq(TENANT_ID), eq(AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL));
    }

    @Test
    void resolveScopeDeniesInsteadOfApplyingTheDefaultWhenStrictModeIsEnabled() {
        // count() never calls enforce() (Tier-2) the way search() does — without this, a tenant on
        // the legacy hand-authored condition could get a count() that disagrees with what search()
        // actually returns. Once pgr.abac.strict-mode is on, Tier-1 (this) must deny identically to
        // Tier-2 (AccessPolicyRegistry#getCondition) for the exact same "no scope configured" case,
        // so search() and count() can never disagree (#1441 review).
        PGRConfiguration strictConfig = new PGRConfiguration();
        strictConfig.setAbacStrictMode(true);
        AccessPolicyRegistry registryNoScope = new AccessPolicyRegistry(mdmsUtils, new ObjectMapper(), strictConfig);
        PolicyDrivenScopeResolver mockResolver = mock(PolicyDrivenScopeResolver.class);
        SearchAccessPolicyService serviceWithStrictMode =
                new SearchAccessPolicyService(mockResolver, registryNoScope, new PolicyEvaluator(), new PolicyInputBuilder(), strictConfig);
        RequestInfo requestInfo = requestInfo("emp-1", "EMPLOYEE");

        PgrSearchScope scope = serviceWithStrictMode.resolveScope(requestInfo, TENANT_ID, 2);

        assertEquals(List.of("__scope_denied__"), scope.departmentCodes);
        verifyNoInteractions(mockResolver);
    }

    @Test
    void resolveScopeFailsClosedRatherThanApplyingTheDefaultDuringAnAccessControlOutage() {
        // Must NOT collapse an outage into "not configured" and silently apply the permissive
        // DEFAULT_SCOPE_POLICY while accesscontrol is down (CodeRabbit #3775816481).
        when(mdmsUtils.fetchAccessControlActions(any(), eq(TENANT_ID), eq(AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL)))
                .thenThrow(new AccessControlUnavailableException("boom", new RuntimeException("boom")));
        AccessPolicyRegistry registryUnavailable = new AccessPolicyRegistry(mdmsUtils, new ObjectMapper(), new PGRConfiguration());
        PolicyDrivenScopeResolver mockResolver = mock(PolicyDrivenScopeResolver.class);
        SearchAccessPolicyService serviceWithMockResolver =
                new SearchAccessPolicyService(mockResolver, registryUnavailable, new PolicyEvaluator(), new PolicyInputBuilder(), new PGRConfiguration());
        RequestInfo requestInfo = requestInfo("emp-1", "EMPLOYEE");

        org.junit.jupiter.api.Assertions.assertThrows(AccessControlUnavailableException.class,
                () -> serviceWithMockResolver.resolveScope(requestInfo, TENANT_ID, 2));
    }

    @Test
    void resolveScopeFailsClosedOnAnUnsupportedAxisRatherThanApplyingTheDefault() {
        // PGRService.count() calls resolveScope() but never calls enforce() (no Tier-2 re-check on
        // that path) — so an unsupported axis MUST be rejected here, at the one entry point both
        // search() and count() share, not left to Tier 2 alone (#1441 review: "_count never runs
        // Tier 2, so it can expose an insufficiently scoped count").
        Map<String, Object> scope = Map.of(
                "axes", List.of("department", "unsupported-axis"),
                "default", Map.of("department", "OWN", "unsupported-axis", "OWN"));
        Map<String, Object> resource = Map.of("complaint", Map.of("scope", scope));
        Map<String, Object> action = Map.of("id", 2008, "url", AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL, "resource", resource);
        when(mdmsUtils.fetchAccessControlActions(any(), eq(TENANT_ID), eq(AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL)))
                .thenReturn(List.of(action));
        AccessPolicyRegistry registryWithBadAxis = new AccessPolicyRegistry(mdmsUtils, new ObjectMapper(), new PGRConfiguration());
        PolicyDrivenScopeResolver mockResolver = mock(PolicyDrivenScopeResolver.class);
        SearchAccessPolicyService serviceWithMockResolver =
                new SearchAccessPolicyService(mockResolver, registryWithBadAxis, new PolicyEvaluator(), new PolicyInputBuilder(), new PGRConfiguration());
        RequestInfo requestInfo = requestInfo("emp-1", "EMPLOYEE");

        org.junit.jupiter.api.Assertions.assertThrows(MalformedScopePolicyException.class,
                () -> serviceWithMockResolver.resolveScope(requestInfo, TENANT_ID, 2));
    }

    private RequestInfo requestInfo(String uuid, String type) {
        User user = new User();
        user.setUuid(uuid);
        user.setType(type);
        RequestInfo requestInfo = new RequestInfo();
        requestInfo.setUserInfo(user);
        return requestInfo;
    }

    /** Builds additionalDetail as a JsonNode, matching PGRRowMapper's real shape (not a plain Map). */
    private ServiceWrapper wrapper(String accountId, String department, String boundary, String tenantId) {
        Address address = Address.builder().tenantId(tenantId).locality(Boundary.builder().code(boundary).build()).build();
        Service service = Service.builder()
                .accountId(accountId)
                .tenantId(tenantId)
                .additionalDetail(MAPPER.createObjectNode().put("department", department))
                .address(address)
                .build();
        return ServiceWrapper.builder().service(service).build();
    }
}
