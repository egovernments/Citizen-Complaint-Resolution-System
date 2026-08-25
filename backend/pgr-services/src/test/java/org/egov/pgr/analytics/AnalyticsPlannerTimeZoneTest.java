package org.egov.pgr.analytics;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.time.ZoneId;
import java.time.ZonedDateTime;

import static org.junit.jupiter.api.Assertions.*;

/**
 * #29: pins the analytics calendar at the planner boundary — named windows resolve day
 * boundaries at the RESOLVED TENANT zone's midnight (not UTC, not a hardcoded EAT), across a
 * whole-hour offset (Africa/Nairobi, Africa/Maputo) and a non-whole-hour offset (Asia/Kolkata,
 * UTC+5:30), survive a DST transition without throwing, and the runtime {@code timeBucket} SQL
 * binds the resolved zone as a JDBC param at the correct position (never string-concatenated).
 */
public class AnalyticsPlannerTimeZoneTest {

    private final ObjectMapper om = new ObjectMapper();
    private final AnalyticsCatalog catalog = new AnalyticsCatalog();
    private final AnalyticsPlanner planner = new AnalyticsPlanner(catalog);
    private final AnalyticsScope stateScope = new AnalyticsScope("ke", true, null, null, null);

    private JsonNode json(String s) {
        try { return om.readTree(s); } catch (Exception e) { throw new RuntimeException(e); }
    }

    // ---- named windows resolve day boundaries at the TENANT zone's midnight ----

    /**
     * One fixed UTC instant (22:30 UTC) is already "tomorrow" in Asia/Kolkata (UTC+5:30, local
     * 04:00 next day) but still "today" in Africa/Nairobi (UTC+3, local 01:30 next day... actually
     * also tomorrow) and Africa/Maputo (UTC+2). Pick an instant where the three zones disagree on
     * the calendar day to prove {@code dtd} is genuinely zone-sensitive, not a UTC day dressed up.
     */
    @Test
    public void dtdMidnightIsTheResolvedZonesLocalDayNotUtcs() {
        // 2024-06-14T21:30:00Z: Nairobi (+3) & Maputo (+2) are still June 15 00:30/23:30... pick
        // precisely so each zone's local date differs. Use 20:30 UTC on 2024-06-14:
        //   Nairobi (+3) -> 2024-06-14 23:30 local -> "today" = 2024-06-14
        //   Kolkata (+5:30) -> 2024-06-15 02:00 local -> "today" = 2024-06-15
        long now = Instant.parse("2024-06-14T20:30:00Z").toEpochMilli();

        ZoneId nairobi = ZoneId.of("Africa/Nairobi");
        ZoneId kolkata = ZoneId.of("Asia/Kolkata");

        long dtdNairobi = AnalyticsPlanner.windowStartMs("dtd", now, nairobi);
        long dtdKolkata = AnalyticsPlanner.windowStartMs("dtd", now, kolkata);

        assertEquals(java.time.LocalDate.of(2024, 6, 14),
                Instant.ofEpochMilli(dtdNairobi).atZone(nairobi).toLocalDate());
        assertEquals(java.time.LocalDate.of(2024, 6, 15),
                Instant.ofEpochMilli(dtdKolkata).atZone(kolkata).toLocalDate());
        assertNotEquals(dtdNairobi, dtdKolkata,
                "the same instant must resolve to two different local midnights in two different zones");
    }

    /** Africa/Maputo (UTC+2) vs Africa/Nairobi (UTC+3): a one-hour offset difference must shift dtd by exactly 1h. */
    @Test
    public void oneHourOffsetDifferenceShiftsDtdByExactlyOneHour() {
        long now = Instant.parse("2024-06-15T12:00:00Z").toEpochMilli();
        long dtdNairobi = AnalyticsPlanner.windowStartMs("dtd", now, ZoneId.of("Africa/Nairobi"));
        long dtdMaputo = AnalyticsPlanner.windowStartMs("dtd", now, ZoneId.of("Africa/Maputo"));
        // Nairobi's clock reads 1h ahead of Maputo's, so Nairobi's local midnight occurs 1h
        // EARLIER in absolute/UTC time than Maputo's local midnight for the same instant.
        assertEquals(3_600_000L, dtdMaputo - dtdNairobi,
                "Maputo's local midnight is exactly 1h after Nairobi's for the same UTC instant");
    }

