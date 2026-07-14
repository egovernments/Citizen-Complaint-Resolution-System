package org.egov.pgr.policy;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.egov.common.contract.request.RequestInfo;
import org.egov.common.contract.request.Role;
import org.egov.common.contract.request.User;
import org.egov.pgr.util.MDMSUtils;
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
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Verifies AccessPolicyRegistry resolves the condition via egov-accesscontrol's role-scoped
 * /access/v1/actions/mdms/_get API (through MDMSUtils.fetchAccessControlActions), fails closed
 * when no visible/enabled action or condition is found, caches successful resolutions, and does
 * NOT cache a "not found" (since that API is role-scoped — a miss for one caller's roles must not
 * lock out a differently-roled caller for the TTL).
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class AccessPolicyRegistryTest {

    @Mock
    private MDMSUtils mdmsUtils;

    private AccessPolicyRegistry registry;

    @BeforeEach
    void setup() {
        registry = new AccessPolicyRegistry(mdmsUtils, new ObjectMapper());
    }

    @Test
    void resolvesConditionFromTheAccessControlAction() {
        Map<String, Object> condition = Map.of("==", List.of(1, 1));
        Map<String, Object> action = Map.of("id", 2008, "url", AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL, "condition", condition);
        RequestInfo requestInfo = requestInfo("CITIZEN");
        when(mdmsUtils.fetchAccessControlActions(requestInfo, "pg.city", AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL))
                .thenReturn(List.of(action));

        String result = registry.getCondition(AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL, requestInfo, "pg.city");

        assertNotNull(result);
        assertTrue(result.contains("=="));
    }

    @Test
    void failsClosedWhenNoActionVisibleForCallersRoles() {
        RequestInfo requestInfo = requestInfo("CITIZEN");
        when(mdmsUtils.fetchAccessControlActions(requestInfo, "pg.city", AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL))
                .thenReturn(List.of());

        assertNull(registry.getCondition(AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL, requestInfo, "pg.city"));
    }

    @Test
    void failsClosedWhenActionHasNoCondition() {
        Map<String, Object> action = Map.of("id", 2008, "url", AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL);
        RequestInfo requestInfo = requestInfo("CITIZEN");
        when(mdmsUtils.fetchAccessControlActions(requestInfo, "pg.city", AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL))
                .thenReturn(List.of(action));

        assertNull(registry.getCondition(AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL, requestInfo, "pg.city"));
    }

    @Test
    void cachesASuccessfulResolutionAndDoesNotRefetchWithinTtl() {
        Map<String, Object> condition = Map.of("==", List.of(1, 1));
        Map<String, Object> action = Map.of("id", 2008, "url", AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL, "condition", condition);
        RequestInfo requestInfo = requestInfo("CITIZEN");
        when(mdmsUtils.fetchAccessControlActions(eq(requestInfo), eq("pg.city"), eq(AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL)))
                .thenReturn(List.of(action));

        registry.getCondition(AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL, requestInfo, "pg.city");
        registry.getCondition(AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL, requestInfo, "pg.city");

        verify(mdmsUtils, times(1)).fetchAccessControlActions(any(), eq("pg.city"), eq(AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL));
    }

    @Test
    void doesNotCacheAMissSoADifferentlyRoledCallerGetsAFreshAttempt() {
        RequestInfo citizenRequestInfo = requestInfo("CITIZEN");
        RequestInfo employeeRequestInfo = requestInfo("EMPLOYEE");
        when(mdmsUtils.fetchAccessControlActions(citizenRequestInfo, "pg.city", AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL))
                .thenReturn(List.of());
        when(mdmsUtils.fetchAccessControlActions(employeeRequestInfo, "pg.city", AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL))
                .thenReturn(List.of(Map.of("id", 2008, "url", AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL,
                        "condition", Map.of("==", List.of(1, 1)))));

        assertNull(registry.getCondition(AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL, citizenRequestInfo, "pg.city"));
        assertNotNull(registry.getCondition(AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL, employeeRequestInfo, "pg.city"));

        verify(mdmsUtils, times(1)).fetchAccessControlActions(citizenRequestInfo, "pg.city", AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL);
        verify(mdmsUtils, times(1)).fetchAccessControlActions(employeeRequestInfo, "pg.city", AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL);
    }

    @Test
    void cachesDifferentTenantsSeparately() {
        RequestInfo requestInfo = requestInfo("EMPLOYEE");
        Map<String, Object> action = Map.of("id", 2008, "url", AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL,
                "condition", Map.of("==", List.of(1, 1)));
        when(mdmsUtils.fetchAccessControlActions(requestInfo, "pg.city", AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL))
                .thenReturn(List.of(action));
        when(mdmsUtils.fetchAccessControlActions(requestInfo, "ke.nairobi", AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL))
                .thenReturn(List.of());

        assertNotNull(registry.getCondition(AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL, requestInfo, "pg.city"));
        assertNull(registry.getCondition(AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL, requestInfo, "ke.nairobi"));
    }

    @Test
    void extractsFieldVisibilityRuleFromTheStructuredResourceObject() {
        Map<String, Object> rule = Map.of(
                "condition", Map.of("==", List.of(1, 1)),
                "onDeny", Map.of("strategy", "MASK_SHOW_LAST_N", "n", 2));
        Map<String, Object> resource = Map.of("complaint", Map.of("attributes", Map.of("citizen.mobileNumber", rule)));
        Map<String, Object> action = Map.of("id", 2008, "url", AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL, "resource", resource);
        RequestInfo requestInfo = requestInfo("CITIZEN");
        when(mdmsUtils.fetchAccessControlActions(requestInfo, "pg.city", AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL))
                .thenReturn(List.of(action));

        Map<String, FieldVisibilityRule> rules = registry.getFieldVisibilityRules(
                AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL, requestInfo, "pg.city", "complaint");

        assertEquals(1, rules.size());
        FieldVisibilityRule mobileRule = rules.get("citizen.mobileNumber");
        assertNotNull(mobileRule);
        assertTrue(mobileRule.getConditionJson().contains("=="));
        assertEquals("MASK_SHOW_LAST_N", mobileRule.getOnDeny().get("strategy"));
    }

    @Test
    void legacyFlatStringArrayResourceShapeYieldsNoFieldVisibilityRules() {
        Map<String, Object> action = Map.of("id", 2008, "url", AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL,
                "resource", List.of("complaint"));
        RequestInfo requestInfo = requestInfo("CITIZEN");
        when(mdmsUtils.fetchAccessControlActions(requestInfo, "pg.city", AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL))
                .thenReturn(List.of(action));

        Map<String, FieldVisibilityRule> rules = registry.getFieldVisibilityRules(
                AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL, requestInfo, "pg.city", "complaint");

        assertTrue(rules.isEmpty());
    }

    @Test
    void missingConditionOnAnAttributeRuleFailsClosedToAlwaysMask() {
        Map<String, Object> ruleWithNoCondition = Map.of("onDeny", Map.of("strategy", "REDACT"));
        Map<String, Object> resource = Map.of("complaint", Map.of("attributes", Map.of("citizen.mobileNumber", ruleWithNoCondition)));
        Map<String, Object> action = Map.of("id", 2008, "url", AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL, "resource", resource);
        RequestInfo requestInfo = requestInfo("CITIZEN");
        when(mdmsUtils.fetchAccessControlActions(requestInfo, "pg.city", AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL))
                .thenReturn(List.of(action));

        Map<String, FieldVisibilityRule> rules = registry.getFieldVisibilityRules(
                AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL, requestInfo, "pg.city", "complaint");

        FieldVisibilityRule rule = rules.get("citizen.mobileNumber");
        assertNotNull(rule);
        assertEquals("false", rule.getConditionJson());
    }

    @Test
    void invalidOnDenyDefaultsToRedact() {
        Map<String, Object> ruleWithBadOnDeny = Map.of("condition", Map.of("==", List.of(1, 1)), "onDeny", "not-an-object");
        Map<String, Object> resource = Map.of("complaint", Map.of("attributes", Map.of("citizen.mobileNumber", ruleWithBadOnDeny)));
        Map<String, Object> action = Map.of("id", 2008, "url", AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL, "resource", resource);
        RequestInfo requestInfo = requestInfo("CITIZEN");
        when(mdmsUtils.fetchAccessControlActions(requestInfo, "pg.city", AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL))
                .thenReturn(List.of(action));

        Map<String, FieldVisibilityRule> rules = registry.getFieldVisibilityRules(
                AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL, requestInfo, "pg.city", "complaint");

        assertEquals("REDACT", rules.get("citizen.mobileNumber").getOnDeny().get("strategy"));
    }

    @Test
    void unknownResourceTypeYieldsNoRules() {
        Map<String, Object> resource = Map.of("complaint", Map.of("attributes", Map.of("citizen.mobileNumber",
                Map.of("condition", Map.of("==", List.of(1, 1))))));
        Map<String, Object> action = Map.of("id", 2008, "url", AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL, "resource", resource);
        RequestInfo requestInfo = requestInfo("CITIZEN");
        when(mdmsUtils.fetchAccessControlActions(requestInfo, "pg.city", AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL))
                .thenReturn(List.of(action));

        Map<String, FieldVisibilityRule> rules = registry.getFieldVisibilityRules(
                AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL, requestInfo, "pg.city", "employee");

        assertTrue(rules.isEmpty());
    }

    private RequestInfo requestInfo(String roleCode) {
        User user = new User();
        user.setType(roleCode);
        user.setRoles(List.of(Role.builder().code(roleCode).build()));
        RequestInfo requestInfo = new RequestInfo();
        requestInfo.setUserInfo(user);
        return requestInfo;
    }
}
