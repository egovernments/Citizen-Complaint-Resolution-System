package org.egov.pgr.analytics;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import lombok.extern.slf4j.Slf4j;
import org.egov.pgr.analytics.AnalyticsCatalog.Grain;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.time.format.DateTimeParseException;
import java.time.temporal.TemporalAdjusters;

/**
 * Param-merge for the kpiId-by-reference analytics path.
 *
 * <p>A KPI definition stores a fixed base query (grammar against a single grain). The dashboard,
 * however, has a row of <em>global</em> filters (date range / window, ward, service type) that the
 * user sets once and that must apply to <em>every</em> tile. The inline-query FE used to bake these
 * into each query body before sending; this composer reproduces that exact transform server-side so
 * the FE can send {@code {kpiId, params}} and let the BE apply the globals.
 *
 * <p>This mirrors the FE transform in
 * {@code frontend/micro-ui/web/src/dashboard/config/kpiQueries.js}
 * — {@code applyDashboardFiltersToQuery()} (~line 1391) and its helpers
 * {@code buildGlobalApiFilters()} (~1367), {@code dateFilterColumnForQuery()} (~1338),
 * {@code mergeQueryFilters()} (~1326), {@code snapshotDateRangeFilter()} (~1353).
 *
 * <p>Supported params (names match what the FE sends):
 * <ul>
 *   <li>{@code window} — a window name (e.g. {@code last_7d}, {@code wtd}, {@code mtd},
 *       {@code last_30d}). Overrides {@code query.window.name}, preserving the existing
 *       {@code timeRole}. Mutually exclusive with an explicit date range (range wins, per the FE,
 *       which deletes {@code window} when a range is set).</li>
 *   <li>{@code dateFrom} + {@code dateTo} (ISO {@code yyyy-MM-dd}) — an explicit, inclusive date
 *       range. Mapped to a {@code gte}/{@code lt} filter on the grain's time column (the same
 *       column the planner's window targets): epoch-ms bounds for facts/events, ISO-date bounds
 *       for the daily snapshot grain. The base {@code window} is removed so the range fully governs
 *       the time axis (exactly as the FE does).</li>
 *   <li>{@code ward} — a boundary/ward code; narrows to {@code ward_code = ?} <em>iff</em> the grain
 *       has a filterable {@code ward_code}. A client narrowing WITHIN the user's RBAC scope; it can
 *       never widen (row-scope is still injected on top by {@link AnalyticsPlanner#plan}).</li>
 *   <li>{@code serviceCode} — a complaint type; narrows to {@code service_code = ?} iff filterable.</li>
 *   <li>{@code compare: "prior"} — instead of the selected/default range, apply the
 *       <em>immediately-preceding equal-duration</em> range on the def's time column. Mirrors the FE
 *       {@code priorPeriodCreatedAtFilter()} (~1586) / {@code priorPeriodEndDateIso()} (~1360) and the
 *       no-range {@code priorWeekCreatedAtFilter()} (~1417) fallback. Collapses the ~30 FE
 *       {@code *_prior} query keys into one def + {@code {compare:"prior"}}.</li>
 *   <li>{@code hierLevel} — complaint-hierarchy rollup level (#1111). {@code "leaf"} / absent /
 *       empty = no-op (today's per-subtype buckets). {@code "1".."12"} rewrites every
 *       {@code service_code} dimension to the fixed level expression over
 *       {@code complaint_node_path} (aliased {@code AS service_code}, so viz/sort/columns are
 *       unchanged) and drops any {@code service_group} dimension (at a rolled-up level it
 *       collapses into a duplicate of the level bucket). Grains without the path column (daily)
 *       no-op gracefully, like {@code ward}. Aggregates recompute over raw rows, so averages and
 *       ratios are correctly weighted — never an average of leaf averages.</li>
 *   <li>{@code series: "daily"} — turn a scalar tile into a daily time series: add the grain's daily
 *       date dimension (+ ascending sort), apply the selected range, drop the base window, and cap
 *       {@code limit} to {@code min(366, dayCount)}. Mirrors the FE {@code *_sparkline} keys
 *       (base query carries the date dimension; {@code applyOverTimeChartQueries} ~1810 /
 *       {@code countDaysInDateRange} ~1484 set the limit). Collapses the ~10 FE {@code *_sparkline}
 *       keys into one def + {@code {series:"daily"}}.</li>
 * </ul>
 *
 * <p>{@code compare}/{@code series} compose with {@code window}/{@code dateFrom}/{@code dateTo}/
 * {@code ward}/{@code serviceCode}: the window/range params resolve the <em>current</em> range first,
 * then {@code compare:"prior"} shifts it back one equal period, and {@code series:"daily"} buckets it.
 *
 * <p>All injected predicates ride the planner's existing parameterized {@code filters} mechanism
 * (bound JDBC params, whitelisted against {@link AnalyticsCatalog}). Unknown / inapplicable params
 * are skipped gracefully — never thrown, never string-concatenated into SQL. The inline path
 * (no {@code kpiId}) never reaches this class and is unchanged.
 */
