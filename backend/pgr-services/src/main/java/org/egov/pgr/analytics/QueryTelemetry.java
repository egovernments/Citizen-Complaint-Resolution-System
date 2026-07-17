package org.egov.pgr.analytics;

import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.SpanContext;
import lombok.extern.slf4j.Slf4j;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.stream.Collectors;

/**
 * Per-request recorder of executed analytics SQL queries (#1110).
 *
 * <p>One instance is created per {@code /_query} request and threaded through
 * {@code AnalyticsService.runOne()} — the single choke point every SQL execution passes
 * through (plain batch entries, the single-query arm, AND each SOURCE query of a
 * backend-composed KPI). Each execution is (a) exported as an OTEL histogram/counter
 * point via {@link AnalyticsMetrics} and (b) pooled for the per-request top-N
 * slow-query log line. Errored entries never reach {@link #record} (the exception fires
 * before/at execution), so they are naturally excluded from the pool.
 *
 * <p>Not thread-safe by design: request-scoped, single thread.
 */
@Slf4j
final class QueryTelemetry {

    static final int TOP_N = 3;

    /** One executed query: batch-entry name + resolved kpiId (or "inline") + timings. */
    static final class Execution {
        final String name;
        final String kpiId;
        final long tookMs;
        final long rowCount;

        Execution(String name, String kpiId, long tookMs, long rowCount) {
            this.name = name;
            this.kpiId = kpiId;
            this.tookMs = tookMs;
            this.rowCount = rowCount;
        }
    }

    private final AnalyticsMetrics metrics;
    private final String tenantId;
    private final List<Execution> executions = new ArrayList<>();

    QueryTelemetry(AnalyticsMetrics metrics, String tenantId) {
        this.metrics = metrics;
        this.tenantId = tenantId;
    }

    /** Record one successfully executed query (metric point + slow-query pool entry). */
    void record(String name, String kpiId, String grain, long tookMs, long rowCount) {
        if (metrics != null) metrics.recordQuery(kpiId, grain, tenantId, tookMs, rowCount);
        executions.add(new Execution(name, kpiId, tookMs, rowCount));
    }

    boolean isEmpty() {
        return executions.isEmpty();
    }

    int total() {
        return executions.size();
    }

    /** The n slowest executions, descending by tookMs (fewer when fewer ran). */
    List<Execution> topSlowest(int n) {
        return executions.stream()
                .sorted(Comparator.comparingLong((Execution e) -> e.tookMs).reversed())
                .limit(n)
                .collect(Collectors.toList());
    }

    /**
     * The ONE structured line logged per request:
     * {@code analytics.slow_queries traceId=<id> tenant=<t> total=<n> top=[{...},...]}.
     * Promtail ships it to Loki; the traceId pivots to Tempo (and to the FE's
     * {@code dashboard.load} log record, which carries the same id).
     */
    String slowQueryLine(String traceId) {
        String top = topSlowest(TOP_N).stream()
                .map(e -> "{name=" + sanitize(e.name) + ", kpiId=" + sanitize(e.kpiId)
                        + ", tookMs=" + e.tookMs + ", rowCount=" + e.rowCount + "}")
                .collect(Collectors.joining(", ", "[", "]"));
        return "analytics.slow_queries traceId=" + sanitize(traceId)
                + " tenant=" + sanitize(tenantId)
                + " total=" + total()
                + " top=" + top;
    }

    /**
     * Trace id for correlation. Preference order:
     * <ol>
     *   <li>the current span's trace id when valid — under the javaagent + Kong's
     *       {@code opentelemetry} plugin (w3c) this IS the browser's per-load trace id;</li>
     *   <li>the literal {@code x-trace-id} request header (agent-less deployments);</li>
     *   <li>{@code "-"}.</li>
     * </ol>
     */
    static String resolveTraceId(String headerTraceId) {
        try {
            SpanContext sc = Span.current().getSpanContext();
            if (sc.isValid()) return sc.getTraceId();
        } catch (RuntimeException e) {
            // no agent / API misbehaviour — fall through to the header (but keep the root cause)
            log.trace("Span.current() unavailable; falling back to x-trace-id header", e);
        }
        if (headerTraceId != null && !headerTraceId.isBlank()) return headerTraceId.trim();
        return "-";
    }

    /**
     * Log-injection hygiene for caller-controlled strings (batch-entry names, header
     * trace ids): allow only word chars plus {@code . : # / -}, cap at 64 chars.
     */
    static String sanitize(String v) {
        if (v == null || v.isEmpty()) return "-";
        String cleaned = v.replaceAll("[^\\w.:#/\\-]", "_");
        return cleaned.length() > 64 ? cleaned.substring(0, 64) : cleaned;
    }
}
