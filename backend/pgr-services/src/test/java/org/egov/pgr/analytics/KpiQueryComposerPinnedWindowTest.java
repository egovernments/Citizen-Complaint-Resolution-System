package org.egov.pgr.analytics;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

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
 */
public class KpiQueryComposerPinnedWindowTest {

    private static final ZoneId EAT = ZoneId.of("Africa/Nairobi");

    private final ObjectMapper om = new ObjectMapper();
    private final AnalyticsCatalog catalog = new AnalyticsCatalog();
    private final KpiQueryComposer composer = new KpiQueryComposer(catalog);
    private final AnalyticsPlanner planner = new AnalyticsPlanner(catalog);
    private final AnalyticsScope stateScope = new AnalyticsScope("ke", true, null, null, null);

    private JsonNode json(String s) {
        try { return om.readTree(s); } catch (Exception e) { throw new RuntimeException(e); }
    }

    private LocalDate today() { return Instant.now().atZone(EAT).toLocalDate(); }

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
        return composer.mergeParams(base, json(params), new ArrayList<>());
    }

    private boolean suppressed(JsonNode merged) {
        return merged.path("__suppressed").asBoolean(false);
    }

    // ---- the dtd window itself ----

    /** dtd is the calendar day in EAT — NOT last_1d's rolling 24h, which drifts across midnight. */
    @Test
    public void dtdIsTheCalendarDayNotARollingDay() {
        long now = System.currentTimeMillis();
        long dtd = AnalyticsPlanner.windowStartMs("dtd", now);
        long rolling = AnalyticsPlanner.windowStartMs("last_1d", now);

        assertEquals(today().atStartOfDay(EAT).toInstant().toEpochMilli(), dtd,
                "dtd must start at EAT midnight of the current day");
        assertEquals(now - 86_400_000L, rolling, "last_1d must remain a rolling 24h window");
        assertTrue(dtd >= rolling, "midnight today is never earlier than 24h ago");
    }

    /** dtd plans into a real time predicate, so a pinned tile still filters on its own axis. */
    @Test
    public void dtdPlansIntoATimePredicate() {
        AnalyticsPlanner.Planned p = planner.plan(createdTodayBase(), stateScope);
        assertTrue(p.sql.contains("created_at >= ?") && p.sql.contains("created_at < ?"),
                "expected a bounded created_at predicate, got: " + p.sql);
    }

    @Test
    public void unknownWindowNameStillRejected() {
        assertThrows(IllegalArgumentException.class,
                () -> AnalyticsPlanner.windowStartMs("dtd_", System.currentTimeMillis()));
    }

    // ---- pinning beats the dashboard globals ----

    /** The whole bug: a selected range must not redefine what "today" means. */
    @Test
    public void dateRangeDoesNotRewriteAPinnedWindow() {
        LocalDate t = today();
        JsonNode merged = merge(createdTodayBase(),
                "{\"dateFrom\":\"" + t.minusDays(30) + "\",\"dateTo\":\"" + t + "\"}");

        assertEquals("dtd", merged.path("window").path("name").asText(),
                "pinned window must survive the global range");
        assertFalse(merged.has("filters"),
                "no created_at range filter may be injected over a pinned window");
        assertFalse(suppressed(merged), "the range contains today, so the tile is answerable");
    }

    /** The window param (the FE's per-tile default) must not override a pin either. */
    @Test
    public void windowParamDoesNotOverrideAPinnedWindow() {
        JsonNode merged = merge(createdTodayBase(), "{\"window\":\"last_30d\"}");
        assertEquals("dtd", merged.path("window").path("name").asText());
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
        AnalyticsPlanner.Planned p = planner.plan(merged, stateScope);
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
        assertEquals("dtd", merged.path("window").path("name").asText());
    }

    // ---- regression guard: unpinned defs are untouched ----

    /** Every other tile must keep letting the global range govern its time axis. */
    @Test
    public void unpinnedDefsStillHonourTheDateRange() {
        LocalDate t = today();
        JsonNode merged = merge(unpinnedBase(),
                "{\"dateFrom\":\"" + t.minusDays(30) + "\",\"dateTo\":\"" + t + "\"}");

        assertFalse(merged.has("window"), "range must still remove an unpinned window");
        assertEquals(t.minusDays(30).atStartOfDay(java.time.ZoneOffset.UTC).toInstant().toEpochMilli(),
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