@Component
@Slf4j
public class KpiQueryComposer {

    /** Dashboard canonical zone (UTC+3), matching {@link AnalyticsPlanner}'s EAT for window math. */
    private static final ZoneId EAT = ZoneId.of("Africa/Nairobi");
    private static final long MS_PER_DAY = 86_400_000L;
    /** Sparkline daily-series safety cap, matching the FE {@code Math.min(366, ...)}. */
    private static final int MAX_SERIES_DAYS = 366;

    private final AnalyticsCatalog catalog;

    @Autowired
    public KpiQueryComposer(AnalyticsCatalog catalog) { this.catalog = catalog; }

    /**
     * Produce the effective query by layering the request's {@code params} (dashboard globals) onto
     * the def's base {@code query}. Returns the base query unchanged when {@code params} is absent /
     * empty. Never mutates {@code baseQuery}.
     */
    public JsonNode mergeParams(JsonNode baseQuery, JsonNode params) {
        if (baseQuery == null || !baseQuery.isObject()) return baseQuery;
        if (params == null || !params.isObject() || params.size() == 0) return baseQuery;

        // Resolve the grain so we can (a) pick the time column and (b) gate ward/service narrowing.
        String grainName = baseQuery.hasNonNull("grain") ? baseQuery.get("grain").asText() : inferGrain(baseQuery);
        Grain g = catalog.grain(grainName);
        if (g == null) return baseQuery;   // planner will reject; don't mask the error here.

        ObjectNode next = (ObjectNode) baseQuery.deepCopy();

        boolean hasDateRange = params.hasNonNull("dateFrom") && params.hasNonNull("dateTo");
        boolean prior  = "prior".equals(textOrNull(params, "compare"));
        boolean series = "daily".equals(textOrNull(params, "series"));

        // Resolve the selected/current range (epoch-ms, half-open) if one is set. compare/series both
        // operate on these bounds; null means "no explicit range" (rolling window or whole-history).
        // C2: a present-but-unparseable dateFrom/dateTo must NOT silently fall back to the base/window
        // query (that returned the wrong, un-narrowed scalar). Surface a per-entry invalid_param instead.
        Bounds bounds = hasDateRange
                ? parseBounds(params.get("dateFrom").asText(), params.get("dateTo").asText())
                : null;
        if (hasDateRange && bounds == null)
            throw new IllegalArgumentException("invalid_param: dateFrom/dateTo is not a valid yyyy-MM-dd range");

        // A "live open snapshot" is a point-in-time count of currently-open complaints
        // (filters.is_open, non-daily grain, no base time window). The reference dashboard
        // (sanitizeLiveOpenSnapshotQueries) leaves these UN-narrowed by the global date
        // range/window — "Breached SLA (open)", "Open complaints", the open-state charts and
        // at-risk table are NOW snapshots, not time-bounded cohorts. So the current/base query
        // ignores window + dateFrom/dateTo. (compare:prior and series:daily still apply: the
        // delta uses a prior-week comparison and the sparkline a rolling window, per reference.)
        boolean liveOpenSnapshot = isLiveOpenSnapshot(next, g);

        // ---- window override (skipped when an explicit range is supplied; range governs time) ----
        // Also skipped for compare:"prior" with no range, where the prior-WEEK fallback governs time,
        // and for live-open snapshots (point-in-time; no window axis).
        if (!hasDateRange && !prior && !liveOpenSnapshot && params.hasNonNull("window")) {
            String windowName = params.get("window").asText();
            if (!windowName.isEmpty()) applyWindowName(next, windowName);
        }

        if (prior) {
            // ---- prior-period: shift the (selected | default-week) range back one equal duration ----
            applyPrior(next, g, bounds);
        } else if (bounds != null && !liveOpenSnapshot) {
            // ---- explicit date range -> gte/lt filter on the grain's time column ----
            applyDateRange(next, g, bounds);
        }

        // ---- daily series (sparkline): add the daily date dimension, sort, cap limit ----
        // compare:"prior" yields a single scalar (the prior period's value), so it never co-exists with
        // a series; if both are sent, prior wins and series is ignored (no FE widget asks for both).
        if (series && !prior) {
            applyDailySeries(next, g, bounds);
        }

        // ---- narrowing dimension filters (only if the grain supports the column) ----
        if (params.hasNonNull("ward")) {
            String ward = params.get("ward").asText();
            if (!ward.isEmpty() && !"all".equals(ward)) applyEqFilter(next, g, "ward_code", ward);
        }
        if (params.hasNonNull("serviceCode")) {
            String svc = params.get("serviceCode").asText();
            if (!svc.isEmpty() && !"all".equals(svc)) applyEqFilter(next, g, "service_code", svc);
        }

        // ---- hierarchy-level rollup (#1111): rewrite service_code dimensions to the level expr ----
        if (params.hasNonNull("hierLevel")) {
            String hierLevel = params.get("hierLevel").asText();
            if (!hierLevel.isEmpty() && !"leaf".equals(hierLevel)) applyHierLevel(next, g, hierLevel);
        }

        return next;
    }

