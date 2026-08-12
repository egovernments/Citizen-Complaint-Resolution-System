package org.egov.pgr.policy;

import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ScopePolicyTest {

    @Test
    void parsesAWellFormedScopeBlock() {
        Map<String, Object> raw = Map.of(
                "axes", List.of("department", "jurisdiction"),
                "roleScopes", Map.of(
                        "PGR_LME", Map.of("department", "OWN", "jurisdiction", "OWN"),
                        "SUPERVISOR", Map.of("department", "NONE", "jurisdiction", "OWN")
                ),
                "default", Map.of("department", "OWN", "jurisdiction", "OWN")
        );

        Optional<ScopePolicy> policy = ScopePolicy.parse(raw);

        assertTrue(policy.isPresent());
        assertEquals(ScopeLevel.OWN, policy.get().levelFor("PGR_LME", "department"));
        assertEquals(ScopeLevel.NONE, policy.get().levelFor("SUPERVISOR", "department"));
        assertEquals(ScopeLevel.OWN, policy.get().levelFor("SUPERVISOR", "jurisdiction"));
    }

    @Test
    void notAMapReturnsEmpty() {
        assertTrue(ScopePolicy.parse("not-a-map").isEmpty());
        assertTrue(ScopePolicy.parse(null).isEmpty());
    }

    @Test
    void missingOrEmptyAxesReturnsEmpty() {
        assertTrue(ScopePolicy.parse(Map.of("roleScopes", Map.of())).isEmpty());
        assertTrue(ScopePolicy.parse(Map.of("axes", List.of())).isEmpty());
    }

    @Test
    void unrecognizedLevelFallsBackToDefaultThenOwn_neverSilentlyNone() {
        Map<String, Object> raw = Map.of(
                "axes", List.of("department"),
                "roleScopes", Map.of("PGR_LME", Map.of("department", "NOT_A_REAL_LEVEL")),
                "default", Map.of("department", "OWN")
        );

        ScopePolicy policy = ScopePolicy.parse(raw).orElseThrow();

        // malformed role entry falls back to 'default', not silently to NONE
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
                "roleScopes", Map.of("PGR_LME", Map.of("department", "NONE", "someUndeclaredAxis", "OWN"))
        );

        ScopePolicy policy = ScopePolicy.parse(raw).orElseThrow();

        assertEquals(ScopeLevel.NONE, policy.levelFor("PGR_LME", "department"));
        // undeclared axis was never recorded, so a lookup for it falls through to OWN (no default set)
        assertEquals(ScopeLevel.OWN, policy.levelFor("PGR_LME", "someUndeclaredAxis"));
    }

    @Test
    void roleNotInRoleScopesFallsBackToDefault() {
        Map<String, Object> raw = Map.of(
                "axes", List.of("department"),
                "roleScopes", Map.of("PGR_LME", Map.of("department", "OWN")),
                "default", Map.of("department", "NONE")
        );

        ScopePolicy policy = ScopePolicy.parse(raw).orElseThrow();

        assertEquals(ScopeLevel.NONE, policy.levelFor("CSR", "department"));
    }
}
