package org.egov.pgr.policy;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ScopePolicyTest {

    @Test
    void parsesAWellFormedScopeBlock() {
        Map<String, Object> raw = Map.of(
                "axes", List.of("department", "jurisdiction"),
                "roleScopes", Map.of(
                        "PGR_LME", Map.of("department", "OWN", "jurisdiction", "OWN"),
                        "SUPERVISOR", Map.of("department", "ALL", "jurisdiction", "OWN")
                ),
                "default", Map.of("department", "OWN", "jurisdiction", "OWN")
        );

        Optional<ScopePolicy> policy = ScopePolicy.parse(raw);

        assertTrue(policy.isPresent());
        assertEquals(ScopeLevel.OWN, policy.get().levelFor("PGR_LME", "department"));
        assertEquals(ScopeLevel.ALL, policy.get().levelFor("SUPERVISOR", "department"));
        assertEquals(ScopeLevel.OWN, policy.get().levelFor("SUPERVISOR", "jurisdiction"));
    }

    @Test
    void nullMeansGenuinelyNotConfiguredAndReturnsEmpty() {
        // Only a genuinely absent `scope` key (raw == null) reads as "not configured" — everything
        // else that fails to parse is a present-but-broken policy, see the tests below.
        assertTrue(ScopePolicy.parse(null).isEmpty());
    }

    @Test
    void notAMapIsMalformedNotAbsent() {
        assertThrows(MalformedScopePolicyException.class, () -> ScopePolicy.parse("not-a-map"));
    }

    @Test
    void unsupportedAxisIsMalformedNotAbsent() {
        // An axis outside SUPPORTED_AXES ('department'/'jurisdiction') must be rejected at parse
        // time: Tier 1 (PgrSearchScope) has no field for anything else and would silently drop it,
        // while Tier 2 either fails closed or drops it too — two tiers quietly disagreeing about a
        // restriction that's actually enforced nowhere (#1441 review).
        assertThrows(MalformedScopePolicyException.class,
                () -> ScopePolicy.parse(Map.of("axes", List.of("department", "unsupported-axis"))));
    }

    @Test
    void missingOrEmptyAxesIsMalformedNotAbsent() {
        // The scope key IS present here (just missing/empty 'axes') — an authoring mistake, not a
        // confirmed absence of configuration, so this must NOT collapse into the same "not
        // configured" bucket null gets (#1441 review).
        assertThrows(MalformedScopePolicyException.class, () -> ScopePolicy.parse(Map.of("roleScopes", Map.of())));
        assertThrows(MalformedScopePolicyException.class, () -> ScopePolicy.parse(Map.of("axes", List.of())));
    }

    @Test
    void unrecognizedLevelFallsBackToDefaultThenOwn_neverSilentlyNone() {
        Map<String, Object> raw = Map.of(
                "axes", List.of("department"),
                "roleScopes", Map.of("PGR_LME", Map.of("department", "NOT_A_REAL_LEVEL")),
                "default", Map.of("department", "OWN")
        );

        ScopePolicy policy = ScopePolicy.parse(raw).orElseThrow();

        // malformed role entry falls back to 'default', not silently to ALL
        assertEquals(ScopeLevel.OWN, policy.levelFor("PGR_LME", "department"));
    }

    @Test
    void unrecognizedLevelWithNoDefaultFallsBackToOwn() {
        Map<String, Object> raw = Map.of(
                "axes", List.of("department"),
                "roleScopes", Map.of("PGR_LME", Map.of("department", "NOT_A_REAL_LEVEL"))
        );

        ScopePolicy policy = ScopePolicy.parse(raw).orElseThrow();

        assertEquals(ScopeLevel.OWN, policy.levelFor("PGR_LME", "department"));
    }

    @Test
    void axisNotDeclaredInAxesListIsIgnoredInRoleScopes() {
        Map<String, Object> raw = Map.of(
                "axes", List.of("department"),
                "roleScopes", Map.of("PGR_LME", Map.of("department", "ALL", "someUndeclaredAxis", "OWN"))
        );

        ScopePolicy policy = ScopePolicy.parse(raw).orElseThrow();

        assertEquals(ScopeLevel.ALL, policy.levelFor("PGR_LME", "department"));
        // undeclared axis was never recorded, so a lookup for it falls through to OWN (no default set)
        assertEquals(ScopeLevel.OWN, policy.levelFor("PGR_LME", "someUndeclaredAxis"));
    }

    @Test
    void roleNotInRoleScopesFallsBackToDefault() {
        Map<String, Object> raw = Map.of(
                "axes", List.of("department"),
                "roleScopes", Map.of("PGR_LME", Map.of("department", "OWN")),
                "default", Map.of("department", "ALL")
        );

        ScopePolicy policy = ScopePolicy.parse(raw).orElseThrow();

        assertEquals(ScopeLevel.ALL, policy.levelFor("CSR", "department"));
    }
}