    // ---- window ----

    /**
     * Override {@code window.name}, preserving the existing {@code timeRole}/{@code timeBucket}. The
     * planner ({@link AnalyticsPlanner#applyWindow}) validates the name and translates it to a time
     * predicate, so an unknown name surfaces as the planner's {@code invalid_param} just like an
     * inline query — we deliberately do not pre-validate the name set here.
     */
    private void applyWindowName(ObjectNode query, String windowName) {
        ObjectNode window = query.has("window") && query.get("window").isObject()
                ? (ObjectNode) query.get("window")
                : query.putObject("window");
        window.put("name", windowName);
    }

    // ---- date range ----

    /** Half-open epoch-ms range [fromMs, toMs), with the inclusive ISO start/end dates retained. */
    private static final class Bounds {
        final LocalDate fromDate;       // inclusive
        final LocalDate toExclusive;    // exclusive (day after dateTo)
        final long fromMs;              // UTC-midnight epoch-ms of fromDate (FE isoDateToStartMs)
        final long toMs;                // UTC-midnight epoch-ms of toExclusive (FE isoDateToEndExclusiveMs)
        Bounds(LocalDate fromDate, LocalDate toExclusive) {
            this.fromDate = fromDate; this.toExclusive = toExclusive;
            this.fromMs = fromDate.atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli();
            this.toMs   = toExclusive.atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli();
        }
        long durationMs() { return toMs - fromMs; }
        /** FE countDaysInDateRange: max(1, ceil(duration / day)). */
        int dayCount() { return (int) Math.max(1, (durationMs() + MS_PER_DAY - 1) / MS_PER_DAY); }
    }