    /** Asia/Kolkata's UTC+5:30 offset is not a whole hour — dtd must still land exactly on local midnight. */
    @Test
    public void nonWholeHourOffsetStillLandsOnExactLocalMidnight() {
        ZoneId kolkata = ZoneId.of("Asia/Kolkata");
        long now = ZonedDateTime.of(2024, 6, 15, 14, 45, 0, 0, kolkata).toInstant().toEpochMilli();
        long dtd = AnalyticsPlanner.windowStartMs("dtd", now, kolkata);
        assertEquals(ZonedDateTime.of(2024, 6, 15, 0, 0, 0, 0, kolkata).toInstant().toEpochMilli(), dtd);
        // sanity: the offset itself is +5:30, not a whole hour
        assertEquals(5 * 3_600_000L + 30 * 60_000L,
                kolkata.getRules().getOffset(Instant.ofEpochMilli(now)).getTotalSeconds() * 1000L);
    }

    /** wtd/mtd must resolve at the SAME resolved-zone midnight semantics as dtd, not UTC. */
    @Test
    public void wtdAndMtdAlsoResolveAtTheResolvedZonesMidnight() {
        ZoneId kolkata = ZoneId.of("Asia/Kolkata");
        // 2024-06-15 is a Saturday; the week (Monday-start) began 2024-06-10.
        long now = ZonedDateTime.of(2024, 6, 15, 1, 0, 0, 0, kolkata).toInstant().toEpochMilli();
        long wtd = AnalyticsPlanner.windowStartMs("wtd", now, kolkata);
        long mtd = AnalyticsPlanner.windowStartMs("mtd", now, kolkata);
        assertEquals(ZonedDateTime.of(2024, 6, 10, 0, 0, 0, 0, kolkata).toInstant().toEpochMilli(), wtd);
        assertEquals(ZonedDateTime.of(2024, 6, 1, 0, 0, 0, 0, kolkata).toInstant().toEpochMilli(), mtd);
    }

    // ---- DST transition ----

    /**
     * America/New_York springs forward 2024-03-10 (02:00 -> 03:00 local, clocks skip 2:00-3:00am).
     * Midnight itself is unaffected by the spring-forward gap, so dtd on the transition day and the
     * day after must still resolve cleanly (no throw, correct calendar date) even though the
     * transition day is only 23 wall-clock hours long.
     */
    @Test
    public void dstSpringForwardTransitionDoesNotBreakDtd() {
        ZoneId nyc = ZoneId.of("America/New_York");
        // Noon on transition day (America/New_York EST->EDT, 2024-03-10).
        long onTransitionDay = ZonedDateTime.of(2024, 3, 10, 12, 0, 0, 0, nyc).toInstant().toEpochMilli();
        long dtd = AnalyticsPlanner.windowStartMs("dtd", onTransitionDay, nyc);
        assertEquals(java.time.LocalDate.of(2024, 3, 10),
                Instant.ofEpochMilli(dtd).atZone(nyc).toLocalDate());

        // The day after: the elapsed wall-clock time from the prior midnight is only 23h, but dtd
        // must still be exactly the NEXT calendar midnight, not offset by the missing hour.
        long dayAfter = ZonedDateTime.of(2024, 3, 11, 12, 0, 0, 0, nyc).toInstant().toEpochMilli();
        long dtdAfter = AnalyticsPlanner.windowStartMs("dtd", dayAfter, nyc);
        assertEquals(ZonedDateTime.of(2024, 3, 11, 0, 0, 0, 0, nyc).toInstant().toEpochMilli(), dtdAfter);
        // The two midnights are 23h apart in absolute time (the skipped hour), not 24h.
        assertEquals(23 * 3_600_000L, dtdAfter - dtd);
    }

    /** last_Nd stays a pure rolling-24h-multiple window, unaffected by DST (by design, unlike dtd/wtd/mtd). */
    @Test
    public void rollingWindowIsUnaffectedByDst() {
        ZoneId nyc = ZoneId.of("America/New_York");
        long now = ZonedDateTime.of(2024, 3, 11, 12, 0, 0, 0, nyc).toInstant().toEpochMilli();
        assertEquals(now - 86_400_000L, AnalyticsPlanner.windowStartMs("last_1d", now, nyc));
    }

