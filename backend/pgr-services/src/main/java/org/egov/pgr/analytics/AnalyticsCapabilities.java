package org.egov.pgr.analytics;

import org.egov.pgr.analytics.model.DashboardPack;
import org.egov.pgr.analytics.model.KpiDefinition;

import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * Which analytics actions this caller is granted — the dashboard's authorization state, resolved
 * once per request.
 *
 * <p>A capability is an action URL egov-accesscontrol confirmed the caller reaches. Nothing here is
 * a role. That is the change: the dashboard's six role personas lived in a hard-coded frontend
 * list, a `dss.DashboardConfig.allowedRoles` override, `DashboardPack.roles`,
 * `KpiDefinition.rbac.visibleTo` and two role sets in this service — five places free to disagree,
 * and they did. They are now one grant in the ACCESSCONTROL-ROLEACTIONS master, which is where
 * every other grant in the platform already lives.
 *
 * <p>These actions carry no policy of their own. Row scope comes from action 2008, separately —
 * see {@link AnalyticsRowScopeResolver}. An endpoint grant and a row filter are different
 * questions, and conflating them is what a {@code scopeRef}-style indirection would have done.
 */
public final class AnalyticsCapabilities {

    private static final String BASE = "/pgr-services/v2/analytics";

    /** Bootstrap: the dashboard's own "may I render at all". */
    public static final String ACCESS = BASE + "/_access";
    public static final String QUERY = BASE + "/_query";
    public static final String PACKS = BASE + "/packs";
    public static final String CATALOG_SEARCH = BASE + "/catalog/_search";
    public static final String SCHEMA = BASE + "/_schema";
    public static final String CONFIG_REFRESH = BASE + "/config/_refresh";
    /** Officer identity/PII projection — replaces the OFFICER_PII_ROLES set. */
    public static final String OFFICER = BASE + "/capabilities/officer";
    public static final String REPORTS = BASE + "/capabilities/reports";
    public static final String REPORTS_EXTENDED = BASE + "/capabilities/reports-extended";

    /** Every action resolved per request, in the order the bootstrap reports them. */
    public static final List<String> ALL = List.of(
            ACCESS, QUERY, PACKS, CATALOG_SEARCH, SCHEMA, CONFIG_REFRESH,
            OFFICER, REPORTS, REPORTS_EXTENDED);

    private final Set<String> granted;
    private final boolean publicSurface;

    private AnalyticsCapabilities(Set<String> granted, boolean publicSurface) {
        this.granted = Collections.unmodifiableSet(new LinkedHashSet<>(granted));
        this.publicSurface = publicSurface;
    }

    static AnalyticsCapabilities of(Set<String> granted) {
        return new AnalyticsCapabilities(granted, false);
    }

    /**
     * The anonymous surface: no token to introspect, so no grant to resolve. What it may see comes
     * solely from the catalog's own {@code public} markers, which is why this is a separate
     * constructor rather than an empty grant set that might later be widened by accident.
     */
    public static AnalyticsCapabilities publicSurface() {
        return new AnalyticsCapabilities(Set.of(), true);
    }

    public boolean isPublicSurface() {
        return publicSurface;
    }

    public Set<String> granted() {
        return granted;
    }

    public boolean allows(String actionUrl) {
        return granted.contains(actionUrl);
    }

    /** @throws AnalyticsAccessDeniedException (HTTP 403) when the caller lacks {@code actionUrl}. */
    public void require(String actionUrl) {
        if (!allows(actionUrl))
            throw new AnalyticsAccessDeniedException(actionUrl);
    }

    /** Officer-PII dimensions may be projected only with the officer capability. */
    public boolean allowsOfficerPii() {
        return allows(OFFICER);
    }

    /**
     * Whether this caller may see a catalog tile.
     *
     * <p>A definition declaring neither a required action nor {@code public} is invisible to
     * everyone rather than visible to everyone. The catalog is operator-authored: a tile whose gate
     * was forgotten or misspelled must not become the one tile with no gate at all.
     */
    public boolean canSee(KpiDefinition def) {
        if (def == null)
            return false;
        return publicSurface ? def.isPublicTile() : allows(def.getRequiredActionUrl());
    }

    /** Same rule, for a pack. */
    public boolean canSee(DashboardPack pack) {
        if (pack == null)
            return false;
        return publicSurface ? pack.isPublicPack() : allows(pack.getRequiredActionUrl());
    }
}
