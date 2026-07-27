package org.egov.pgr.analytics;

import io.opentelemetry.sdk.metrics.SdkMeterProvider;
import io.opentelemetry.sdk.metrics.data.MetricData;
import io.opentelemetry.sdk.testing.exporter.InMemoryMetricReader;
import org.junit.jupiter.api.Test;

import java.util.Collection;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

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

    /**
     * The collector's prometheus exporter appends a unit-derived suffix to the metric
     * name when the OTLP unit field is set (validated live: unit "ms" surfaced as
     * pgr_analytics_query_duration_ms_milliseconds_*). The documented scrape names
     * (docs/observability/dashboard-metrics-server.md) require the instruments to carry
     * their unit in the NAME only — this pins name and empty-unit for both instruments.
     */
    @Test
    public void instrumentNamesCarryUnitAndUnitFieldStaysEmpty() {
        InMemoryMetricReader reader = InMemoryMetricReader.create();
        SdkMeterProvider provider = SdkMeterProvider.builder().registerMetricReader(reader).build();
        try {
            AnalyticsMetrics metrics =
                    new AnalyticsMetrics(provider.get(AnalyticsMetrics.METER_NAME));
            metrics.recordQuery("open-complaints", "facts", "ke", 42L, 7L);

            Collection<MetricData> collected = reader.collectAllMetrics();
            assertEquals("", metricByName(collected, "pgr.analytics.query.duration.ms").getUnit(),
                    "duration histogram must not set an OTLP unit (exporter would append _milliseconds)");
            assertEquals("", metricByName(collected, "pgr.analytics.query.rows").getUnit(),
                    "rows counter must not set an OTLP unit");
        } finally {
            provider.close();
        }
    }

    private static MetricData metricByName(Collection<MetricData> collected, String name) {
        MetricData found = collected.stream()
                .filter(m -> name.equals(m.getName()))
                .findFirst()
                .orElse(null);
        assertTrue(found != null, "expected instrument " + name + " in " + collected);
        return found;
    }
}
