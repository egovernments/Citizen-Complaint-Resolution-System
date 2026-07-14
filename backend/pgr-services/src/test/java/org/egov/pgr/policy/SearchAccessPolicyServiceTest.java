package org.egov.pgr.policy;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.egov.common.contract.request.RequestInfo;
import org.egov.common.contract.request.User;
import org.egov.pgr.analytics.AnalyticsScope;
import org.egov.pgr.util.MDMSUtils;
import org.egov.pgr.web.models.Address;
import org.egov.pgr.web.models.Boundary;
import org.egov.pgr.web.models.Service;
import org.egov.pgr.web.models.ServiceWrapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
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
import static org.mockito.Mockito.when;

/**
 * Uses the real {@link AccessPolicyRegistry} and real {@link PolicyEvaluator}, with only the
 * outbound accesscontrol call ({@link MDMSUtils#fetchAccessControlActions}) mocked to return the
 * same JsonLogic condition shipped in ACCESSCONTROL-ACTIONS-TEST.actions-test (id 2008) — so this
 * exercises the actual condition contract, not a stand-in. Only
 * {@link org.egov.pgr.analytics.PrincipalScopeResolver} is out of scope here (it makes an HRMS
 * call) — scope is constructed directly per test instead.
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
                                Map.of("in", List.of(Map.of("var", "resource.complaint.department"), Map.of("var", "user.attributes.departments"))),
                                Map.of("in", List.of(Map.of("var", "resource.complaint.boundary"), Map.of("var", "user.attributes.jurisdictions")))
                        ))
                ));
        Map<String, Object> action = Map.of("id", 2008, "url", AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL, "condition", condition);
        when(mdmsUtils.fetchAccessControlActions(any(), eq(TENANT_ID), eq(AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL)))
                .thenReturn(List.of(action));

        AccessPolicyRegistry registry = new AccessPolicyRegistry(mdmsUtils, new ObjectMapper());
        service = new SearchAccessPolicyService(null, registry, new PolicyEvaluator(), new PolicyInputBuilder());
    }

    @Test
    void citizenScopeKeepsOnlyTheirOwnComplaint() {
        AnalyticsScope scope = new AnalyticsScope(TENANT_ID, false, "citizen-1", null, null);
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
     * search results.
     */
    @Test
    void employeeScopeKeepsOnlyMatchingDepartmentAndJurisdictionComplaints() {
        AnalyticsScope scope = new AnalyticsScope(TENANT_ID, false, null, null, List.of("SANITATION"), List.of("WARD_5"));
        RequestInfo requestInfo = requestInfo("emp-1", "EMPLOYEE");

        ServiceWrapper sanitationWard5 = wrapper("citizen-1", "SANITATION", "WARD_5", TENANT_ID);
        ServiceWrapper roadsWard5 = wrapper("citizen-2", "ROADS", "WARD_5", TENANT_ID);

        List<ServiceWrapper> result = service.enforce(requestInfo, TENANT_ID, scope, List.of(sanitationWard5, roadsWard5));

        assertEquals(1, result.size());
        assertEquals("SANITATION", ((JsonNode) result.get(0).getService().getAdditionalDetail()).get("department").asText());
    }

    @Test
    void employeeInMatchingDepartmentButWrongJurisdictionIsDenied() {
        AnalyticsScope scope = new AnalyticsScope(TENANT_ID, false, null, null, List.of("SANITATION"), List.of("WARD_5"));
        RequestInfo requestInfo = requestInfo("emp-1", "EMPLOYEE");

        ServiceWrapper sanitationWard9 = wrapper("citizen-1", "SANITATION", "WARD_9", TENANT_ID);

        List<ServiceWrapper> result = service.enforce(requestInfo, TENANT_ID, scope, List.of(sanitationWard9));

        assertTrue(result.isEmpty());
    }

    @Test
    void employeeWithNoResolvedJurisdictionIsDeniedEvenWithMatchingDepartment() {
        // null jurisdictionCodes (5-arg ctor) — mirrors an employee scope where jurisdiction was
        // never resolved (should not happen post PrincipalScopeResolver's fail-closed change, but
        // this proves the condition itself, not just the resolver, enforces the axis).
        AnalyticsScope scope = new AnalyticsScope(TENANT_ID, false, null, null, List.of("SANITATION"));
        RequestInfo requestInfo = requestInfo("emp-1", "EMPLOYEE");

        ServiceWrapper sanitationWard5 = wrapper("citizen-1", "SANITATION", "WARD_5", TENANT_ID);

        List<ServiceWrapper> result = service.enforce(requestInfo, TENANT_ID, scope, List.of(sanitationWard5));

        assertTrue(result.isEmpty());
    }

    @Test
    void tenantWideScopeKeepsEverythingRegardlessOfJurisdiction() {
        AnalyticsScope scope = new AnalyticsScope(TENANT_ID, false, null, null, null);
        RequestInfo requestInfo = requestInfo("admin-1", "EMPLOYEE");

        ServiceWrapper a = wrapper("citizen-1", "SANITATION", "WARD_5", TENANT_ID);
        ServiceWrapper b = wrapper("citizen-2", "ROADS", "WARD_9", TENANT_ID);

        List<ServiceWrapper> result = service.enforce(requestInfo, TENANT_ID, scope, List.of(a, b));

        assertEquals(2, result.size());
    }

    @Test
    void failClosedSentinelScopeDropsEverything() {
        AnalyticsScope scope = new AnalyticsScope(TENANT_ID, false, null, null, List.of("__scope_denied__"));
        RequestInfo requestInfo = requestInfo("emp-1", "EMPLOYEE");

        ServiceWrapper a = wrapper("citizen-1", "SANITATION", "WARD_5", TENANT_ID);

        List<ServiceWrapper> result = service.enforce(requestInfo, TENANT_ID, scope, List.of(a));

        assertTrue(result.isEmpty());
    }

    @Test
    void mdmsUnavailableFailsClosedAndDropsEverything() {
        when(mdmsUtils.fetchAccessControlActions(any(), eq("ke.nairobi"), eq(AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL)))
                .thenReturn(List.of());
        AnalyticsScope scope = new AnalyticsScope("ke.nairobi", false, null, null, null);
        RequestInfo requestInfo = requestInfo("admin-1", "EMPLOYEE");

        ServiceWrapper a = wrapper("citizen-1", "SANITATION", "WARD_5", "ke.nairobi");

        List<ServiceWrapper> result = service.enforce(requestInfo, "ke.nairobi", scope, List.of(a));

        assertTrue(result.isEmpty());
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