    /** Parse the FE {@code dateFrom}/{@code dateTo} (ISO, inclusive) into half-open {@link Bounds}; null if unparseable. */
    private Bounds parseBounds(String dateFrom, String dateTo) {
        try {
            LocalDate from = LocalDate.parse(dateFrom);
            LocalDate toExclusive = LocalDate.parse(dateTo).plusDays(1);
            if (toExclusive.isBefore(from)) return null;   // nonsensical range
            return new Bounds(from, toExclusive);
        } catch (DateTimeParseException ex) {
            log.debug("ignoring date range with unparseable bounds dateFrom='{}' dateTo='{}'", dateFrom, dateTo);
            return null;
        }
    }

    /**
     * Mirror the FE's {@code applyDashboardFiltersToQuery}: choose the grain's time column, drop the
     * base {@code window}, and add a {@code gte}/{@code lt} predicate over {@code bounds}. Bounds are
     * half-open, matching {@code isoDateToStartMs}/{@code isoDateToEndExclusiveMs}.
     */
    private void applyDateRange(ObjectNode query, Grain g, Bounds bounds) {
        String col = dateFilterColumn(query, g);
        if (col == null || !g.filterable.contains(col)) {
            log.debug("grain '{}' has no filterable time column for a date range; skipping", g.name);
            return;
        }
        bindRange(query, col, bounds.fromDate, bounds.toExclusive, bounds.fromMs, bounds.toMs);
        // Range fully governs the time axis -> remove the base window (parity with the FE).
        query.remove("window");
    }

    /**
     * Bind a half-open range to {@code col}: ISO date strings for the daily {@code snapshot_date}
     * (FE {@code snapshotDateRangeFilter}), epoch-ms otherwise (FE {@code isoDate*Ms}).
     */
    private void bindRange(ObjectNode query, String col, LocalDate from, LocalDate toExclusive, long fromMs, long toMs) {
        ObjectNode bound = mergeableFilterObject(query, col);
        if ("snapshot_date".equals(col)) {
            bound.put("gte", from.toString());
            bound.put("lt", toExclusive.toString());
        } else {
            bound.put("gte", fromMs);
            bound.put("lt", toMs);
        }
    }

    // ---- prior period ----

    /**
     * Apply the immediately-preceding equal-duration range on the def's time column.
     *
     * <p>With an explicit {@code bounds}: mirrors the FE {@code priorPeriodCreatedAtFilter}
     * ({@code {gte: from-duration, lt: from}}, ~1586) for facts/events, and
     * {@code priorPeriodEndDateIso} (the single day before the range start, ~1360) for the daily grain.
     *
     * <p>With no range: mirrors the FE no-{@code __dateRange} fallback (~1973) — the prior calendar
     * week ({@code priorPeriodWeek}, last-Monday .. this-Monday), computed in EAT to match the
     * planner's window zone.
     */
    private void applyPrior(ObjectNode query, Grain g, Bounds bounds) {
        String col = dateFilterColumn(query, g);
        if (col == null || !g.filterable.contains(col)) {
            log.debug("grain '{}' has no filterable time column for compare:prior; skipping", g.name);
            return;
        }

        if (bounds == null) {
            // ---- default prior-WEEK fallback (FE priorWeekCreatedAtFilter ~1417) ----
            if ("snapshot_date".equals(col)) {
                // No FE analogue for a daily prior-week scalar; the day before this-Monday is the
                // closest faithful "preceding snapshot". Bind the single prior day.
                LocalDate thisMonday = eatThisMonday();
                ObjectNode bound = mergeableFilterObject(query, col);
                bound.put("eq", thisMonday.minusDays(1).toString());
            } else {
                long[] wk = priorWeekMs();
                ObjectNode bound = mergeableFilterObject(query, col);
                bound.put("gte", wk[0]);
                bound.put("lt", wk[1]);
            }
            query.remove("window");
            return;
        }

        ObjectNode bound = mergeableFilterObject(query, col);
        if ("snapshot_date".equals(col)) {
            // FE priorPeriodEndDateIso: a point snapshot on the day before the range start.
            bound.put("eq", bounds.fromDate.minusDays(1).toString());
        } else {
            // FE priorPeriodCreatedAtFilter: equal-duration window ending at the range start.
            bound.put("gte", bounds.fromMs - bounds.durationMs());
            bound.put("lt",  bounds.fromMs);
        }
        query.remove("window");
    }

