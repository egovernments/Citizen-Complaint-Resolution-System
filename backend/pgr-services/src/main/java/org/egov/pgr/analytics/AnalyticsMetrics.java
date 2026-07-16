package org.egov.pgr.analytics;

import io.opentelemetry.api.GlobalOpenTelemetry;
import io.opentelemetry.api.common.AttributeKey;
import io.opentelemetry.api.common.Attributes;
import io.opentelemetry.api.metrics.DoubleHistogram;
import io.opentelemetry.api.metrics.LongCounter;
import io.opentelemetry.api.metrics.Meter;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

/**
 * OTEL metrics for the dynamic analytics endpoints (#1110 — dashboard render-lag
 * instrumentation, server half).
 *
 * <p>Thin wrapper over {@link GlobalOpenTelemetry}: when the service runs under the
 * OpenTelemetry javaagent (the deploy.sh stack attaches it and sets
 * {@code OTEL_METRICS_EXPORTER=otlp}), the agent bridges this to its SDK and the
 * instruments export to the collector → Prometheus. Without the agent (unit tests, CI,
 * bare {@code java -jar}) {@code GlobalOpenTelemetry} is a no-op and every call here is
 * free and side-effect-less — no config or conditional wiring needed.
 *
 * <p>Instruments (OTLP names; Prometheus surfaces them as
 * {@code pgr_analytics_query_duration_ms_bucket/_sum/_count} and
 * {@code pgr_analytics_query_rows_total}):
 * <ul>
 *   <li>{@code pgr.analytics.query.duration.ms} — histogram, one point per executed SQL
 *       query (each batch entry, and each SOURCE query of a backend-composed KPI).</li>
 *   <li>{@code pgr.analytics.query.rows} — counter of rows returned.</li>
 * </ul>
 * Attributes: {@code kpi_id} (the KPI id, {@code inline} for inline-grammar queries),
 * {@code grain}, {@code tenant}. Cardinality is bounded: kpi_id by the MDMS catalog
 * (tens), grain by the 3 grains, tenant by the tenant tree.
 */
@Component
@Slf4j
public class AnalyticsMetrics {

    static final String METER_NAME = "pgr-analytics";

    static final AttributeKey<String> ATTR_KPI_ID = AttributeKey.stringKey("kpi_id");
    static final AttributeKey<String> ATTR_GRAIN  = AttributeKey.stringKey("grain");
    static final AttributeKey<String> ATTR_TENANT = AttributeKey.stringKey("tenant");

    private final DoubleHistogram queryDuration;
    private final LongCounter queryRows;

    public AnalyticsMetrics() {
        Meter meter = GlobalOpenTelemetry.getMeter(METER_NAME);
        this.queryDuration = meter.histogramBuilder("pgr.analytics.query.duration.ms")
                .setDescription("Duration of one executed analytics SQL query (per batch entry / compose source)")
                .setUnit("ms")
                .build();
        this.queryRows = meter.counterBuilder("pgr.analytics.query.rows")
                .setDescription("Rows returned by executed analytics SQL queries")
                .setUnit("{row}")
                .build();
    }

    /**
     * Record one executed analytics query. Never throws — telemetry must not be able to
     * break the query path.
     *
     * @param kpiId  the KPI id the query was resolved from, or {@code "inline"} for
     *               inline-grammar queries
     * @param grain  the grain the planner resolved ({@code facts|events|daily})
     * @param tenant the request tenantId (scope tenant, not per-row)
     */
    public void recordQuery(String kpiId, String grain, String tenant, long tookMs, long rowCount) {
        try {
            Attributes attrs = Attributes.of(
                    ATTR_KPI_ID, orDash(kpiId),
                    ATTR_GRAIN, orDash(grain),
                    ATTR_TENANT, orDash(tenant));
            queryDuration.record(tookMs, attrs);
            queryRows.add(rowCount, attrs);
        } catch (RuntimeException e) {
            log.debug("analytics metrics record failed (ignored): {}", e.toString());
        }
    }

    private static String orDash(String v) {
        return (v == null || v.isEmpty()) ? "-" : v;
    }
}
