package org.egov.pgr.analytics;

import org.egov.pgr.accesscontrol.PgrRowScope;

import java.util.List;
import java.util.Set;

/** Ready-made {@link AnalyticsAccess} values, so a test states the capabilities it cares about. */
final class AnalyticsAccessFixtures {

    private AnalyticsAccessFixtures() {}

    static final PgrRowScope STATE_SCOPE = new PgrRowScope("ke", true, List.of(), null, null);

    /** Every capability, unrestricted rows across the state subtree. */
    static AnalyticsAccess full() {
        return AnalyticsAccess.of(Set.copyOf(AnalyticsAccess.ALL_ACTIONS), false, STATE_SCOPE);
    }

    /** The base analytics grant only — no officer PII, no report capabilities. */
    static AnalyticsAccess baseQuery() {
        return withCapabilities(AnalyticsAccess.ACCESS, AnalyticsAccess.QUERY, AnalyticsAccess.PACKS,
                AnalyticsAccess.CATALOG_SEARCH, AnalyticsAccess.SCHEMA);
    }

    static AnalyticsAccess withCapabilities(String... capabilities) {
        return AnalyticsAccess.of(Set.of(capabilities), false, STATE_SCOPE);
    }

    static AnalyticsAccess withScope(PgrRowScope scope) {
        return AnalyticsAccess.of(Set.copyOf(AnalyticsAccess.ALL_ACTIONS), false, scope);
    }

    /** Allowed to query, but the resolved scope selects nothing. */
    static AnalyticsAccess denyAllRows() {
        return AnalyticsAccess.of(Set.copyOf(AnalyticsAccess.ALL_ACTIONS), true, null);
    }
}