    /** This calendar week's Monday 00:00 in EAT, mirroring the FE local-time Monday. */
    private LocalDate eatThisMonday() {
        return ZonedDateTime.now(EAT).toLocalDate().with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
    }

    /** Epoch-ms [lastMonday, thisMonday) in EAT — the FE priorWeekCreatedAtFilter equivalent. */
    private long[] priorWeekMs() {
        LocalDate thisMonday = eatThisMonday();
        LocalDate lastMonday = thisMonday.minusDays(7);
        long lo = lastMonday.atStartOfDay(EAT).toInstant().toEpochMilli();
        long hi = thisMonday.atStartOfDay(EAT).toInstant().toEpochMilli();
        return new long[]{ lo, hi };
    }

    // ---- daily series (sparkline) ----

    /**
     * Turn a scalar tile into a daily time series: add the grain's daily date dimension (+ ascending
     * sort), apply {@code bounds} (if any), drop the base window, and cap {@code limit} to
     * {@code min(366, dayCount)}.
     *
     * <p>Mirrors the FE {@code *_sparkline} defs, which carry the date dimension in the base query
     * ({@code created_date} on facts, {@code occurred_date} on events, {@code snapshot_date} on daily)
     * and whose limit is set to {@code Math.min(366, countDaysInDateRange(bounds))} (~1810/1854).
     * The date dimension is a precomputed groupable column (not the planner timeBucket), exactly as
     * the FE base sparkline queries express it.
     */
    private void applyDailySeries(ObjectNode query, Grain g, Bounds bounds) {
        String dim = dailyDimension(g);
        if (dim == null || !g.groupable.contains(dim)) {
            log.debug("grain '{}' has no daily date dimension; skipping series:daily", g.name);
            return;
        }

        // Add the date dimension if absent (idempotent — base sparkline-style defs may already carry it).
        ArrayNode dims = query.has("dimensions") && query.get("dimensions").isArray()
                ? (ArrayNode) query.get("dimensions")
                : query.putArray("dimensions");
        boolean present = false;
        for (JsonNode d : dims) if (dim.equals(d.asText())) { present = true; break; }
        if (!present) dims.add(dim);

        // Ascending sort on the date dimension if no sort already references it.
        ArrayNode sort = query.has("sort") && query.get("sort").isArray()
                ? (ArrayNode) query.get("sort")
                : query.putArray("sort");
        boolean sorted = false;
        for (JsonNode s : sort) if (dim.equals(s.path("by").asText(null))) { sorted = true; break; }
        if (!sorted) {
            ObjectNode s = sort.addObject();
            s.put("by", dim);
            s.put("dir", "asc");
        }

        // Apply the range over the daily dimension's OWN time axis, then drop the base window.
        if (bounds != null) {
            String col = seriesRangeColumn(query, g);
            if (col != null && g.filterable.contains(col)) {
                bindRange(query, col, bounds.fromDate, bounds.toExclusive, bounds.fromMs, bounds.toMs);
                query.remove("window");
            }
            query.put("limit", Math.min(MAX_SERIES_DAYS, bounds.dayCount()));
        } else {
            // No range: keep the (rolling/whole-history) window already on the query; just cap the cap.
            query.put("limit", MAX_SERIES_DAYS);
        }
    }

    /**
     * The time column a daily series ranges on. For the {@code events} grain this is {@code entered_at}
     * — the event's own time, which the {@code occurred_date} dimension derives from — mirroring the FE
     * {@code applyEnteredAtDateRangeToQuery} for the events sparkline (NOT the {@code complaint_created_at}
     * the scalar global filter uses). For facts/daily it follows {@link #dateFilterColumn}, so a def can
     * range on {@code resolved_at} by carrying {@code window.timeRole:"resolved_at"} (mirroring the FE
     * {@code applyResolvedAtDateRangeToQuery} sparklines, e.g. {@code cl_resolved_on_time_rate_sparkline}).
     */
    private String seriesRangeColumn(JsonNode query, Grain g) {
        if ("events".equals(g.name)) return "entered_at";
        return dateFilterColumn(query, g);
    }

