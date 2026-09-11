package org.egov.pgr.analytics;

import com.fasterxml.jackson.databind.JsonNode;
import org.egov.pgr.policy.PgrSearchScope;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

/**
 * Pins the {@code window.pinned} contract (#1462) — the fix for "Complaints created today" reporting
 * the selected date range instead of today.
 *
 * <p>Covers: the new {@code dtd} calendar-day window (vs the rolling {@code last_1d} it replaces),
 * a pinned window surviving both the {@code window} param and an explicit {@code dateFrom}/
 * {@code dateTo}, suppression when the selected range cannot contain the pinned interval,
 * {@code compare:"prior"} meaning yesterday rather than a prior-equal-duration-of-the-range, the
 * sparkline staying answerable, non-time params still narrowing a pinned query, and — the
 * regression guard that matters most — that every UNPINNED def behaves exactly as before.
 *
 * <p>Deterministic (#29): every case is judged against ONE fixed {@link BusinessCalendar}
 * ({@code CAL}, a Saturday, EAT) rather than the wall clock — the request-scoped calendar this
 * class exists to make possible. This also removes the old two-clock race between the test's own
 * {@code today()} read and the composer's separate internal clock read.
 */
public class KpiQueryComposerPinnedWindowTest {

    private static final ZoneId EAT = ZoneId.of("Africa/Nairobi");
    /** Fixed "now": 2024-06-15 12:00 EAT (a Saturday), mid-day so no test is a midnight boundary case. */
    private static final BusinessCalendar CAL =
            BusinessCalendar.of(EAT, ZonedDateTime.of(2024, 6, 15, 12, 0, 0, 0, EAT).toInstant().toEpochMilli());

    private final ObjectMapper om = new ObjectMapper();
    private final AnalyticsCatalog catalog = new AnalyticsCatalog();
    private final KpiQueryComposer composer = new KpiQueryComposer(catalog);
    private final AnalyticsPlanner planner = new AnalyticsPlanner(catalog);
    private final PgrSearchScope stateScope = new PgrSearchScope("ke", true, null, null, null);

    private JsonNode json(String s) {
        try { return om.readTree(s); } catch (Exception e) { throw new RuntimeException(e); }
    }

    private LocalDate today() { return CAL.businessDate; }

    /** The seeded "complaints created today" def, post-fix: a pinned calendar-day window. */
    private JsonNode createdTodayBase() {
        return json("{\"grain\":\"facts\",\"measures\":[{\"name\":\"total\",\"agg\":\"count\"}],"
                + "\"window\":{\"name\":\"dtd\",\"timeRole\":\"filed_at\",\"pinned\":true}}");
    }

    /** Same shape, unpinned — the historical behaviour every other tile relies on. */
    private JsonNode unpinnedBase() {
        return json("{\"grain\":\"facts\",\"measures\":[{\"name\":\"total\",\"agg\":\"count\"}],"
                + "\"window\":{\"name\":\"last_7d\",\"timeRole\":\"filed_at\"}}");
    }

    private JsonNode merge(JsonNode base, String params) {
        return composer.mergeParams(base, json(params), new ArrayList<>(), CAL);
    }

    private boolean suppressed(JsonNode merged) {
        return merged.path("__suppressed").asBoolean(false);
    }

    // ---- the dtd window itself ----

    /** dtd is the calendar day in EAT — NOT last_1d's rolling 24h, which drifts across midnight. */
    @Test
    public void dtdIsTheCalendarDayNotARollingDay() {
        long now = CAL.nowMs;
        long dtd = AnalyticsPlanner.windowStartMs("dtd", now, EAT);
        long rolling = AnalyticsPlanner.windowStartMs("last_1d", now, EAT);

        assertEquals(today().atStartOfDay(EAT).toInstant().toEpochMilli(), dtd,
                "dtd must start at EAT midnight of the current day");
        assertEquals(now - 86_400_000L, rolling, "last_1d must remain a rolling 24h window");
        assertTrue(dtd >= rolling, "midnight today is never earlier than 24h ago");
    }

