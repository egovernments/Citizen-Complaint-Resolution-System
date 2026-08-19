package org.egov.pgr.accesscontrol;

import java.util.List;

/**
 * Server-resolved row scope — a pure typed value object with no behavior beyond
 * {@link #from(ResolvedScope)}. Shared by both PEPs that filter rows by tenant/citizen/department/
 * jurisdiction (PGR complaint search and the employee analytics grains), since both now consume the
 * identical egov-accesscontrol {@link ResolvedScope} contract; each PEP applies these fields to its
 * own schema (PGR search: {@code ads.locality} exact match; analytics: delimiter-safe membership on
 * {@code boundary_path}).
 *
 * It is NEVER taken from the request body and NEVER combined with any locally-held role/policy
 * knowledge — it is exactly what {@link #from} mapped out of the PDP's own decision, and {@link
 * #from} rejects rather than defaults every field the contract does not explicitly supply. Fields:
 * - tenant scope:      always applied ({@link #tenantSubtree} ? LIKE prefix : exact match).
 * - citizenUuids:      empty = no ownership restriction; non-empty = restricted to this set (matches
 *                       {@link ResolvedScope#getCitizenUuids()}'s own contract).
 * - departmentCodes:   null = ALL (unrestricted); non-null (possibly empty) = VALUES membership.
 * - jurisdictionCodes: null = ALL (unrestricted); non-null (possibly empty) = VALUES membership.
 */
public final class PgrRowScope {
    public final String tenantId;
    public final boolean tenantSubtree;
    public final List<String> citizenUuids;
    public final List<String> departmentCodes;
    public final List<String> jurisdictionCodes;

    public PgrRowScope(String tenantId, boolean tenantSubtree, List<String> citizenUuids,
                        List<String> departmentCodes, List<String> jurisdictionCodes) {
        this.tenantId = tenantId;
        this.tenantSubtree = tenantSubtree;
        this.citizenUuids = citizenUuids;
        this.departmentCodes = departmentCodes;
        this.jurisdictionCodes = jurisdictionCodes;
    }

    /**
     * The ONLY way a caller may skip row scoping in a query builder. A {@code null} scope on a
     * scoped search/query path is a wiring bug, not an authorization decision — see each query
     * builder's {@code applyScope}. Approved unrestricted callers (plainSearch, internal
     * fetch-by-id/update-reconciliation) must pass this sentinel explicitly instead of {@code null}.
     */
    public static final PgrRowScope UNRESTRICTED = new PgrRowScope(null, false, List.of(), null, null);

    /**
     * Maps a well-formed, {@code effect=FILTER} {@link ResolvedScope} into the SQL-facing scope.
     * Callers must handle {@code effect=DENY} themselves (short-circuit before ever reaching SQL)
     * and must never call this for a {@code null}/malformed scope.
     *
     * <p>Strict by construction: every field the contract declares — {@code tenant}, {@code
     * citizenUuids}, {@code axes}, each axis's {@code mode}, and a VALUES axis's {@code values} — is
     * REQUIRED. A missing one is never translated to "unrestricted"; it fails closed via {@link
     * AccessControlUnavailableException}, the same outcome as a PDP outage, because PGR cannot tell
     * a genuinely-absent restriction from a contract PGR failed to fully receive.
     *
     * @throws AccessControlUnavailableException if any required field is missing.
     */
    public static PgrRowScope from(ResolvedScope scope) {
        if (scope == null)
            throw new AccessControlUnavailableException("decision carries no scope");
        if (scope.getTenant() == null || scope.getTenant().getValue() == null || scope.getTenant().getMatch() == null)
            throw new AccessControlUnavailableException("decision scope carries no usable tenant match");
        if (scope.getCitizenUuids() == null)
            throw new AccessControlUnavailableException("decision scope carries no citizenUuids (null, not even an empty list)");
        if (scope.getAxes() == null)
            throw new AccessControlUnavailableException("decision scope carries no axes");

        boolean subtree = scope.getTenant().getMatch() == TenantMatch.SUBTREE;
        String tenantId = scope.getTenant().getValue();
        List<String> departmentCodes = requireAxisValues(scope.getAxes().getDepartment(), "department");
        List<String> jurisdictionCodes = requireAxisValues(scope.getAxes().getJurisdiction(), "jurisdiction");
        return new PgrRowScope(tenantId, subtree, scope.getCitizenUuids(), departmentCodes, jurisdictionCodes);
    }

    /**
     * {@code null} axis or {@code null} mode fails closed (never silently ALL). {@code ALL} =>
     * unrestricted (returned as {@code null}, this class's own convention for that axis). {@code
     * VALUES} => the values list; a {@code null} values list on a VALUES axis is itself malformed
     * and fails closed too — only an explicit (possibly empty) list is accepted.
     */
    private static List<String> requireAxisValues(AxisScope axis, String axisName) {
        if (axis == null)
            throw new AccessControlUnavailableException("decision scope carries no '" + axisName + "' axis");
        if (axis.getMode() == null)
            throw new AccessControlUnavailableException("decision scope's '" + axisName + "' axis carries no mode");
        if (axis.getMode() == AxisMode.ALL)
            return null;
        if (axis.getValues() == null)
            throw new AccessControlUnavailableException(
                    "decision scope's '" + axisName + "' axis is VALUES but carries no values list");
        return axis.getValues();
    }
}