    /** The precomputed daily date dimension per grain: facts/events/daily mirror the FE sparkline defs. */
    private String dailyDimension(Grain g) {
        switch (g.name) {
            case "events": return "occurred_date";
            case "daily":  return "snapshot_date";
            default:        return "created_date";   // facts
        }
    }

    /**
     * The time column a date range narrows, matching the FE's {@code dateFilterColumnForQuery}:
     * events -> {@code complaint_created_at}; daily -> {@code snapshot_date};
     * facts with a {@code resolved_at} timeRole -> {@code resolved_at}; otherwise {@code created_at}.
     */
    /**
     * A live open-state snapshot: a count of currently-open complaints with no time window
     * ({@code filters.is_open == true}, non-daily grain, no {@code window.timeRole}). These are
     * point-in-time metrics (breached-open, open-now, open-state charts, at-risk) that the
     * reference dashboard leaves un-narrowed by the global date range/window. The catalog-native
     * signal is the absence of a base window: a date-bounded open metric (e.g. open-this-week)
     * carries a window and is therefore NOT a live snapshot.
     */
    private boolean isLiveOpenSnapshot(JsonNode query, Grain g) {
        if (g == null || "daily".equals(g.name)) return false;
        JsonNode filters = query.get("filters");
        boolean isOpen = filters != null && filters.path("is_open").asBoolean(false);
        if (!isOpen) return false;
        JsonNode window = query.get("window");
        boolean hasTimeWindow = window != null && window.isObject() && window.hasNonNull("timeRole");
        return !hasTimeWindow;
    }

    private String dateFilterColumn(JsonNode query, Grain g) {
        if ("events".equals(g.name)) return "complaint_created_at";
        if ("daily".equals(g.name)) return "snapshot_date";
        JsonNode window = query.get("window");
        if (window != null && window.hasNonNull("timeRole") && "resolved_at".equals(window.get("timeRole").asText()))
            return "resolved_at";
        return "created_at";
    }

    // ---- hierarchy-level rollup (#1111) ----

