package org.egov.pgr.analytics;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;

/**
 * One immutable, per-request analytics calendar: the validated {@link ZoneId} the tenant's
 * DashboardConfig resolves to, and the single {@code asOf} epoch-ms instant the whole batch is
 * judged against.
 *
 * <p>{@link AnalyticsService#doQuery} resolves exactly ONE instance per request and threads it
 * through every downstream consumer — {@link AnalyticsPlanner}, {@link KpiQueryComposer}, and the
 * D1a compose operations — so a named window (dtd/wtd/…), a pinned-window suppression decision, an
 * explicit dateFrom/dateTo bound, and the response's own {@code asOf}/{@code calendar} fields can
 * never straddle two different clock readings or two different zones within the same batch.
 *
 * <p>{@link #businessDate} is {@code asOf} converted to a calendar date in {@link #zoneId} — the
 * "today" every named window and pinned-window decision is measured against.
 */
public final class BusinessCalendar {

    /** Documented migration-compatibility fallback zone for tenants with no valid configured zone. */
    public static final ZoneId DEFAULT_ZONE = ZoneId.of("Africa/Nairobi");

    public final ZoneId zoneId;
    public final long asOfMs;
    public final LocalDate businessDate;

    private BusinessCalendar(ZoneId zoneId, long asOfMs) {
        this.zoneId = zoneId;
        this.asOfMs = asOfMs;
        this.businessDate = Instant.ofEpochMilli(asOfMs).atZone(zoneId).toLocalDate();
    }

    public static BusinessCalendar of(ZoneId zoneId, long asOfMs) {
        return new BusinessCalendar(zoneId == null ? DEFAULT_ZONE : zoneId, asOfMs);
    }
}