    /** A window whose interval spans the DST transition still plans into a valid, non-throwing query. */
    @Test
    public void windowSpanningADstTransitionStillPlans() {
        ZoneId nyc = ZoneId.of("America/New_York");
        long now = ZonedDateTime.of(2024, 3, 12, 9, 0, 0, 0, nyc).toInstant().toEpochMilli();
        BusinessCalendar calendar = BusinessCalendar.of(nyc, now);
        JsonNode q = json("{\"grain\":\"facts\",\"window\":{\"name\":\"last_7d\",\"timeRole\":\"filed_at\"},"
                + "\"measures\":[{\"name\":\"total\",\"agg\":\"count\"}]}");
        AnalyticsPlanner.Planned p = planner.plan(q, stateScope, calendar);
        assertTrue(p.sql.contains("created_at >= ?") && p.sql.contains("created_at < ?"));
        assertEquals(now - 7 * 86_400_000L, p.params.get(0));
    }

    // ---- timeBucket: the zone rides a JDBC-bound param, at the correct position ----

    @Test
    public void timeBucketBindsZoneAsFirstParamBeforeSelectAndWhereParams() {
        ZoneId kolkata = ZoneId.of("Asia/Kolkata");
        long now = ZonedDateTime.of(2024, 6, 15, 12, 0, 0, 0, kolkata).toInstant().toEpochMilli();
        BusinessCalendar calendar = BusinessCalendar.of(kolkata, now);

        JsonNode q = json("{\"grain\":\"facts\","
                + "\"dimensions\":[\"ward_code\"],"
                + "\"window\":{\"name\":\"last_7d\",\"timeRole\":\"filed_at\",\"timeBucket\":\"day\"},"
                + "\"filters\":{\"ward_code\":{\"eq\":\"W1\"}},"
                + "\"measures\":[{\"name\":\"total\",\"agg\":\"count\",\"filter\":{\"is_open\":{\"eq\":true}}}]}");
        AnalyticsPlanner.Planned p = planner.plan(q, stateScope, calendar);

        // The zone id is interpolated as a bound '?' inside the AT TIME ZONE expression — never
        // string-concatenated into the SQL text itself.
        assertTrue(p.sql.contains("AT TIME ZONE ?::text"), p.sql);
        assertFalse(p.sql.contains(kolkata.getId()), "zone id must never appear literally in the SQL text");

        // Placeholder count must exactly match the bound param count (no drift).
        long placeholders = p.sql.chars().filter(c -> c == '?').count();
        assertEquals(placeholders, p.params.size(), "every '?' must have exactly one bound param: " + p.sql);

        // Param order mirrors left-to-right '?' appearance in the assembled SQL: the timeBucket's
        // zone (first '?', in SELECT) precedes the measure's FILTER predicate (SELECT), which
        // precedes the WHERE-clause params (explicit filter, window bounds, RBAC scope).
        assertEquals(kolkata.getId(), p.params.get(0), "zone must be the first bound param");
        assertEquals(true, p.params.get(1), "measure FILTER predicate binds next, still inside SELECT");
        assertEquals("W1", p.params.get(2), "explicit filter is the first WHERE param");
        // window gte/lt bounds follow, then the RBAC tenant-scope param last.
        assertEquals(now - 7 * 86_400_000L, p.params.get(3));
        assertEquals(now, p.params.get(4));
        assertEquals("ke%", p.params.get(5));
        assertEquals(6, p.params.size());
    }

    @Test
    public void timeBucketOnSqlDateColumnNeedsNoZoneParam() {
        // daily.snapshot_date is a SQL date, not epoch-ms — no AT TIME ZONE conversion, so no
        // zone-binding param is added for the bucket expression at all.
        BusinessCalendar calendar = BusinessCalendar.of(ZoneId.of("Africa/Nairobi"), 1_700_000_000_000L);
        JsonNode q = json("{\"grain\":\"daily\","
                + "\"window\":{\"timeBucket\":\"day\"},"
                + "\"measures\":[{\"name\":\"open\",\"agg\":\"count\"}]}");
        AnalyticsPlanner.Planned p = planner.plan(q, stateScope, calendar);
        assertFalse(p.sql.contains("AT TIME ZONE"), p.sql);
        long placeholders = p.sql.chars().filter(c -> c == '?').count();
        assertEquals(placeholders, p.params.size());
    }
}