    /**
     * Rewrite the query's {@code service_code} dimensions to the fixed hierarchy-level expression
     * (via the composer-internal marker only {@link AnalyticsPlanner} accepts — see
     * {@link AnalyticsCatalog#HIER_DIM_TOKEN}), grouping the tile by the Nth
     * {@code complaint_node_path} segment instead of the leaf. Rows with a NULL/empty path
     * (flat/legacy tenants) fall back to their leaf {@code service_code} inside the SQL expr, and
     * the level clamps to each row's own depth — both live in {@link AnalyticsCatalog#hierLevelExpr}.
     *
     * <p>Grains without the path column (daily) skip gracefully, exactly like {@code ward} on a
     * ward-less grain: the param is inapplicable, not an error. A malformed level, however, IS an
     * error ({@code invalid_param}) — silently serving leaf granularity for a level the caller
     * asked for would be a wrong answer, the same reasoning as C2's unparseable-date hard failure.
     *
     * <p>R4: when a rewrite happens, any {@code service_group} dimension (and sort referencing it)
     * is dropped — at a rolled-up level it collapses into a duplicate of the level bucket itself.
     * When the query carries no {@code service_code} dimension there is nothing to roll up
     * (scalar tiles), so the param is a no-op and {@code service_group} is left alone.
     */
    private void applyHierLevel(ObjectNode query, Grain g, String hierLevel) {
        if (!catalog.supportsHierLevel(g.name)) {
            log.debug("grain '{}' has no complaint_node_path; skipping hierLevel param", g.name);
            return;
        }
        int level;
        try {
            level = Integer.parseInt(hierLevel);
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException("invalid_param: hierLevel must be 'leaf' or an integer in 1.."
                    + AnalyticsCatalog.MAX_HIER_LEVEL);
        }
        if (level < 1 || level > AnalyticsCatalog.MAX_HIER_LEVEL)
            throw new IllegalArgumentException("invalid_param: hierLevel must be 'leaf' or an integer in 1.."
                    + AnalyticsCatalog.MAX_HIER_LEVEL);

        JsonNode dims = query.get("dimensions");
        if (dims == null || !dims.isArray()) return;
        boolean hasServiceCode = false;
        for (JsonNode d : dims) if (d.isTextual() && "service_code".equals(d.asText())) { hasServiceCode = true; break; }
        if (!hasServiceCode) return;   // nothing to roll up (scalar / other-dimension tiles)

        ArrayNode next = query.arrayNode();
        for (JsonNode d : dims) {
            if (d.isTextual() && "service_code".equals(d.asText())) {
                ObjectNode marker = next.addObject();
                marker.put(AnalyticsCatalog.HIER_DIM_LEVEL_FIELD, level);
                marker.put(AnalyticsCatalog.HIER_DIM_TOKEN_FIELD, AnalyticsCatalog.HIER_DIM_TOKEN);
            } else if (d.isTextual() && "service_group".equals(d.asText())) {
                // R4: dropped — duplicates the level bucket once service_code is rolled up.
            } else {
                next.add(d);
            }
        }
        query.set("dimensions", next);

        // Keep sort valid: a dropped service_group can no longer be sorted on.
        JsonNode sort = query.get("sort");
        if (sort != null && sort.isArray()) {
            ArrayNode nextSort = query.arrayNode();
            for (JsonNode s : sort) if (!"service_group".equals(s.path("by").asText(null))) nextSort.add(s);
            if (nextSort.size() != sort.size()) {
                if (nextSort.size() == 0) query.remove("sort"); else query.set("sort", nextSort);
            }
        }
    }

    // ---- narrowing eq filter ----

    /** Add {@code col = value} to the query's filters, but only if {@code col} is filterable on the grain. */
    private void applyEqFilter(ObjectNode query, Grain g, String col, String value) {
        if (!g.filterable.contains(col)) {
            log.debug("grain '{}' does not allow filtering on '{}'; skipping narrowing param", g.name, col);
            return;   // graceful skip — never inject an unknown column.
        }
        mergeableFilterObject(query, col).put("eq", value);
    }

    // ---- helpers ----

    /**
     * Return the (object) filter spec for {@code col} under {@code query.filters}, creating the
     * {@code filters} container and/or the per-column object as needed. If a non-object (shorthand
     * eq) filter already exists for the column it is normalised to an object so new ops can be
     * merged in — mirroring the FE's {@code mergeQueryFilters} object-merge behaviour.
     */
    private ObjectNode mergeableFilterObject(ObjectNode query, String col) {
        ObjectNode filters = query.has("filters") && query.get("filters").isObject()
                ? (ObjectNode) query.get("filters")
                : query.putObject("filters");
        JsonNode existing = filters.get(col);
        if (existing != null && existing.isObject()) return (ObjectNode) existing;
        return filters.putObject(col);
    }

    /** Read a string param, returning null when absent/null (so the switch on it is total). */
    private String textOrNull(JsonNode params, String field) {
        return params.hasNonNull(field) ? params.get(field).asText() : null;
    }

    /** Same grain-inference fallback the planner uses, so the composer targets the same grain. */
    private String inferGrain(JsonNode q) {
        Grain events = catalog.grain("events");
        Grain facts = catalog.grain("facts");
        if (events != null && facts != null && q.has("measures")) {
            for (JsonNode m : q.get("measures")) {
                String c = m.path("column").asText(null);
                if (c != null && events.measurable.contains(c) && !facts.measurable.contains(c)) return "events";
            }
        }
        return "facts";
    }
}
