package org.egov.pgr.policy;

import lombok.extern.slf4j.Slf4j;

import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * Parsed {@code resource.<resourceType>.scope} block from an ACCESSCONTROL-ACTIONS-TEST action
 * record — the MDMS-authored declaration of which axes (department, jurisdiction, …) this action's
 * row-scoping cares about, and what {@link ScopeLevel} each role gets per axis. This is the PAP
 * artifact {@link ScopePolicyEngine} evaluates against a caller's roles + HRMS-resolved values.
 *
 * <p>Nested inside the EXISTING {@code resource} field (already round-tripped as opaque JSON by
 * egov-accesscontrol, exactly like the pre-existing {@code attributes} field-visibility rules) —
 * adding this costs zero changes to egov-accesscontrol/Digit-Core.
 */
@Slf4j
public final class ScopePolicy {

    /**
     * The only axes PGR search's ABAC engine actually knows how to enforce — Tier 1 (SQL) only
     * ever reads {@code department}/{@code jurisdiction} off {@link PgrSearchScope}, and Tier 2
     * ({@code AccessPolicyRegistry#AXIS_FIELDS}) only has a JsonLogic field mapping for the same
     * two. An axis outside this set would otherwise be silently ACCEPTED by {@link #parse} yet
     * silently DROPPED by Tier 1 (which has no field to put it in) while Tier 2 either fails
     * closed or drops it too — two tiers quietly disagreeing about a restriction that was never
     * enforced anywhere. Rejecting it here, once, at the one place both tiers' authored artifact
     * passes through, closes that gap for every consumer, including {@code _count} (which never
     * runs Tier 2 at all). Keep in sync with {@code AccessPolicyRegistry#AXIS_FIELDS}.
     */
    public static final Set<String> SUPPORTED_AXES = Set.of("department", "jurisdiction");

    private final List<String> axes;
    private final Map<String, Map<String, ScopeLevel>> roleScopes;
    private final Map<String, ScopeLevel> defaultScope;

    private ScopePolicy(List<String> axes, Map<String, Map<String, ScopeLevel>> roleScopes,
                         Map<String, ScopeLevel> defaultScope) {
        this.axes = axes;
        this.roleScopes = roleScopes;
        this.defaultScope = defaultScope;
    }

    public List<String> getAxes() {
        return axes;
    }

    /**
     * Builds an ad-hoc policy programmatically (no {@code roleScopes} — every role falls back to
     * {@code defaultScope}) — used for the in-code fallback a caller applies when MDMS has no
     * {@code scope} block configured for an action, so the same {@link ScopePolicyEngine} handles
     * both the MDMS-authored and the built-in-default case identically.
     */
    public static ScopePolicy of(List<String> axes, Map<String, ScopeLevel> defaultScope) {
        return new ScopePolicy(List.copyOf(axes), Map.of(), Map.copyOf(defaultScope));
    }

    /**
     * The level for {@code axis} that {@code roleCode} gets, per this policy: the role's own
     * declared level if present and well-formed, else this policy's {@code default} for that axis
     * if present and well-formed, else {@link ScopeLevel#OWN} (most conservative — never silently
     * widen on missing/malformed config). Convenience for simple single-role lookups; for the
     * MULTI-role union {@link ScopePolicyEngine} needs, use {@link #explicitLevelFor} +
     * {@link #defaultLevelFor} instead — see their Javadoc for why those are NOT equivalent to
     * calling this per role and combining the results.
     */
    public ScopeLevel levelFor(String roleCode, String axis) {
        return explicitLevelFor(roleCode, axis).orElseGet(() -> defaultLevelFor(axis));
    }

    /**
     * The role's OWN explicit declaration for {@code axis}, or empty if this role isn't listed in
     * {@code roleScopes} at all, or doesn't declare this axis. Deliberately distinct from
     * {@link #levelFor}: a caller ALWAYS holds a generic base-marker role (HRMS stamps
     * {@code EMPLOYEE} on every employee alongside their functional role) that is never explicitly
     * configured — if that marker role's "no opinion" silently became the policy {@code default}
     * and got unioned alongside a functional role's explicit, more restrictive level, a
     * most-permissive-wins union would let the marker role's (typically more permissive) default
     * ALWAYS neutralize any functional role's OWN restriction. {@code default} must apply only when
     * NO held role has an opinion at all — see {@link ScopePolicyEngine}.
     */
    public Optional<ScopeLevel> explicitLevelFor(String roleCode, String axis) {
        Map<String, ScopeLevel> roleLevels = roleScopes.get(roleCode);
        return roleLevels == null ? Optional.empty() : Optional.ofNullable(roleLevels.get(axis));
    }

