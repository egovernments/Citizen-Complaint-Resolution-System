package org.egov.pgr.policy;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * Compiles a {@link ScopePolicy} (the MDMS-authored PAP artifact) + a caller's held roles + their
 * HRMS-resolved values per axis into the generic scope-filter map {@link PolicyDrivenScopeResolver}
 * needs to build a {@link PgrSearchScope}. Pure function, no I/O — the HRMS lookup (the PIP) and
 * the MDMS fetch (reading the PAP) both happen in the caller.
 */
public final class ScopePolicyEngine {

    /** Sentinel value for an OWN-level axis the caller has NO resolvable value for — matches no
     *  real row, so the axis still denies rather than silently reading as "no restriction" (an
     *  empty list and a null list are indistinguishable to the SQL builder's isEmpty() check). */
    public static final String UNRESOLVED_SENTINEL = "__scope_denied__";

    private ScopePolicyEngine() {
    }

    /**
     * Returns a map with one entry per axis whose {@link #effectiveLevel} for this caller is
     * {@link ScopeLevel#OWN}: the caller's HRMS-resolved values for that axis, or
     * {@link #UNRESOLVED_SENTINEL} alone if HRMS resolved nothing for it. Axes whose effective
     * level is {@link ScopeLevel#ALL} are simply absent from the result (== "no restriction on
     * this axis", per {@code PgrSearchScope}'s documented null/empty contract).
     */
    public static Map<String, List<String>> resolve(ScopePolicy policy, Set<String> callerRoleCodes,
                                                      Map<String, Set<String>> hrmsResolvedValuesPerAxis) {
        Map<String, List<String>> result = new LinkedHashMap<>();
        for (String axis : policy.getAxes()) {
            if (effectiveLevel(policy, callerRoleCodes, axis) == ScopeLevel.ALL)
                continue;

            Set<String> values = hrmsResolvedValuesPerAxis == null ? null : hrmsResolvedValuesPerAxis.get(axis);
            result.put(axis, (values == null || values.isEmpty())
                    ? List.of(UNRESOLVED_SENTINEL)
                    : new ArrayList<>(values));
        }
        return result;
    }

    /**
     * Most-permissive-wins across every role the caller holds that has an EXPLICIT opinion on this
     * axis: if any of them is {@link ScopeLevel#ALL}, the axis is unrestricted for the caller
     * overall — matches how egov-accesscontrol already unions roleactions across a caller's roles
     * (holding an extra role only ever widens access). Roles with NO explicit entry (notably the
     * generic {@code EMPLOYEE}/{@code COMMON_EMPLOYEE} marker HRMS stamps on every employee
     * alongside their functional role) are skipped entirely rather than falling back to
     * {@code policy.default} per-role — see {@link ScopePolicy#explicitLevelFor} for why that
     * distinction matters. {@code policy.default} applies only when NO held role has any explicit
     * opinion at all. No roles at all is treated as {@link ScopeLevel#OWN} (conservative — never
     * silently unrestricted for an unidentifiable caller).
     */
    private static ScopeLevel effectiveLevel(ScopePolicy policy, Set<String> callerRoleCodes, String axis) {
        if (callerRoleCodes == null || callerRoleCodes.isEmpty())
            return ScopeLevel.OWN;

        boolean anyExplicitOpinion = false;
        for (String role : callerRoleCodes) {
            Optional<ScopeLevel> explicit = policy.explicitLevelFor(role, axis);
            if (explicit.isEmpty())
                continue;
            anyExplicitOpinion = true;
            if (explicit.get() == ScopeLevel.ALL)
                return ScopeLevel.ALL;
        }
        return anyExplicitOpinion ? ScopeLevel.OWN : policy.defaultLevelFor(axis);
    }
}
