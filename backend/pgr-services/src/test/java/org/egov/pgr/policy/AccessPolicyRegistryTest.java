package org.egov.pgr.policy;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.egov.common.contract.request.RequestInfo;
import org.egov.common.contract.request.Role;
import org.egov.common.contract.request.User;
import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.util.MDMSUtils;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Verifies AccessPolicyRegistry resolves the condition via egov-accesscontrol's role-scoped
 * /access/v1/actions/mdms/_get API (through MDMSUtils.fetchAccessControlActions): allows
 * (backward compatible) when no action is visible at all for the caller's roles — a confirmed
 * absence of policy configuration — but still fails closed when an action IS visible with a
 * malformed/missing condition, or when the accesscontrol call itself fails. Caches successful
 * resolutions, and does NOT cache a "not found" (since that API is role-scoped — a miss for one
 * caller's roles must not lock out a differently-roled caller for the TTL).
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class AccessPolicyRegistryTest {

    @Mock
    private MDMSUtils mdmsUtils;

    private AccessPolicyRegistry registry;

    @BeforeEach
    void setup() {
        // abacStrictMode defaults to false (PGRConfiguration's no-arg constructor) — the
        // backward-compatible "missing action -> allow" path these existing tests assert on.
        registry = new AccessPolicyRegistry(mdmsUtils, new ObjectMapper(), new PGRConfiguration());
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
    void allowsBackwardCompatiblyWhenNoActionVisibleForCallersRoles() {
        // A confirmed-empty result (not an accesscontrol failure) means this tenant/role never had
        // this policy configured — backward compatible with pre-ABAC behavior: allow, don't deny.
        RequestInfo requestInfo = requestInfo("CITIZEN");
        when(mdmsUtils.fetchAccessControlActions(requestInfo, "pg.city", AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL))
                .thenReturn(List.of());

        assertEquals("true", registry.getCondition(AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL, requestInfo, "pg.city"));
    }

    @Test
    void failsClosedWhenNoActionVisibleAndStrictModeIsEnabled() {
        // The explicit opt-in rollout gate (#1441 review): once pgr.abac.strict-mode=true, a
        // missing/invisible action must fail closed instead of taking the backward-compatible
        // "allow" default — a separate registry instance since the flag is read at construction.
        PGRConfiguration strictConfig = new PGRConfiguration();
        strictConfig.setAbacStrictMode(true);
        AccessPolicyRegistry strictRegistry = new AccessPolicyRegistry(mdmsUtils, new ObjectMapper(), strictConfig);
        RequestInfo requestInfo = requestInfo("CITIZEN");
        when(mdmsUtils.fetchAccessControlActions(requestInfo, "pg.city", AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL))
                .thenReturn(List.of());

        assertNull(strictRegistry.getCondition(AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL, requestInfo, "pg.city"));
    }

    @Test
    void failsClosedWhenAccessControlCallFails() {
        // Distinct from the above: the call itself FAILED (accesscontrol down/erroring), which must
        // NOT be treated as "not defined" — that would fail a whole tenant open during an outage.
        RequestInfo requestInfo = requestInfo("CITIZEN");
        when(mdmsUtils.fetchAccessControlActions(requestInfo, "pg.city", AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL))
                .thenThrow(new AccessControlUnavailableException("boom", new RuntimeException("boom")));

        assertNull(registry.getCondition(AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL, requestInfo, "pg.city"));
    }

    @Test
    void allowsBackwardCompatiblyWhenActionHasNeitherConditionNorResource() {
        // A genuinely bare action record (basic registration/visibility only, e.g. what plenty of
        // real ACCESSCONTROL-ACTIONS-TEST rows look like) — must behave identically to no entry
        // being visible at all, not fail closed, so tenants relying on this stay working as-is.
        Map<String, Object> action = Map.of("id", 2008, "url", AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL);
        RequestInfo requestInfo = requestInfo("CITIZEN");
        when(mdmsUtils.fetchAccessControlActions(requestInfo, "pg.city", AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL))
                .thenReturn(List.of(action));

        assertEquals("true", registry.getCondition(AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL, requestInfo, "pg.city"));
    }

    @Test
    void failsClosedWhenActionHasNeitherConditionNorResourceAndStrictModeIsEnabled() {
        Map<String, Object> action = Map.of("id", 2008, "url", AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL);
        RequestInfo requestInfo = requestInfo("CITIZEN");
        PGRConfiguration strictConfig = new PGRConfiguration();
        strictConfig.setAbacStrictMode(true);
        AccessPolicyRegistry strictRegistry = new AccessPolicyRegistry(mdmsUtils, new ObjectMapper(), strictConfig);
        when(mdmsUtils.fetchAccessControlActions(requestInfo, "pg.city", AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL))
                .thenReturn(List.of(action));

        assertNull(strictRegistry.getCondition(AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL, requestInfo, "pg.city"));
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

        assertEquals("true", registry.getCondition(AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL, citizenRequestInfo, "pg.city"));
        assertNotNull(registry.getCondition(AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL, employeeRequestInfo, "pg.city"));

        verify(mdmsUtils, times(1)).fetchAccessControlActions(citizenRequestInfo, "pg.city", AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL);
        verify(mdmsUtils, times(1)).fetchAccessControlActions(employeeRequestInfo, "pg.city", AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL);
    }

    @Test
    void cachesSuccessfulResolutionsPerRoleSetNotJustPerTenantAndUrl() {
        // The API is role-scoped: two callers with different roles hitting the same tenant+url must
        // never share a cached SUCCESSFUL entry either — each role set gets its own condition.
        RequestInfo supervisorRequestInfo = requestInfo("SUPERVISOR");
        RequestInfo lmeRequestInfo = requestInfo("PGR_LME");
        when(mdmsUtils.fetchAccessControlActions(supervisorRequestInfo, "pg.city", AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL))
                .thenReturn(List.of(Map.of("id", 2008, "url", AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL,
                        "condition", Map.of("==", List.of(1, 1)))));
        when(mdmsUtils.fetchAccessControlActions(lmeRequestInfo, "pg.city", AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL))
                .thenReturn(List.of(Map.of("id", 2008, "url", AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL,
                        "condition", Map.of("==", List.of(2, 2)))));

        String supervisorCondition = registry.getCondition(AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL, supervisorRequestInfo, "pg.city");
        String lmeCondition = registry.getCondition(AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL, lmeRequestInfo, "pg.city");
        // repeat both — each should be served from its OWN cache entry, not the other's
        assertEquals(supervisorCondition, registry.getCondition(AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL, supervisorRequestInfo, "pg.city"));
        assertEquals(lmeCondition, registry.getCondition(AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL, lmeRequestInfo, "pg.city"));

        assertEquals("{\"==\":[1,1]}", supervisorCondition);
        assertEquals("{\"==\":[2,2]}", lmeCondition);
        verify(mdmsUtils, times(1)).fetchAccessControlActions(supervisorRequestInfo, "pg.city", AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL);
        verify(mdmsUtils, times(1)).fetchAccessControlActions(lmeRequestInfo, "pg.city", AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL);
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
        assertEquals("true", registry.getCondition(AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL, requestInfo, "ke.nairobi"));
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
    void getFieldVisibilityRulesFailsClosedWhenAccessControlCallFails() {
        // Distinct from "no rules configured" (an empty map, which FieldVisibilityService reads as
        // a no-op and leaves every field untouched, including citizen PII): an accesscontrol outage
        // must NOT collapse to that same empty-map sentinel, since some callers (plain search) apply
        // field masking with no record-level Tier-2 gate at all (#1441 review).
        RequestInfo requestInfo = requestInfo("CITIZEN");
        when(mdmsUtils.fetchAccessControlActions(requestInfo, "pg.city", AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL))
                .thenThrow(new AccessControlUnavailableException("boom", new RuntimeException("boom")));

        assertThrows(AccessControlUnavailableException.class, () -> registry.getFieldVisibilityRules(
                AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL, requestInfo, "pg.city", "complaint"));
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

    // --- resource.complaint.scope: getScopePolicy() + generated condition -----------------------

    @Test
    void getScopePolicyParsesTheScopeBlockFromResource() {
        Map<String, Object> scope = Map.of(
                "axes", List.of("department", "jurisdiction"),
                "default", Map.of("department", "ALL", "jurisdiction", "OWN"));
        Map<String, Object> resource = Map.of("complaint", Map.of("scope", scope));
        Map<String, Object> action = Map.of("id", 2008, "url", AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL, "resource", resource);
        RequestInfo requestInfo = requestInfo("EMPLOYEE");
        when(mdmsUtils.fetchAccessControlActions(requestInfo, "pg.city", AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL))
                .thenReturn(List.of(action));

        Optional<ScopePolicy> policy = registry.getScopePolicy(AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL, requestInfo, "pg.city", "complaint");

        assertTrue(policy.isPresent());
        assertEquals(ScopeLevel.ALL, policy.get().levelFor("ANY_ROLE", "department"));
        assertEquals(ScopeLevel.OWN, policy.get().levelFor("ANY_ROLE", "jurisdiction"));
    }

    @Test
    void getScopePolicyIsEmptyWhenNoScopeBlockPresent() {
        Map<String, Object> action = Map.of("id", 2008, "url", AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL,
                "condition", Map.of("==", List.of(1, 1)));
        RequestInfo requestInfo = requestInfo("EMPLOYEE");
        when(mdmsUtils.fetchAccessControlActions(requestInfo, "pg.city", AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL))
                .thenReturn(List.of(action));

        assertTrue(registry.getScopePolicy(AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL, requestInfo, "pg.city", "complaint").isEmpty());
    }

    @Test
    void getScopePolicyFailsClosedWhenAccessControlCallFails() {
        // Distinct from "no scope block configured" (an empty Optional, which
        // SearchAccessPolicyService reads as safe to fall back to its own default policy): an
        // accesscontrol outage must NOT collapse to that same empty-Optional sentinel, since the
        // fallback default is comparatively permissive (CodeRabbit #3775816481).
        RequestInfo requestInfo = requestInfo("EMPLOYEE");
        when(mdmsUtils.fetchAccessControlActions(requestInfo, "pg.city", AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL))
                .thenThrow(new AccessControlUnavailableException("boom", new RuntimeException("boom")));

        assertThrows(AccessControlUnavailableException.class, () -> registry.getScopePolicy(
                AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL, requestInfo, "pg.city", "complaint"));
    }

    // --- isPolicyUnconfigured(): Tier-1's signal for "genuinely never authored" -------------------

    @Test
    void isPolicyUnconfiguredIsTrueWhenNoActionIsVisibleAtAll() {
        RequestInfo requestInfo = requestInfo("EMPLOYEE");
        when(mdmsUtils.fetchAccessControlActions(requestInfo, "pg.city", AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL))
                .thenReturn(List.of());

        assertTrue(registry.isPolicyUnconfigured(AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL, requestInfo, "pg.city", "complaint"));
    }

    @Test
    void isPolicyUnconfiguredIsTrueWhenActionHasNeitherScopeNorCondition() {
        Map<String, Object> action = Map.of("id", 2008, "url", AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL, "enabled", true);
        RequestInfo requestInfo = requestInfo("EMPLOYEE");
        when(mdmsUtils.fetchAccessControlActions(requestInfo, "pg.city", AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL))
                .thenReturn(List.of(action));

        assertTrue(registry.isPolicyUnconfigured(AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL, requestInfo, "pg.city", "complaint"));
    }

    @Test
    void isPolicyUnconfiguredIsTrueWhenOnlyFieldMaskingAttributesArePresentWithNoScopeOrCondition() {
        // Field masking (resource.<type>.attributes) and row-level scoping are independent axes of
        // this policy — an action that REDACTs a PII field but declares neither scope nor condition
        // must still resolve fully unrestricted at Tier-1/row level, matching Tier-2's
        // backward-compatible allow. This is intentional (per product decision), not a gap to close.
        Map<String, Object> attributes = Map.of("citizen.mobileNumber", Map.of("condition", Map.of("==", List.of(1, 2)), "onDeny", Map.of("strategy", "REDACT")));
        Map<String, Object> resource = Map.of("complaint", Map.of("attributes", attributes));
        Map<String, Object> action = Map.of("id", 2008, "url", AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL, "resource", resource);
        RequestInfo requestInfo = requestInfo("EMPLOYEE");
        when(mdmsUtils.fetchAccessControlActions(requestInfo, "pg.city", AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL))
                .thenReturn(List.of(action));

        assertTrue(registry.isPolicyUnconfigured(AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL, requestInfo, "pg.city", "complaint"));
        assertTrue(registry.getScopePolicy(AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL, requestInfo, "pg.city", "complaint").isEmpty());
        assertFalse(registry.getFieldVisibilityRules(AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL, requestInfo, "pg.city", "complaint").isEmpty());
    }

    @Test
    void isPolicyUnconfiguredIsFalseWhenAScopeBlockIsPresent() {
        Map<String, Object> scope = Map.of("axes", List.of("department"), "default", Map.of("department", "OWN"));
        Map<String, Object> resource = Map.of("complaint", Map.of("scope", scope));
        Map<String, Object> action = Map.of("id", 2008, "url", AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL, "resource", resource);
        RequestInfo requestInfo = requestInfo("EMPLOYEE");
        when(mdmsUtils.fetchAccessControlActions(requestInfo, "pg.city", AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL))
                .thenReturn(List.of(action));

        assertFalse(registry.isPolicyUnconfigured(AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL, requestInfo, "pg.city", "complaint"));
    }

    @Test
    void isPolicyUnconfiguredIsFalseWhenALegacyConditionIsPresentWithNoScopeBlock() {
        Map<String, Object> action = Map.of("id", 2008, "url", AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL,
                "condition", Map.of("==", List.of(1, 1)));
        RequestInfo requestInfo = requestInfo("EMPLOYEE");
        when(mdmsUtils.fetchAccessControlActions(requestInfo, "pg.city", AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL))
                .thenReturn(List.of(action));

        assertFalse(registry.isPolicyUnconfigured(AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL, requestInfo, "pg.city", "complaint"));
    }

    @Test
    void isPolicyUnconfiguredThrowsOnAMalformedScopeRatherThanReturningTrue() {
        // A present-but-broken scope block is an authoring mistake, not "unconfigured" — must
        // propagate, never silently read as "apply the fully unrestricted fallback".
        Map<String, Object> scope = Map.of("axes", List.of());
        Map<String, Object> resource = Map.of("complaint", Map.of("scope", scope));
        Map<String, Object> action = Map.of("id", 2008, "url", AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL, "resource", resource);
        RequestInfo requestInfo = requestInfo("EMPLOYEE");
        when(mdmsUtils.fetchAccessControlActions(requestInfo, "pg.city", AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL))
                .thenReturn(List.of(action));

        assertThrows(MalformedScopePolicyException.class, () -> registry.isPolicyUnconfigured(
                AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL, requestInfo, "pg.city", "complaint"));
    }

    // --- resolveScopeState(): the combined getScopePolicy() + isPolicyUnconfigured() form ---------

    @Test
    void resolveScopeStateFetchesTheActionOnlyOnceWhenUnconfigured() {
        // A "not found"/not-visible action is never cached (role-scoped API — see class Javadoc),
        // so calling getScopePolicy() then isPolicyUnconfigured() separately for the SAME request
        // used to trigger two independent fetchAccessControlActions round-trips. resolveScopeState
        // must derive both facts from one fetch.
        RequestInfo requestInfo = requestInfo("EMPLOYEE");
        when(mdmsUtils.fetchAccessControlActions(requestInfo, "pg.city", AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL))
                .thenReturn(List.of());

        AccessPolicyRegistry.ScopeResolution resolution = registry.resolveScopeState(
                AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL, requestInfo, "pg.city", "complaint");

        assertTrue(resolution.unconfigured());
        assertTrue(resolution.scopePolicy().isEmpty());
        verify(mdmsUtils, times(1)).fetchAccessControlActions(requestInfo, "pg.city", AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL);
    }

    @Test
    void resolveScopeStateFetchesTheActionOnlyOnceWhenAScopeBlockIsPresent() {
        Map<String, Object> scope = Map.of("axes", List.of("department"), "default", Map.of("department", "OWN"));
        Map<String, Object> resource = Map.of("complaint", Map.of("scope", scope));
        Map<String, Object> action = Map.of("id", 2008, "url", AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL, "resource", resource);
        RequestInfo requestInfo = requestInfo("EMPLOYEE");
        when(mdmsUtils.fetchAccessControlActions(requestInfo, "pg.city", AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL))
                .thenReturn(List.of(action));

        AccessPolicyRegistry.ScopeResolution resolution = registry.resolveScopeState(
                AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL, requestInfo, "pg.city", "complaint");

        assertFalse(resolution.unconfigured());
        assertTrue(resolution.scopePolicy().isPresent());
        // Cached now (a successful resolution) — a second call must not fetch again either.
        registry.resolveScopeState(AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL, requestInfo, "pg.city", "complaint");
        verify(mdmsUtils, times(1)).fetchAccessControlActions(requestInfo, "pg.city", AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL);
    }

    @Test
    void getConditionGeneratesFromScopeWhenPresentIgnoringHandAuthoredCondition() {
        Map<String, Object> scope = Map.of(
                "axes", List.of("department", "jurisdiction"),
                "default", Map.of("department", "OWN", "jurisdiction", "OWN"));
        Map<String, Object> resource = Map.of("complaint", Map.of("scope", scope));
        // A hand-authored condition is ALSO present — must be ignored once scope is present, per
        // the "one authored artifact" design (no possibility of the two disagreeing).
        Map<String, Object> action = new LinkedHashMap<>();
        action.put("id", 2008);
        action.put("url", AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL);
        action.put("resource", resource);
        action.put("condition", Map.of("==", List.of(1, 2))); // would always be false if read
        RequestInfo requestInfo = requestInfo("EMPLOYEE");
        when(mdmsUtils.fetchAccessControlActions(requestInfo, "pg.city", AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL))
                .thenReturn(List.of(action));

        String generated = registry.getCondition(AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL, requestInfo, "pg.city");

        assertNotNull(generated);
        assertFalse(generated.contains("\"==\":[1,2]"), "must not fall back to the hand-authored condition once scope is present");
        assertTrue(generated.contains("user.attributes.departments"));
        assertTrue(generated.contains("user.attributes.jurisdictions"));
        assertTrue(generated.contains("resource.complaint.boundary"), "jurisdiction axis maps to the resource's 'boundary' field");

        // behavioral check, not just string shape: an EMPLOYEE whose department/jurisdiction match
        // the resource should be allowed by the generated condition.
        PolicyEvaluator evaluator = new PolicyEvaluator();
        Map<String, Object> data = Map.of(
                "user", Map.of("type", "EMPLOYEE", "attributes", Map.of(
                        "tenantWide", false,
                        "departments", List.of("DEPT_1"),
                        "jurisdictions", List.of("WARD_001"))),
                "resource", Map.of("complaint", Map.of("department", "DEPT_1", "boundary", "WARD_001")));
        assertTrue(evaluator.isAllowed(generated, data));

        Map<String, Object> wrongBoundaryData = Map.of(
                "user", Map.of("type", "EMPLOYEE", "attributes", Map.of(
                        "tenantWide", false,
                        "departments", List.of("DEPT_1"),
                        "jurisdictions", List.of("WARD_001"))),
                "resource", Map.of("complaint", Map.of("department", "DEPT_1", "boundary", "WARD_999")));
        assertFalse(evaluator.isAllowed(generated, wrongBoundaryData));
    }

    @Test
    void getConditionFailsClosedOnAnUnsupportedAxisRatherThanSilentlyDroppingIt() {
        // An axis outside ScopePolicy.SUPPORTED_AXES must fail the WHOLE generated condition
        // (null, not a condition missing just that axis's restriction) — otherwise Tier-1 (SQL) and
        // Tier-2 (this generated condition) could silently disagree on what that axis restricts
        // (#1441 review). Caught here by ScopePolicy.parse's own SUPPORTED_AXES rejection (see
        // ScopePolicyTest#unsupportedAxisIsMalformedNotAbsent); AXIS_FIELDS' null-mapping check in
        // synthesizeCondition is now unreachable via this path and is pure defense-in-depth.
        Map<String, Object> scope = Map.of(
                "axes", List.of("department", "unsupported-axis"),
                "default", Map.of("department", "OWN", "unsupported-axis", "OWN"));
        Map<String, Object> resource = Map.of("complaint", Map.of("scope", scope));
        Map<String, Object> action = Map.of("id", 2008, "url", AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL, "resource", resource);
        RequestInfo requestInfo = requestInfo("EMPLOYEE");
        when(mdmsUtils.fetchAccessControlActions(requestInfo, "pg.city", AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL))
                .thenReturn(List.of(action));

        assertNull(registry.getCondition(AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL, requestInfo, "pg.city"));
    }

    @Test
    void getConditionFailsClosedOnAMalformedScopeRatherThanFallingBackToHandAuthoredCondition() {
        // A present-but-malformed scope block (axes empty) must NOT be treated the same as "no
        // scope configured" — it must fail closed, never silently fall through to a legacy
        // hand-authored condition (which could be stale/wrong for this authored-but-broken policy).
        Map<String, Object> scope = Map.of("axes", List.of());
        Map<String, Object> resource = Map.of("complaint", Map.of("scope", scope));
        Map<String, Object> action = new LinkedHashMap<>();
        action.put("id", 2008);
        action.put("url", AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL);
        action.put("resource", resource);
        action.put("condition", Map.of("==", List.of(1, 1))); // must be ignored — see above
        RequestInfo requestInfo = requestInfo("EMPLOYEE");
        when(mdmsUtils.fetchAccessControlActions(requestInfo, "pg.city", AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL))
                .thenReturn(List.of(action));

        assertNull(registry.getCondition(AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL, requestInfo, "pg.city"));
    }

    @Test
    void getScopePolicyThrowsOnAMalformedScopeRatherThanReturningEmpty() {
        // Distinct from getScopePolicyIsEmptyWhenNoScopeBlockPresent: the scope KEY is present here
        // but malformed — SearchAccessPolicyService must be able to tell this apart from "not
        // configured" (an empty Optional it treats as safe to apply its own default policy to).
        Map<String, Object> scope = Map.of("axes", List.of());
        Map<String, Object> resource = Map.of("complaint", Map.of("scope", scope));
        Map<String, Object> action = Map.of("id", 2008, "url", AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL, "resource", resource);
        RequestInfo requestInfo = requestInfo("EMPLOYEE");
        when(mdmsUtils.fetchAccessControlActions(requestInfo, "pg.city", AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL))
                .thenReturn(List.of(action));

        assertThrows(MalformedScopePolicyException.class, () -> registry.getScopePolicy(
                AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL, requestInfo, "pg.city", "complaint"));
    }

    @Test
    void getConditionFallsBackToHandAuthoredWhenNoScopeBlock() {
        // Unaffected legacy path — same assertion as resolvesConditionFromTheAccessControlAction,
        // stated explicitly here to pin the "no scope -> read condition verbatim" precedence rule.
        Map<String, Object> condition = Map.of("==", List.of(1, 1));
        Map<String, Object> action = Map.of("id", 2008, "url", AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL, "condition", condition);
        RequestInfo requestInfo = requestInfo("CITIZEN");
        when(mdmsUtils.fetchAccessControlActions(requestInfo, "pg.city", AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL))
                .thenReturn(List.of(action));

        String result = registry.getCondition(AccessPolicyRegistry.PGR_REQUEST_SEARCH_URL, requestInfo, "pg.city");

        assertEquals("{\"==\":[1,1]}", result);
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