    /** The policy-wide default for {@code axis} (used when no held role has an explicit opinion),
     *  or {@link ScopeLevel#OWN} if no default is declared for it either. */
    public ScopeLevel defaultLevelFor(String axis) {
        ScopeLevel fallback = defaultScope.get(axis);
        return fallback != null ? fallback : ScopeLevel.OWN;
    }

    /**
     * Parses the raw {@code scope} object from an action's {@code resource.<resourceType>} block.
     * {@code raw == null} means the {@code scope} key itself is absent — a confirmed absence of
     * configuration, so this returns empty and callers treat that as "no scope configured"
     * (backward compatible fallback), same principle as {@link AccessPolicyRegistry}'s "policy not
     * defined" handling elsewhere. Anything else that fails to parse into a well-formed policy (not
     * a Map, or no non-empty {@code axes} list) means the {@code scope} key IS present but broken —
     * an authoring mistake, NOT an absent policy — or one of the {@code axes} names isn't in
     * {@link #SUPPORTED_AXES} — and throws {@link MalformedScopePolicyException} so callers fail
     * closed instead of silently falling back to the same permissive default an absent policy gets.
     * Malformed INDIVIDUAL role/axis entries (once the top-level shape is valid)
     * are still skipped with a logged warning rather than invalidating the whole policy —
     * {@link #levelFor} degrades those to {@code default} or {@link ScopeLevel#OWN}, never silently
     * to {@link ScopeLevel#ALL}.
     */
    @SuppressWarnings("unchecked")
    public static Optional<ScopePolicy> parse(Object raw) {
        if (raw == null)
            return Optional.empty();
        if (!(raw instanceof Map))
            throw new MalformedScopePolicyException("scope is present but not a JSON object: " + raw.getClass().getSimpleName());
        Map<String, Object> scopeMap = (Map<String, Object>) raw;

        Object axesRaw = scopeMap.get("axes");
        if (!(axesRaw instanceof List) || ((List<?>) axesRaw).isEmpty())
            throw new MalformedScopePolicyException("'axes' missing/empty");
        List<String> axes = new java.util.ArrayList<>();
        for (Object a : (List<?>) axesRaw)
            if (a instanceof String && !((String) a).isBlank())
                axes.add((String) a);
        if (axes.isEmpty())
            throw new MalformedScopePolicyException("'axes' had no valid string entries");
        for (String axis : axes)
            if (!SUPPORTED_AXES.contains(axis))
                throw new MalformedScopePolicyException("axis '" + axis + "' is not supported (expected one of " + SUPPORTED_AXES + ")");
        Set<String> axisSet = new LinkedHashSet<>(axes);

        Map<String, ScopeLevel> defaultScope = parseAxisLevelMap(scopeMap.get("default"), axisSet, "default");

        Map<String, Map<String, ScopeLevel>> roleScopes = new LinkedHashMap<>();
        Object roleScopesRaw = scopeMap.get("roleScopes");
        if (roleScopesRaw instanceof Map) {
            for (Map.Entry<String, Object> entry : ((Map<String, Object>) roleScopesRaw).entrySet()) {
                String roleCode = entry.getKey() == null ? "" : entry.getKey().trim().toUpperCase();
                if (roleCode.isEmpty()) {
                    log.warn("ScopePolicy: 'roleScopes' has a blank role key — ignoring");
                    continue;
                }
                roleScopes.put(roleCode, parseAxisLevelMap(entry.getValue(), axisSet, "roleScopes." + entry.getKey()));
            }
        }

        return Optional.of(new ScopePolicy(axes, roleScopes, defaultScope));
    }

    @SuppressWarnings("unchecked")
    private static Map<String, ScopeLevel> parseAxisLevelMap(Object raw, Set<String> axisSet, String path) {
        Map<String, ScopeLevel> result = new LinkedHashMap<>();
        if (!(raw instanceof Map)) {
            if (raw != null)
                log.warn("ScopePolicy: '{}' is not a JSON object — ignoring", path);
            return result;
        }
        for (Map.Entry<String, Object> entry : ((Map<String, Object>) raw).entrySet()) {
            if (!axisSet.contains(entry.getKey())) {
                log.warn("ScopePolicy: '{}.{}' references an axis not declared in 'axes' — ignoring", path, entry.getKey());
                continue;
            }
            ScopeLevel level = entry.getValue() instanceof String ? ScopeLevel.parse((String) entry.getValue()) : null;
            if (level == null) {
                log.warn("ScopePolicy: '{}.{}' has an unrecognized level '{}' — ignoring (falls back to default/OWN)",
                        path, entry.getKey(), entry.getValue());
                continue;
            }
            result.put(entry.getKey(), level);
        }
        return result;
    }
}
