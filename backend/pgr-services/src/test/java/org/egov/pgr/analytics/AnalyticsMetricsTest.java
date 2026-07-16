package org.egov.pgr.analytics;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;

/**
 * #1110: the metrics component must be a total no-op — and in particular must never
 * throw — when the OpenTelemetry javaagent is NOT attached (unit tests, CI, bare
 * java -jar). GlobalOpenTelemetry returns its no-op implementation here, so these
 * calls exercise exactly the agent-less production path.
 */
public class AnalyticsMetricsTest {

    @Test
    public void constructsAndRecordsWithoutAgent() {
        AnalyticsMetrics metrics = new AnalyticsMetrics();
        assertDoesNotThrow(() -> metrics.recordQuery("open-complaints", "facts", "ke", 42L, 7L));
    }

    @Test
    public void toleratesNullAndEmptyAttributes() {
        AnalyticsMetrics metrics = new AnalyticsMetrics();
        assertDoesNotThrow(() -> metrics.recordQuery(null, null, null, 0L, 0L));
        assertDoesNotThrow(() -> metrics.recordQuery("", "", "", -1L, 0L));
    }
}
