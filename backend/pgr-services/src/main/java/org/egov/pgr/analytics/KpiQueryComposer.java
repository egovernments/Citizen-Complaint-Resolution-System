package org.egov.pgr.analytics;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import lombok.extern.slf4j.Slf4j;
import org.egov.pgr.analytics.AnalyticsCatalog.Grain;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.format.DateTimeParseException;

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
 * </ul>
 *
 * <p>All injected predicates ride the planner's existing parameterized {@code filters} mechanism
 * (bound JDBC params, whitelisted against {@link AnalyticsCatalog}). Unknown / inapplicable params
 * are skipped gracefully — never thrown, never string-concatenated into SQL. The inline path
 * (no {@code kpiId}) never reaches this class and is unchanged.
 */
@Component
@Slf4j
public class KpiQueryComposer {

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

        // ---- window override (skipped when an explicit range is supplied; range governs time) ----
        if (!hasDateRange && params.hasNonNull("window")) {
            String windowName = params.get("window").asText();
            if (!windowName.isEmpty()) applyWindowName(next, windowName);
        }

        // ---- explicit date range -> gte/lt filter on the grain's time column ----
        if (hasDateRange) {
            applyDateRange(next, g, params.get("dateFrom").asText(), params.get("dateTo").asText());
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

    /**
     * Mirror the FE's {@code applyDashboardFiltersToQuery}: choose the grain's time column, drop the
     * base {@code window}, and add a {@code gte}/{@code lt} predicate. Bounds are inclusive of
     * {@code dateFrom} and exclusive of the day after {@code dateTo} (half-open), matching
     * {@code isoDateToStartMs}/{@code isoDateToEndExclusiveMs}.
     */
    private void applyDateRange(ObjectNode query, Grain g, String dateFrom, String dateTo) {
        LocalDate from, toExclusive;
        try {
            from = LocalDate.parse(dateFrom);
            toExclusive = LocalDate.parse(dateTo).plusDays(1);
        } catch (DateTimeParseException ex) {
            log.debug("ignoring date range with unparseable bounds dateFrom='{}' dateTo='{}'", dateFrom, dateTo);
            return;
        }
        if (toExclusive.isBefore(from)) return;   // nonsensical range -> skip

        String col = dateFilterColumn(query, g);
        if (col == null || !g.filterable.contains(col)) {
            log.debug("grain '{}' has no filterable time column for a date range; skipping", g.name);
            return;
        }

        ObjectNode bound = mergeableFilterObject(query, col);
        if ("snapshot_date".equals(col)) {
            // daily grain: snapshot_date is a SQL date -> bind ISO date strings (FE snapshotDateRangeFilter).
            bound.put("gte", from.toString());
            bound.put("lt", toExclusive.toString());
        } else {
            // facts/events: epoch-ms columns -> bind UTC-midnight epoch-ms bounds (FE isoDate*Ms).
            bound.put("gte", from.atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli());
            bound.put("lt", toExclusive.atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli());
        }
        // Range fully governs the time axis -> remove the base window (parity with the FE).
        query.remove("window");
    }

    /**
     * The time column a date range narrows, matching the FE's {@code dateFilterColumnForQuery}:
     * events -> {@code complaint_created_at}; daily -> {@code snapshot_date};
     * facts with a {@code resolved_at} timeRole -> {@code resolved_at}; otherwise {@code created_at}.
     */
    private String dateFilterColumn(JsonNode query, Grain g) {
        if ("events".equals(g.name)) return "complaint_created_at";
        if ("daily".equals(g.name)) return "snapshot_date";
        JsonNode window = query.get("window");
        if (window != null && window.hasNonNull("timeRole") && "resolved_at".equals(window.get("timeRole").asText()))
            return "resolved_at";
        return "created_at";
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
