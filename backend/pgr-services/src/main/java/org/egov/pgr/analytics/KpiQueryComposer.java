package org.egov.pgr.analytics;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import lombok.extern.slf4j.Slf4j;
import org.egov.pgr.analytics.AnalyticsCatalog.Grain;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeParseException;
import java.time.temporal.TemporalAdjusters;
import java.util.List;
import java.util.regex.Pattern;

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
 *   <li>{@code serviceCode} — a complaint type LEAF; narrows to {@code service_code = ?} iff
 *       filterable. This stays the param for leaf selections (exact match, works on every grain
 *       incl. daily); {@code complaintPath} below is for interior nodes only.</li>
 *   <li>{@code complaintPath} — a complaint-hierarchy INTERIOR node's dot-path (e.g.
 *       {@code SANITATION.SEWAGE}); narrows to the node's whole subtree via a delimiter-guarded
 *       {@code complaint_node_path} subtree predicate ({@code = ? OR LIKE ?||'.%'}) iff the grain
 *       carries the path column (facts/events). Values are validated against the path alphabet
 *       ({@code [A-Za-z0-9._/-]}, length-capped) — anything else is {@code invalid_param}. On the
 *       daily grain (no path column) the param cannot apply; unlike {@code ward}'s silent skip,
 *       the skip is REPORTED to the caller via the {@code paramsIgnored} collector (surfaced as
 *       {@code paramsIgnored:["complaintPath"]} on the result envelope) so the FE can flag the
 *       widget as unfiltered. Rows with a NULL path (nodes whose own code contains '.', see the
 *       #1111 migration; flat tenants) never match a subtree filter.</li>
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
 * <p><b>Pinned windows (#1462).</b> A def may declare {@code window: {name, pinned: true}} to keep
 * its own time axis — "complaints created today" means today whatever range the user picked. For
 * such a def the {@code window} param and {@code dateFrom}/{@code dateTo} do NOT rewrite the time
 * predicate — a supplied {@code window} param is reported back as {@code paramsIgnored:["window"]}
 * rather than silently swallowed. If the selected range does not COVER the pinned interval the entry
 * is SUPPRESSED (no rows, {@code suppressed:"filter_excludes_window"}) so the tile can render an
 * empty state instead of a number for a period the filter excludes; {@code compare:"prior"} then
 * means the preceding window of equal span (yesterday, for {@code dtd}), and {@code series:"daily"}
 * gets an axis wider than the pin (the range, else the {@code window} param, else a rolling default)
 * so the sparkline is a trend rather than a single point. Non-time params (ward / serviceCode /
 * complaintPath / hierLevel) still apply — pinning fixes time, not filters. Pinning a BOUNDLESS
 * window ({@code all} / {@code live}) is meaningless and ignored: there is no interval to cover and
 * no preceding period, so such a def takes the ordinary path.
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

    private static final long MS_PER_DAY = 86_400_000L;
    /** Sparkline daily-series safety cap, matching the FE {@code Math.min(366, ...)}. */
    private static final int MAX_SERIES_DAYS = 366;
    /**
     * Trend axis for a pinned def's sparkline when the request carries neither a date range nor a
     * window param — a pinned window is too narrow to be a trend (dtd would be one point).
     */
    private static final String DEFAULT_SERIES_WINDOW = "last_30d";
    /**
     * Marker written onto the merged query when a pinned window cannot be answered under the
     * selected range (#1462). Read and stripped by {@link AnalyticsService} before planning — it is
     * never a grammar field and never reaches SQL.
     */
    static final String SUPPRESSED = "__suppressed";
    /** {@code complaintPath} length cap — live paths are short dot-joined UPPER_SNAKE codes. */
    static final int MAX_COMPLAINT_PATH_LENGTH = 256;
    /**
     * The complaint-hierarchy path alphabet: dot-joined MDMS node codes (alnum/underscore/dash,
     * occasionally slash). Anything outside it — quotes, whitespace, LIKE metachars, SQL syntax —
     * is rejected up front (defense in depth on top of the planner's bound params + LIKE-escape).
     */
    private static final Pattern COMPLAINT_PATH_VALUE =
            Pattern.compile("^[A-Za-z0-9._/\\-]{1," + MAX_COMPLAINT_PATH_LENGTH + "}$");

    private final AnalyticsCatalog catalog;

    @Autowired
    public KpiQueryComposer(AnalyticsCatalog catalog) { this.catalog = catalog; }

    /**
     * Produce the effective query by layering the request's {@code params} (dashboard globals) onto
     * the def's base {@code query}. Returns the base query unchanged when {@code params} is absent /
     * empty. Never mutates {@code baseQuery}.
     *
     * @param calendar the ONE request-scoped {@link BusinessCalendar} (resolved zone + shared asOf)
     *                 every window/bounds/prior-period computation in this merge is judged against.
     */
    public JsonNode mergeParams(JsonNode baseQuery, JsonNode params, BusinessCalendar calendar) {
        return mergeParams(baseQuery, params, null, calendar);
    }

    /**
     * As {@link #mergeParams(JsonNode, JsonNode, BusinessCalendar)}, additionally reporting into
     * {@code paramsIgnoredOut} (nullable) the name of any supplied param that could NOT be applied
     * to this def's grain and whose skip the FE must be told about. Today only
     * {@code complaintPath} reports (the daily grain has no {@code complaint_node_path}, so a
     * subtree selection would otherwise leave those widgets silently unfiltered); the historical
     * silent no-ops ({@code ward} on ward-less grains, {@code hierLevel} on daily) keep their
     * behaviour unchanged.
     */
    public JsonNode mergeParams(JsonNode baseQuery, JsonNode params, List<String> paramsIgnoredOut,
                                BusinessCalendar calendar) {
        if (baseQuery == null || !baseQuery.isObject()) return baseQuery;
        if (params == null || !params.isObject() || params.size() == 0) return baseQuery;

        // Resolve the grain so we can (a) pick the time column and (b) gate ward/service narrowing.
        String grainName = baseQuery.hasNonNull("grain") ? baseQuery.get("grain").asText() : inferGrain(baseQuery);
        Grain g = catalog.grain(grainName);
        if (g == null) return baseQuery;   // planner will reject; don't mask the error here.

        ObjectNode next = (ObjectNode) baseQuery.deepCopy();
        ZoneId zone = calendar.zoneId;

        boolean hasDateRange = params.hasNonNull("dateFrom") && params.hasNonNull("dateTo");
        boolean prior  = "prior".equals(textOrNull(params, "compare"));
        boolean series = "daily".equals(textOrNull(params, "series"));

        // Resolve the selected/current range (epoch-ms, half-open) if one is set. compare/series both
        // operate on these bounds; null means "no explicit range" (rolling window or whole-history).
        // C2: a present-but-unparseable dateFrom/dateTo must NOT silently fall back to the base/window
        // query (that returned the wrong, un-narrowed scalar). Surface a per-entry invalid_param instead.
        // dateFrom/dateTo are LOCAL calendar dates in the resolved tenant zone (never UTC midnight) —
        // the same zone the planner's window math and this def's grain use.
        Bounds bounds = hasDateRange
                ? parseBounds(params.get("dateFrom").asText(), params.get("dateTo").asText(), zone)
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

        // A PINNED window owns its own time axis: the def declares what period it means ("today",
        // "this week") and the dashboard's date range must not redefine it (#1462). Unlike a live-open
        // snapshot — which is timeless and simply ignores the range — a pinned window occupies a real
        // interval, so a range that does not COVER that interval makes the tile unanswerable rather
        // than merely unfiltered. That case is SUPPRESSED: no value, so the tile can render an empty
        // state instead of quietly reporting a number for a period the filter excludes.
        PinnedWindow pinned = pinnedWindow(next, calendar);
        if (pinned != null) {
            if (series && !prior) {
                // The sparkline is trend CONTEXT for the pinned value, not the value itself, and a
                // trend needs an axis WIDER than the pinned interval — a pinned dtd would otherwise
                // bucket "today" into a single flat point. So the series follows the selected range,
                // else an explicit window param, else a rolling default; and it stays answerable even
                // when the pinned interval sits outside the range (trend shown, headline suppressed).
                applyPinnedSeriesAxis(next, params, bounds);
                applyDailySeries(next, g, bounds);
            } else {
                // Decided BEFORE the window is consumed below, and from the SAME clock reading the
                // bounds are materialized with, so the suppression verdict and the executed SQL can
                // never straddle the resolved zone's midnight and disagree.
                boolean suppress = bounds != null && !rangeCoversPinnedWindow(pinned, bounds);
                if (prior) applyPinnedPrior(next, g, pinned, zone);
                else       materializePinnedWindow(next, g, pinned);
                if (suppress) next.put(SUPPRESSED, true);
                // The window param cannot override a pin — say so, rather than silently ignoring it
                // (the complaintPath precedent: an unappliable param is reported, never swallowed).
                if (params.hasNonNull("window") && !params.get("window").asText().isEmpty())
                    reportIgnored(paramsIgnoredOut, "window");
            }
            applyNarrowingParams(next, g, params, paramsIgnoredOut);
            return next;
        }

        // ---- window override (skipped when an explicit range is supplied; range governs time) ----
        // Also skipped for compare:"prior" with no range, where the prior-WEEK fallback governs time,
        // and for live-open snapshots (point-in-time; no window axis).
        if (!hasDateRange && !prior && !liveOpenSnapshot && params.hasNonNull("window")) {
            String windowName = params.get("window").asText();
            if (!windowName.isEmpty()) applyWindowName(next, windowName);
        }

        if (prior) {
            // ---- prior-period: shift the (selected | default-week) range back one equal duration ----
            applyPrior(next, g, bounds, calendar);
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

        applyNarrowingParams(next, g, params, paramsIgnoredOut);

        return next;
    }

    /**
     * The non-time narrowing params — ward, service type, complaint subtree, hierarchy rollup.
     * Applied on every path, pinned windows included: pinning fixes a tile's <em>time</em> axis, it
     * does not exempt it from the dashboard's ward / type filters.
     */
    private void applyNarrowingParams(ObjectNode next, Grain g, JsonNode params, List<String> paramsIgnoredOut) {
        // ---- narrowing dimension filters (only if the grain supports the column) ----
        if (params.hasNonNull("ward")) {
            String ward = params.get("ward").asText();
            if (!ward.isEmpty() && !"all".equals(ward)) applyEqFilter(next, g, "ward_code", ward);
        }
        if (params.hasNonNull("serviceCode")) {
            String svc = params.get("serviceCode").asText();
            if (!svc.isEmpty() && !"all".equals(svc)) applyEqFilter(next, g, "service_code", svc);
        }
        if (params.hasNonNull("complaintPath")) {
            String path = params.get("complaintPath").asText();
            if (!path.isEmpty()) applyComplaintPath(next, g, path, paramsIgnoredOut);
        }

        // ---- hierarchy-level rollup (#1111): rewrite service_code dimensions to the level expr ----
        if (params.hasNonNull("hierLevel")) {
            String hierLevel = params.get("hierLevel").asText();
            if (!hierLevel.isEmpty() && !"leaf".equals(hierLevel)) applyHierLevel(next, g, hierLevel);
        }
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

    /**
     * Half-open epoch-ms range [fromMs, toMs), with the inclusive ISO start/end dates retained.
     * {@code dateFrom}/{@code dateTo} are LOCAL calendar dates in the resolved tenant zone — bounds
     * are start-of-day in THAT zone, not UTC midnight, so they line up with the planner's window
     * math and the grain's zone-derived date columns.
     */
    private static final class Bounds {
        final LocalDate fromDate;       // inclusive
        final LocalDate toExclusive;    // exclusive (day after dateTo)
        final long fromMs;              // zone-midnight epoch-ms of fromDate
        final long toMs;                // zone-midnight epoch-ms of toExclusive
        Bounds(LocalDate fromDate, LocalDate toExclusive, ZoneId zone) {
            this.fromDate = fromDate; this.toExclusive = toExclusive;
            this.fromMs = fromDate.atStartOfDay(zone).toInstant().toEpochMilli();
            this.toMs   = toExclusive.atStartOfDay(zone).toInstant().toEpochMilli();
        }
        long durationMs() { return toMs - fromMs; }
        /** FE countDaysInDateRange: max(1, ceil(duration / day)). */
        int dayCount() { return (int) Math.max(1, (durationMs() + MS_PER_DAY - 1) / MS_PER_DAY); }
    }

    /**
     * Parse {@code dateFrom}/{@code dateTo} (ISO, inclusive) as LOCAL calendar dates in {@code zone}
     * into half-open {@link Bounds}; null if unparseable.
     */
    private Bounds parseBounds(String dateFrom, String dateTo, ZoneId zone) {
        try {
            LocalDate from = LocalDate.parse(dateFrom);
            LocalDate toExclusive = LocalDate.parse(dateTo).plusDays(1);
            if (toExclusive.isBefore(from)) return null;   // nonsensical range
            return new Bounds(from, toExclusive, zone);
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

    // ---- pinned window (#1462) ----

    /**
     * A pinned window RESOLVED against one clock reading: its start, "now", and the resolved-zone
     * calendar days either maps to. Every downstream decision — suppression, the materialized SQL
     * bounds, the prior period — reads this single snapshot, so a request cannot be judged against
     * one calendar day and executed against the next.
     */
    private static final class PinnedWindow {
        final long nowMs, startMs;
        final LocalDate startDate, today;
        PinnedWindow(long nowMs, long startMs, ZoneId zone) {
            this.nowMs = nowMs; this.startMs = startMs;
            this.startDate = Instant.ofEpochMilli(startMs).atZone(zone).toLocalDate();
            this.today = Instant.ofEpochMilli(nowMs).atZone(zone).toLocalDate();
        }
        /** Span in whole zone-local days, inclusive of both ends — 1 for {@code dtd}. */
        long spanDays() { return Math.max(1, java.time.temporal.ChronoUnit.DAYS.between(startDate, today) + 1); }
    }

    /**
     * Resolve the def's pinned window, or {@code null} if it has none.
     *
     * <p>A def PINS its window when it declares {@code window: {name, pinned: true}} — "this tile means
     * today / this week, whatever the dashboard's date range says". Without the flag the range wins,
     * which is the historical behaviour for every other tile and stays unchanged.
     *
     * <p>Pinning is only meaningful for a BOUNDED window. {@code all} / {@code live} have no start
     * instant, so there is no interval for a range to cover and no preceding period to compare
     * against — pinning them is ignored and they take the ordinary path rather than silently
     * degrading into a query whose prior equals its current.
     */
    private PinnedWindow pinnedWindow(JsonNode query, BusinessCalendar calendar) {
        JsonNode window = query.get("window");
        if (window == null || !window.isObject()
                || !window.hasNonNull("name") || !window.path("pinned").asBoolean(false)) return null;
        long now = calendar.nowMs;
        Long startMs = AnalyticsPlanner.windowStartMs(window.get("name").asText(), now, calendar.zoneId);
        if (startMs == null) {
            log.debug("ignoring pinned:true on boundless window '{}' — nothing to pin", window.get("name").asText());
            return null;
        }
        return new PinnedWindow(now, startMs, calendar.zoneId);
    }

    /**
     * Does the selected range COVER the whole pinned interval? The window spans
     * {@code [startDate, today]}; the range spans {@code [dateFrom, dateTo]}.
     *
     * <p>Coverage, not mere overlap: a partial intersection would let the tile report its full pinned
     * total under a filter that excludes part of that period — a "created this week" tile showing
     * Monday–Friday under a two-day filter — which is the same wrong-period-number class #1462 exists
     * to remove. For the {@code dtd} case both rules coincide: the range must contain today.
     *
     * <p>Comparison is on resolved-zone calendar days, the same zone the planner buckets in, so a range ending
     * "today" covers today regardless of clock time.
     */
    private boolean rangeCoversPinnedWindow(PinnedWindow pinned, Bounds bounds) {
        LocalDate rangeEnd = bounds.toExclusive.minusDays(1);   // back to the inclusive dateTo
        return !bounds.fromDate.isAfter(pinned.startDate) && !rangeEnd.isBefore(pinned.today);
    }

    /**
     * Bake the pinned window into explicit {@code gte}/{@code lt} bounds and drop the window node, so
     * the planner does not re-resolve it against a second, later clock reading. The predicate is
     * identical to what {@link AnalyticsPlanner#applyWindow} would emit — {@code [start, now)} — it is
     * simply pinned to the instant the request was judged against.
     */
    private void materializePinnedWindow(ObjectNode query, Grain g, PinnedWindow pinned) {
        String col = dateFilterColumn(query, g);
        if (col == null || !g.filterable.contains(col)) return;   // leave the window for the planner.
        bindPinnedBounds(query, col, pinned.startDate, pinned.startMs, pinned.today.plusDays(1), pinned.nowMs);
        query.remove("window");
    }

    /**
     * {@code compare:"prior"} against a pinned window: the immediately-preceding window of the same
     * span, NOT the FE's prior-equal-duration-of-the-selected-range (which would compare "today"
     * against a month). For {@code dtd} this is yesterday — matching the tile's "vs yesterday" label.
     */
    private void applyPinnedPrior(ObjectNode query, Grain g, PinnedWindow pinned, ZoneId zone) {
        String col = dateFilterColumn(query, g);
        if (col == null || !g.filterable.contains(col)) {
            log.debug("grain '{}' has no filterable time column for a pinned compare:prior; skipping", g.name);
            return;
        }
        LocalDate priorStart = pinned.startDate.minusDays(pinned.spanDays());
        bindPinnedBounds(query, col, priorStart, priorStart.atStartOfDay(zone).toInstant().toEpochMilli(),
                pinned.startDate, pinned.startMs);
        query.remove("window");   // the explicit prior bounds now govern the time axis.
    }

    /** Bind a half-open pinned interval: ISO dates on the daily grain, epoch-ms elsewhere. */
    private void bindPinnedBounds(ObjectNode query, String col,
                                  LocalDate fromDate, long fromMs, LocalDate toExclusive, long toMs) {
        ObjectNode bound = mergeableFilterObject(query, col);
        if ("snapshot_date".equals(col)) {
            bound.put("gte", fromDate.toString());
            bound.put("lt", toExclusive.toString());
        } else {
            bound.put("gte", fromMs);
            bound.put("lt", toMs);
        }
    }

    /**
     * Give a pinned def's sparkline an axis wider than the pin. With a selected range,
     * {@link #applyDailySeries} uses it and this is a no-op. Without one, the pinned window would
     * otherwise survive and bucket the whole trend into a single point, so it is replaced by the
     * caller's {@code window} param (honoured here, where it is meaningful) or a rolling default.
     */
    private void applyPinnedSeriesAxis(ObjectNode query, JsonNode params, Bounds bounds) {
        if (bounds != null) return;                             // the range already supplies the axis.
        String windowName = params.hasNonNull("window") ? params.get("window").asText() : "";
        applyWindowName(query, windowName.isEmpty() ? DEFAULT_SERIES_WINDOW : windowName);
        ((ObjectNode) query.get("window")).remove("pinned");    // the axis is a trend, not the pin.
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
     * week ({@code priorPeriodWeek}, last-Monday .. this-Monday), computed in the resolved tenant
     * zone (from the request's shared {@code asOf}) to match the planner's window zone.
     */
    private void applyPrior(ObjectNode query, Grain g, Bounds bounds, BusinessCalendar calendar) {
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
                LocalDate thisMonday = thisMonday(calendar);
                ObjectNode bound = mergeableFilterObject(query, col);
                bound.put("eq", thisMonday.minusDays(1).toString());
            } else {
                long[] wk = priorWeekMs(calendar);
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

    /**
     * This calendar week's Monday 00:00 in the resolved tenant zone, mirroring the FE local-time
     * Monday. Measured from the request's single captured wall-clock instant, so it
     * agrees with every other window decision in the same batch.
     */
    private LocalDate thisMonday(BusinessCalendar calendar) {
        return Instant.ofEpochMilli(calendar.nowMs).atZone(calendar.zoneId).toLocalDate()
                .with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
    }

    /** Epoch-ms [lastMonday, thisMonday) in the resolved zone — the FE priorWeekCreatedAtFilter equivalent. */
    private long[] priorWeekMs(BusinessCalendar calendar) {
        LocalDate thisMonday = thisMonday(calendar);
        LocalDate lastMonday = thisMonday.minusDays(7);
        long lo = lastMonday.atStartOfDay(calendar.zoneId).toInstant().toEpochMilli();
        long hi = thisMonday.atStartOfDay(calendar.zoneId).toInstant().toEpochMilli();
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

    // ---- complaint-hierarchy subtree filter (interior nodes) ----

    /**
     * Narrow to a complaint-hierarchy INTERIOR node's whole subtree: a delimiter-guarded
     * {@code complaint_node_path} {@code subtree} predicate ({@code = ? OR LIKE ?||'.%'} — the
     * {@code '.'} guard so {@code PGR} never matches a {@code PGRX} sibling, the eq arm so a
     * complaint filed AT a mixed interior+serviceable node stays in its own subtree). The
     * predicate rides {@link AnalyticsPlanner}'s prefix-filterable allowlist with bound params
     * and LIKE-escaping, exactly like the inline path's {@code starts_with}.
     *
     * <p>A malformed value (outside the path alphabet / over the length cap) is a hard
     * {@code invalid_param} — same reasoning as C2/hierLevel: silently serving the UN-narrowed
     * number for a subtree the caller asked for would be a wrong answer. A grain without the
     * path column (daily) skips the filter but REPORTS the skip via {@code paramsIgnoredOut},
     * so the FE can badge the widget instead of presenting an unfiltered count as filtered.
     *
     * <p>Leaf selections must keep using {@code serviceCode} (exact match; also covers the daily
     * grain, which has a filterable {@code service_code} but no path column).
     */
    private void applyComplaintPath(ObjectNode query, Grain g, String path, List<String> paramsIgnoredOut) {
        if (!COMPLAINT_PATH_VALUE.matcher(path).matches())
            throw new IllegalArgumentException("invalid_param: complaintPath must be a dot-joined node path over"
                    + " [A-Za-z0-9._/-], at most " + MAX_COMPLAINT_PATH_LENGTH + " chars");
        if (!g.prefixFilterable.contains("complaint_node_path")) {
            log.debug("grain '{}' has no complaint_node_path; ignoring complaintPath param (reported)", g.name);
            reportIgnored(paramsIgnoredOut, "complaintPath");
            return;
        }
        mergeableFilterObject(query, "complaint_node_path").put("subtree", path);
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

    /**
     * Record a supplied param that could NOT be applied, deduped. Surfaced on the result envelope as
     * {@code paramsIgnored}, so a caller is never left assuming a narrowing (or a window) took effect
     * when it did not.
     */
    private void reportIgnored(List<String> paramsIgnoredOut, String param) {
        if (paramsIgnoredOut != null && !paramsIgnoredOut.contains(param)) paramsIgnoredOut.add(param);
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