    /** dtd plans into a real time predicate, so a pinned tile still filters on its own axis. */
    @Test
    public void dtdPlansIntoATimePredicate() {
        AnalyticsPlanner.Planned p = planner.plan(createdTodayBase(), stateScope, CAL);
        assertTrue(p.sql.contains("created_at >= ?") && p.sql.contains("created_at < ?"),
                "expected a bounded created_at predicate, got: " + p.sql);
    }

    @Test
    public void unknownWindowNameStillRejected() {
        assertThrows(IllegalArgumentException.class,
                () -> AnalyticsPlanner.windowStartMs("dtd_", CAL.nowMs, EAT));
    }

    // ---- pinning beats the dashboard globals ----

    /** The whole bug: a selected range must not redefine what "today" means. */
    @Test
    public void dateRangeDoesNotRewriteAPinnedWindow() {
        LocalDate t = today();
        JsonNode merged = merge(createdTodayBase(),
                "{\"dateFrom\":\"" + t.minusDays(30) + "\",\"dateTo\":\"" + t + "\"}");

        // The pin is now materialized into explicit bounds instead of being left as a window node
        // for the planner to re-resolve, so assert on the bound interval rather than window.name.
        assertFalse(merged.has("window"), "the pinned window is baked into explicit bounds");
        assertEquals(t.atStartOfDay(EAT).toInstant().toEpochMilli(),
                merged.path("filters").path("created_at").path("gte").asLong(),
                "bounds must start at EAT midnight TODAY, not at the range start");
        assertFalse(suppressed(merged), "the range covers today, so the tile is answerable");
    }

    /** The window param (the FE's per-tile default) must not override a pin either. */
    @Test
    public void windowParamDoesNotOverrideAPinnedWindowAndIsReported() {
        List<String> ignored = new ArrayList<>();
        JsonNode merged = composer.mergeParams(createdTodayBase(), json("{\"window\":\"last_30d\"}"), ignored, CAL);

        long midnight = today().atStartOfDay(EAT).toInstant().toEpochMilli();
        assertEquals(midnight, merged.path("filters").path("created_at").path("gte").asLong(),
                "the pin still governs; last_30d must not widen it");
        assertEquals(List.of("window"), ignored,
                "an unappliable window param must be reported, not silently swallowed");
    }

    // ---- suppression ----

    /** Range entirely in the past: today cannot be in it, so the tile has no answer. */
    @Test
    public void rangeEndingBeforeTodaySuppresses() {
        LocalDate t = today();
        JsonNode merged = merge(createdTodayBase(),
                "{\"dateFrom\":\"" + t.minusDays(30) + "\",\"dateTo\":\"" + t.minusDays(1) + "\"}");
        assertTrue(suppressed(merged), "a range ending yesterday excludes today");
    }

    /** Range entirely in the future: same. */
    @Test
    public void rangeStartingAfterTodaySuppresses() {
        LocalDate t = today();
        JsonNode merged = merge(createdTodayBase(),
                "{\"dateFrom\":\"" + t.plusDays(1) + "\",\"dateTo\":\"" + t.plusDays(7) + "\"}");
        assertTrue(suppressed(merged), "a range starting tomorrow excludes today");
    }

    /** A single-day range on today is the boundary case — inclusive, so answerable. */
    @Test
    public void rangeOfExactlyTodayIsNotSuppressed() {
        LocalDate t = today();
        JsonNode merged = merge(createdTodayBase(),
                "{\"dateFrom\":\"" + t + "\",\"dateTo\":\"" + t + "\"}");
        assertFalse(suppressed(merged));
    }

    /** No range at all (the dashboard default) — nothing to conflict with. */
    @Test
    public void noRangeIsNeverSuppressed() {
        assertFalse(suppressed(merge(createdTodayBase(), "{\"window\":\"last_7d\"}")));
    }

    /** Suppression is a marker for the service, never a grammar field: it must not reach SQL. */
    @Test
    public void suppressionMarkerIsNotAPlannableField() {
        LocalDate t = today();
        JsonNode merged = merge(createdTodayBase(),
                "{\"dateFrom\":\"" + t.minusDays(9) + "\",\"dateTo\":\"" + t.minusDays(2) + "\"}");
        assertTrue(suppressed(merged));
        // The planner ignores it rather than emitting it — the service short-circuits before planning,
        // but a stray plan() call must still never produce a __suppressed column or predicate.
        AnalyticsPlanner.Planned p = planner.plan(merged, stateScope, CAL);
        assertFalse(p.sql.contains("__suppressed"), "marker leaked into SQL: " + p.sql);
    }

