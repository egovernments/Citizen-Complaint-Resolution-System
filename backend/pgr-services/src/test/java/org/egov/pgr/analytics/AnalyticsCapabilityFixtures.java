package org.egov.pgr.analytics;

import java.util.Set;

/** Ready-made capability sets, so a test states the grants it cares about. */
final class AnalyticsCapabilityFixtures {

    private AnalyticsCapabilityFixtures() {}

    /** Every analytics capability. */
    static AnalyticsCapabilities full() {
        return AnalyticsCapabilities.of(Set.copyOf(AnalyticsCapabilities.ALL));
    }

    static AnalyticsCapabilities of(String... capabilities) {
        return AnalyticsCapabilities.of(Set.of(capabilities));
    }

    static AnalyticsCapabilities none() {
        return AnalyticsCapabilities.of(Set.of());
    }
}
