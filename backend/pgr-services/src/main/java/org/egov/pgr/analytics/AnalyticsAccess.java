package org.egov.pgr.analytics;

import org.egov.pgr.accesscontrol.AccessDeniedException;
import org.egov.pgr.accesscontrol.PgrRowScope;
import org.egov.pgr.analytics.model.DashboardPack;
import org.egov.pgr.analytics.model.KpiDefinition;

import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.Set;

/**
 * What egov-accesscontrol decided this caller may do on the analytics surface, and the row scope it
 * handed back — the whole authorization state of one analytics request, resolved once.
 *
 * <p>A capability is an action URL the PDP allowed; nothing here is a role. That is the point: the
 * six role combinations the dashboard catalog used to encode became nine action grants, so who may
 * see the officer tiles is now answered by the same role→action master that answers who may search
 * complaints, instead of by a role list living in this service, another in the catalog and a third
 * in the browser.
 *
 * <p>The anonymous surface is a separate constructor rather than a capability set with something
 * missing from it. An unauthenticated caller has no token to introspect, so there is no decision to
 * ask for; what they may see is fixed by the catalog's own {@code public: true} markers, and
 * {@link #publicSurface()} can therefore never widen into an employee capability by accident.
 */
public final class AnalyticsAccess {

    private static final String BASE = "/pgr-services/v2/analytics";

    /** Bootstrap: which of the capabilities below the caller holds. */
    public static final String ACCESS = BASE + "/_access";
    /** Base employee analytics. Carries the row scope; every other capability rides on top of it. */
    public static final String QUERY = BASE + "/_query";
    public static final String PACKS = BASE + "/packs";
    public static final String CATALOG_SEARCH = BASE + "/catalog/_search";
    public static final String SCHEMA = BASE + "/_schema";
    public static final String CONFIG_REFRESH = BASE + "/config/_refresh";
    /** Officer identity/PII projection. */
    public static final String CAPABILITY_OFFICER = BASE + "/capabilities/officer";
    public static final String CAPABILITY_REPORTS = BASE + "/capabilities/reports";
    public static final String CAPABILITY_REPORTS_EXTENDED = BASE + "/capabilities/reports-extended";

    /** Every action the analytics PEP resolves, in the order the bootstrap reports them. */
    public static final java.util.List<String> ALL_ACTIONS = java.util.List.of(
            ACCESS, QUERY, PACKS, CATALOG_SEARCH, SCHEMA, CONFIG_REFRESH,
            CAPABILITY_OFFICER, CAPABILITY_REPORTS, CAPABILITY_REPORTS_EXTENDED);

    private final Set<String> capabilities;
    private final boolean publicSurface;
    private final boolean denyAllRows;
    private final PgrRowScope rowScope;

    private AnalyticsAccess(Set<String> capabilities, boolean publicSurface, boolean denyAllRows,
                            PgrRowScope rowScope) {
        this.capabilities = capabilities;
        this.publicSurface = publicSurface;
        this.denyAllRows = denyAllRows;
        this.rowScope = rowScope;
    }

    static AnalyticsAccess of(Set<String> capabilities, boolean denyAllRows, PgrRowScope rowScope) {
        return new AnalyticsAccess(Collections.unmodifiableSet(new LinkedHashSet<>(capabilities)),
                false, denyAllRows, rowScope);
    }

    /**
     * The anonymous surface: no capabilities, no identity, and a tenant-only row scope. Visibility
     * comes solely from the catalog's {@code public: true} markers.
     */
    public static AnalyticsAccess publicSurface(PgrRowScope tenantOnlyScope) {
        return new AnalyticsAccess(Set.of(), true, false, tenantOnlyScope);
    }

    public boolean isPublicSurface() {
        return publicSurface;
    }

    public Set<String> getCapabilities() {
        return capabilities;
    }

    public boolean allows(String actionUrl) {
        return capabilities.contains(actionUrl);
    }

    /** @throws AccessDeniedException (HTTP 403) when the caller does not hold {@code actionUrl}. */
    public void require(String actionUrl) {
        if (!allows(actionUrl))
            throw new AccessDeniedException(actionUrl, "not granted to this caller at this tenant");
    }

    /** True when the resolved scope selects no rows at all — the caller is allowed, but sees nothing. */
    public boolean isDenyAllRows() {
        return denyAllRows;
    }

    /** The PDP's row scope. Null exactly when {@link #isDenyAllRows()}. */
    public PgrRowScope getRowScope() {
        return rowScope;
    }

    /** Officer-PII dimensions may be projected only with the officer capability. */
    public boolean allowsOfficerPii() {
        return allows(CAPABILITY_OFFICER);
    }

    /**
     * Whether this caller may see a catalog tile.
     *
     * <p>A definition that declares neither a required action nor {@code public} is invisible to
     * everyone rather than visible to everyone. The catalog is operator-authored data: a def whose
     * gate was forgotten or misspelled must not become the one tile with no gate at all.
     */
    public boolean canSee(KpiDefinition def) {
        if (def == null)
            return false;
        return publicSurface ? def.isPublicTile() : allows(def.getRequiredActionUrl());
    }

    /** Same rule as {@link #canSee(KpiDefinition)}, for a pack. */
    public boolean canSee(DashboardPack pack) {
        if (pack == null)
            return false;
        return publicSurface ? pack.isPublicPack() : allows(pack.getRequiredActionUrl());
    }
}