    // ---- prior ----

    /** "vs yesterday" must mean yesterday, not the prior 30 days because a month was selected. */
    @Test
    public void priorOnAPinnedDayMeansYesterday() {
        LocalDate t = today();
        JsonNode merged = merge(createdTodayBase(),
                "{\"compare\":\"prior\",\"dateFrom\":\"" + t.minusDays(30) + "\",\"dateTo\":\"" + t + "\"}");

        long expectedFrom = t.minusDays(1).atStartOfDay(EAT).toInstant().toEpochMilli();
        long expectedTo = t.atStartOfDay(EAT).toInstant().toEpochMilli();
        assertEquals(expectedFrom, merged.path("filters").path("created_at").path("gte").asLong());
        assertEquals(expectedTo, merged.path("filters").path("created_at").path("lt").asLong());
        assertFalse(merged.has("window"), "explicit prior bounds replace the window");
    }

    // ---- sparkline ----

    /** The trend line is context, not the headline number: it stays answerable and range-bucketed. */
    @Test
    public void dailySeriesStaysAnswerableOnAPinnedDef() {
        LocalDate t = today();
        JsonNode merged = merge(createdTodayBase(),
                "{\"series\":\"daily\",\"dateFrom\":\"" + t.minusDays(9) + "\",\"dateTo\":\"" + t.minusDays(2) + "\"}");

        assertFalse(suppressed(merged), "a sparkline over the selected range is well-defined");
        List<String> dims = new ArrayList<>();
        merged.path("dimensions").forEach(d -> dims.add(d.asText()));
        assertTrue(dims.contains("created_date"), "expected the daily date dimension, got " + dims);
    }

    // ---- pinning fixes time, not filters ----

    @Test
    public void narrowingParamsStillApplyToAPinnedQuery() {
        JsonNode merged = merge(createdTodayBase(), "{\"ward\":\"WARD_1\",\"serviceCode\":\"Pothole\"}");
        assertEquals("WARD_1", merged.path("filters").path("ward_code").path("eq").asText());
        assertEquals("Pothole", merged.path("filters").path("service_code").path("eq").asText());
        assertEquals(today().atStartOfDay(EAT).toInstant().toEpochMilli(),
                merged.path("filters").path("created_at").path("gte").asLong(),
                "the pin still governs the time axis alongside the narrowing filters");
    }

    // ---- review follow-ups (#1483) ----

    /** A pinned WEEK under a two-day filter must not report the whole week: coverage, not overlap. */
    @Test
    public void partialOverlapOfAMultiDayPinIsSuppressed() {
        LocalDate t = today();
        JsonNode weekly = json("{\"grain\":\"facts\",\"measures\":[{\"name\":\"total\",\"agg\":\"count\"}],"
                + "\"window\":{\"name\":\"wtd\",\"timeRole\":\"filed_at\",\"pinned\":true}}");
        JsonNode merged = merge(weekly,
                "{\"dateFrom\":\"" + t.minusDays(1) + "\",\"dateTo\":\"" + t + "\"}");

        LocalDate weekStart = t.with(java.time.temporal.TemporalAdjusters.previousOrSame(java.time.DayOfWeek.MONDAY));
        // Only meaningful from Wednesday on: earlier in the week the 2-day range genuinely covers
        // the whole week-to-date, so there is nothing partial to assert. CAL is a fixed Saturday, so
        // this always exercises the real case rather than skipping.
        assumeTrue(t.minusDays(1).isAfter(weekStart),
                "early in the week the range covers the pinned window; nothing partial to test");
        assertTrue(suppressed(merged),
                "a range covering only part of the pinned week must not report the full week");
    }

