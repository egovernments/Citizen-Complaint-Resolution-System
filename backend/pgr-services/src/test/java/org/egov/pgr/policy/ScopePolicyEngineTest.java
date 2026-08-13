package org.egov.pgr.policy;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ScopePolicyEngineTest {

    private static final Map<String, Set<String>> HRMS_VALUES = Map.of(
            "department", Set.of("DEPT_1"),
            "jurisdiction", Set.of("WARD_001"));

    @Test
    void singleAxisPolicyRestrictsOnlyThatAxis() {
        ScopePolicy policy = ScopePolicy.of(List.of("jurisdiction"), Map.of("jurisdiction", ScopeLevel.OWN));

        Map<String, List<String>> resolved = ScopePolicyEngine.resolve(policy, Set.of("PGR_LME"), HRMS_VALUES);

        assertEquals(Map.of("jurisdiction", List.of("WARD_001")), resolved);
    }

    @Test
    void multiAxisOwnRestrictsBothAxesIndependently() {
        ScopePolicy policy = ScopePolicy.of(List.of("department", "jurisdiction"),
                Map.of("department", ScopeLevel.OWN, "jurisdiction", ScopeLevel.OWN));

        Map<String, List<String>> resolved = ScopePolicyEngine.resolve(policy, Set.of("PGR_LME"), HRMS_VALUES);

        assertEquals(Set.of("department", "jurisdiction"), resolved.keySet());
        assertEquals(List.of("DEPT_1"), resolved.get("department"));
        assertEquals(List.of("WARD_001"), resolved.get("jurisdiction"));
    }

    @Test
    void noneLevelAxisIsOmittedFromResult() {
        ScopePolicy policy = ScopePolicy.of(List.of("department", "jurisdiction"),
                Map.of("department", ScopeLevel.ALL, "jurisdiction", ScopeLevel.OWN));

        Map<String, List<String>> resolved = ScopePolicyEngine.resolve(policy, Set.of("SUPERVISOR"), HRMS_VALUES);

        assertFalse(resolved.containsKey("department"));
        assertEquals(List.of("WARD_001"), resolved.get("jurisdiction"));
    }

    @Test
    void ownAxisWithNoHrmsValuesGetsTheDenySentinelNotAnEmptyList() {
        ScopePolicy policy = ScopePolicy.of(List.of("department"), Map.of("department", ScopeLevel.OWN));
        Map<String, Set<String>> noDepartmentData = Map.of("department", Set.of());

        Map<String, List<String>> resolved = ScopePolicyEngine.resolve(policy, Set.of("PGR_LME"), noDepartmentData);

        // NOT an empty list — CollectionUtils.isEmpty() treats null and [] identically as "no
        // restriction", so an unresolved OWN axis must carry a non-empty sentinel to actually deny.
        assertEquals(List.of(ScopePolicyEngine.UNRESOLVED_SENTINEL), resolved.get("department"));
    }

    @Test
    void multiRoleUnionMostPermissiveWins() {
        // PGR_LME says OWN for department, SUPERVISOR says ALL — holding SUPERVISOR too should
        // widen access (ALL wins), matching how egov-accesscontrol already unions roleactions
        // across a caller's roles.
        Map<String, Map<String, ScopeLevel>> roleScopes = Map.of(
                "PGR_LME", Map.of("department", ScopeLevel.OWN),
                "SUPERVISOR", Map.of("department", ScopeLevel.ALL));
        ScopePolicy multiRolePolicy = policyWithRoleScopes(List.of("department"), roleScopes, Map.of("department", ScopeLevel.OWN));

        Map<String, List<String>> resolved = ScopePolicyEngine.resolve(multiRolePolicy, Set.of("PGR_LME", "SUPERVISOR"), HRMS_VALUES);

        assertFalse(resolved.containsKey("department"), "holding SUPERVISOR too should widen access, not narrow it");
    }

    @Test
    void genericEmployeeMarkerRoleDoesNotNeutralizeAFunctionalRolesExplicitRestriction() {
        // Regression: every real caller ALSO holds the generic EMPLOYEE marker role HRMS stamps on
        // every employee, alongside their functional role (SUPERVISOR here). EMPLOYEE has no
        // explicit entry, so it must be skipped entirely — NOT fall back to the policy default and
        // get unioned in, which would let a permissive default silently neutralize any functional
        // role's explicit, more restrictive OWN setting (caught via a live deploy where this exact
        // scenario made a "department=OWN" role fully unrestricted instead).
        ScopePolicy policy = policyWithRoleScopes(
                List.of("department", "jurisdiction"),
                Map.of("SUPERVISOR", Map.of("department", ScopeLevel.OWN, "jurisdiction", ScopeLevel.ALL)),
                Map.of("department", ScopeLevel.ALL, "jurisdiction", ScopeLevel.OWN));

        Map<String, List<String>> resolved = ScopePolicyEngine.resolve(policy, Set.of("EMPLOYEE", "SUPERVISOR"), HRMS_VALUES);

        assertTrue(resolved.containsKey("department"), "SUPERVISOR's explicit OWN must hold despite EMPLOYEE's implicit default(ALL)");
        assertEquals(List.of("DEPT_1"), resolved.get("department"));
        assertFalse(resolved.containsKey("jurisdiction"), "SUPERVISOR's explicit ALL should still win for jurisdiction");
    }

    @Test
    void roleNotListedFallsBackToDefault() {
        ScopePolicy policy = policyWithRoleScopes(List.of("department"),
                Map.of("PGR_LME", Map.of("department", ScopeLevel.OWN)),
                Map.of("department", ScopeLevel.ALL));

        // CSR isn't in roleScopes at all — falls back to the policy default (ALL).
        Map<String, List<String>> resolved = ScopePolicyEngine.resolve(policy, Set.of("CSR"), HRMS_VALUES);

        assertFalse(resolved.containsKey("department"));
    }

    @Test
    void noRolesAtAllIsConservativeOwnNotUnrestricted() {
        ScopePolicy policy = ScopePolicy.of(List.of("department"), Map.of("department", ScopeLevel.ALL));

        Map<String, List<String>> resolved = ScopePolicyEngine.resolve(policy, Set.of(), HRMS_VALUES);

        assertTrue(resolved.containsKey("department"), "an unidentifiable caller must never be treated as unrestricted");
    }

    /** Builds a policy with explicit per-role overrides — {@link ScopePolicy#of} only sets defaults. */
    private ScopePolicy policyWithRoleScopes(List<String> axes, Map<String, Map<String, ScopeLevel>> roleScopes,
                                              Map<String, ScopeLevel> defaultScope) {
        Map<String, Object> raw = new java.util.HashMap<>();
        raw.put("axes", axes);
        Map<String, Object> roleScopesRaw = new java.util.HashMap<>();
        roleScopes.forEach((role, levels) -> {
            Map<String, Object> levelsRaw = new java.util.HashMap<>();
            levels.forEach((axis, level) -> levelsRaw.put(axis, level.name()));
            roleScopesRaw.put(role, levelsRaw);
        });
        raw.put("roleScopes", roleScopesRaw);
        Map<String, Object> defaultRaw = new java.util.HashMap<>();
        defaultScope.forEach((axis, level) -> defaultRaw.put(axis, level.name()));
        raw.put("default", defaultRaw);
        return ScopePolicy.parse(raw).orElseThrow();
    }
}
