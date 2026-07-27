package org.egov.pgr.analytics;

import io.opentelemetry.sdk.metrics.SdkMeterProvider;
import io.opentelemetry.sdk.metrics.data.MetricData;
import io.opentelemetry.sdk.testing.exporter.InMemoryMetricReader;
import org.junit.jupiter.api.Test;

import java.util.Collection;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * #1110: pins the per-request slow-query pool semantics — top-3 selection (descending
 * tookMs), fewer-than-3 handling, the exclusion of errored entries (they are simply
 * never recorded), the single structured log line, the trace-id fallback chain
 * (valid span > x-trace-id header > "-"), and the state-root normalization of the
 * metric tenant label (raw request tenantIds are attacker-controlled and must never
 * become Prometheus series).
 */
public class QueryTelemetryTest {

    @Test
    public void stateRootOfTruncatesToTheStateSegments() {
        assertEquals("ke", QueryTelemetry.stateRootOf("ke", 1));
        assertEquals("ke", QueryTelemetry.stateRootOf("ke.bomet", 1));
        assertEquals("ke", QueryTelemetry.stateRootOf("ke.attack0001", 1));
        assertEquals("ke.bomet", QueryTelemetry.stateRootOf("ke.bomet.ward1", 2));
        assertNull(QueryTelemetry.stateRootOf(null, 1));
        assertEquals("", QueryTelemetry.stateRootOf("", 1));
        // defensive: a broken stateLevelLen still keeps at least one segment
        assertEquals("zz", QueryTelemetry.stateRootOf("zz.a.b", 0));
    }

    @Test
    public void metricPointsCarryTheStateRootNotTheRawRequestTenant() {
        InMemoryMetricReader reader = InMemoryMetricReader.create();
        SdkMeterProvider provider = SdkMeterProvider.builder().registerMetricReader(reader).build();
        try {
            AnalyticsMetrics metrics = new AnalyticsMetrics(provider.get(AnalyticsMetrics.METER_NAME));
            QueryTelemetry tel = new QueryTelemetry(metrics, "ke.attack0001", 1);
            tel.record("tiles", "open-complaints", "facts", 5, 1);

            Collection<MetricData> collected = reader.collectAllMetrics();
            assertFalse(collected.isEmpty());
            for (MetricData md : collected) {
                md.getData().getPoints().forEach(p -> assertEquals("ke",
                        p.getAttributes().get(AnalyticsMetrics.ATTR_TENANT),
                        md.getName() + " must be tagged with the state root"));
            }
            // ...while the log line keeps the full request tenant for debugging
            assertTrue(tel.slowQueryLine("-").contains("tenant=ke.attack0001"));
        } finally {
            provider.close();
        }
    }

    @Test
    public void topSlowestSortsDescendingAndLimitsToThree() {
        QueryTelemetry tel = new QueryTelemetry(null, "ke", 1);
        tel.record("a", "kpi-a", "facts", 10, 1);
        tel.record("b", "kpi-b", "facts", 500, 2);
        tel.record("c", "kpi-c", "events", 250, 3);
        tel.record("d", "kpi-d", "facts", 999, 4);
        tel.record("e", "kpi-e", "daily", 1, 5);

        List<QueryTelemetry.Execution> top = tel.topSlowest(QueryTelemetry.TOP_N);
        assertEquals(3, top.size());
        assertEquals("d", top.get(0).name);
        assertEquals("b", top.get(1).name);
        assertEquals("c", top.get(2).name);
        assertEquals(5, tel.total());
    }

    @Test
    public void fewerThanThreeEntriesReturnsWhatRan() {
        QueryTelemetry tel = new QueryTelemetry(null, "ke.bomet", 1);
        tel.record("only", "kpi-x", "facts", 77, 0);
        List<QueryTelemetry.Execution> top = tel.topSlowest(QueryTelemetry.TOP_N);
        assertEquals(1, top.size());
        assertEquals(77, top.get(0).tookMs);
    }

    @Test
    public void erroredEntriesAreExcludedBecauseNeverRecorded() {
        // The service records ONLY successful runOne() executions; an entry that threw
        // (plan error, kpi_forbidden, SQL failure) has no tookMs and never enters the pool.
        QueryTelemetry tel = new QueryTelemetry(null, "ke", 1);
        tel.record("ok-1", "kpi-a", "facts", 5, 1);
        // "boom" entry errored -> no record() call
        tel.record("ok-2", "kpi-b", "facts", 9, 1);

        assertEquals(2, tel.total());
        assertTrue(tel.topSlowest(QueryTelemetry.TOP_N).stream().noneMatch(e -> "boom".equals(e.name)));
    }

    @Test
    public void emptyPoolMeansNoLogLine() {
        QueryTelemetry tel = new QueryTelemetry(null, "ke", 1);
        assertTrue(tel.isEmpty());
    }

    @Test
    public void slowQueryLineCarriesTraceTenantTotalAndTop() {
        QueryTelemetry tel = new QueryTelemetry(null, "ke.bomet", 1);
        tel.record("tiles", "open-complaints", "facts", 120, 42);
        String line = tel.slowQueryLine("abc123def456");
        assertTrue(line.startsWith("analytics.slow_queries traceId=abc123def456 tenant=ke.bomet total=1 top=["));
        assertTrue(line.contains("{name=tiles, kpiId=open-complaints, tookMs=120, rowCount=42}"));
    }

    @Test
    public void callerControlledNamesAreSanitizedInTheLogLine() {
        QueryTelemetry tel = new QueryTelemetry(null, "ke", 1);
        tel.record("evil\nname \"quoted\"", "kpi", "facts", 1, 0);
        String line = tel.slowQueryLine("-");
        assertFalse(line.contains("\n"));
        assertFalse(line.contains("\""));
    }

    @Test
    public void traceIdFallsBackToHeaderThenDash() {
        // No agent in unit tests -> Span.current() is invalid -> header wins.
        assertEquals("deadbeef", QueryTelemetry.resolveTraceId("deadbeef"));
        assertEquals("deadbeef", QueryTelemetry.resolveTraceId("  deadbeef  "));
        assertEquals("-", QueryTelemetry.resolveTraceId(null));
        assertEquals("-", QueryTelemetry.resolveTraceId("   "));
    }

    @Test
    public void sanitizeCapsLengthAndStripsUnsafeChars() {
        assertEquals("-", QueryTelemetry.sanitize(null));
        assertEquals("-", QueryTelemetry.sanitize(""));
        assertEquals("a_b_c", QueryTelemetry.sanitize("a b\nc"));
        assertEquals(64, QueryTelemetry.sanitize("x".repeat(200)).length());
        assertEquals("ke.bomet", QueryTelemetry.sanitize("ke.bomet"));
    }
}