    /** Pinning something boundless has no meaning; it must degrade to the ordinary path, not to a lie. */
    @Test
    public void pinningABoundlessWindowIsIgnored() {
        JsonNode boundless = json("{\"grain\":\"facts\",\"measures\":[{\"name\":\"total\",\"agg\":\"count\"}],"
                + "\"window\":{\"name\":\"all\",\"timeRole\":\"filed_at\",\"pinned\":true}}");
        LocalDate t = today();
        JsonNode merged = merge(boundless,
                "{\"compare\":\"prior\",\"dateFrom\":\"" + t.minusDays(9) + "\",\"dateTo\":\"" + t + "\"}");

        assertFalse(suppressed(merged), "a boundless window has no interval to miss");
        assertTrue(merged.path("filters").path("created_at").has("gte"),
                "prior must still shift the range, not silently re-run the current query");
        assertNotEquals(t.atStartOfDay(EAT).toInstant().toEpochMilli(),
                merged.path("filters").path("created_at").path("gte").asLong());
    }

    /** With no range and no window param, the sparkline must still have a multi-day axis. */
    @Test
    public void defaultStateSparklineGetsAWiderAxisThanThePin() {
        JsonNode merged = merge(createdTodayBase(), "{\"series\":\"daily\"}");

        assertEquals("last_30d", merged.path("window").path("name").asText(),
                "a pinned dtd axis would bucket the whole trend into one point");
        assertFalse(merged.path("window").path("pinned").asBoolean(false),
                "the series axis is a trend, not the pin");
    }

    /** An explicit window param IS meaningful for the series axis, so it is honoured there. */
    @Test
    public void windowParamSetsTheSparklineAxis() {
        JsonNode merged = merge(createdTodayBase(), "{\"series\":\"daily\",\"window\":\"last_7d\"}");
        assertEquals("last_7d", merged.path("window").path("name").asText());
    }

    /** The pin is resolved once and baked in, so the planner cannot re-resolve it on a later clock. */
    @Test
    public void pinnedWindowIsMaterializedNotLeftForThePlanner() {
        // NB: an empty params object returns the base query untouched (pre-existing short-circuit),
        // in which case the planner resolves the window itself — still a single clock read. The
        // materialization contract applies once any param triggers a merge.
        assertEquals(createdTodayBase().toString(), merge(createdTodayBase(), "{}").toString(),
                "empty params must remain a no-op");
        JsonNode merged = merge(createdTodayBase(), "{\"serviceCode\":\"Pothole\"}");
        assertFalse(merged.has("window"), "the window must be consumed into explicit bounds");
        AnalyticsPlanner.Planned p = planner.plan(merged, stateScope, CAL);
        assertTrue(p.sql.contains("created_at >= ?") && p.sql.contains("created_at < ?"),
                "materialized bounds must still produce the same bounded predicate: " + p.sql);
    }

    // ---- regression guard: unpinned defs are untouched ----

    /** Every other tile must keep letting the global range govern its time axis. */
    @Test
    public void unpinnedDefsStillHonourTheDateRange() {
        LocalDate t = today();
        JsonNode merged = merge(unpinnedBase(),
                "{\"dateFrom\":\"" + t.minusDays(30) + "\",\"dateTo\":\"" + t + "\"}");

        assertFalse(merged.has("window"), "range must still remove an unpinned window");
        // Bounds are computed in the resolved TENANT zone (EAT here), not UTC (#29) — a range
        // dateFrom/dateTo is a local calendar date wherever the tenant is configured.
        assertEquals(t.minusDays(30).atStartOfDay(EAT).toInstant().toEpochMilli(),
                merged.path("filters").path("created_at").path("gte").asLong());
        assertFalse(suppressed(merged), "unpinned defs are never suppressed");
    }

    /** Including when the selected range is nowhere near today. */
    @Test
    public void unpinnedDefsAreNeverSuppressed() {
        JsonNode merged = merge(unpinnedBase(), "{\"dateFrom\":\"2020-01-01\",\"dateTo\":\"2020-01-31\"}");
        assertFalse(suppressed(merged));
    }

    @Test
    public void unpinnedWindowParamOverrideStillWorks() {
        JsonNode merged = merge(unpinnedBase(), "{\"window\":\"mtd\"}");
        assertEquals("mtd", merged.path("window").path("name").asText());
        assertEquals("filed_at", merged.path("window").path("timeRole").asText(),
                "the timeRole must be preserved across a window override");
    }
}
