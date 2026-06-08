package org.egov.pgr.analytics;

import com.fasterxml.jackson.databind.JsonNode;
import org.egov.pgr.analytics.AnalyticsCatalog.Grain;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import java.time.*;
import java.time.temporal.IsoFields;
import java.time.temporal.TemporalAdjusters;
import java.util.*;
import java.util.regex.Pattern;

/**
 * Translates one validated JSON query node into parameterized SQL against a single grain.
 * All identifiers are whitelisted against {@link AnalyticsCatalog}; all literals are JDBC params.
 */
@Component
public class AnalyticsPlanner {

    private static final ZoneId EAT = ZoneId.of("Africa/Nairobi");           // UTC+3
    private static final Pattern ALIAS = Pattern.compile("^[a-zA-Z_][a-zA-Z0-9_]{0,63}$");
    private static final Set<String> BUCKETS = new HashSet<>(Arrays.asList("day","week","month","quarter","year"));
    private static final int MAX_LIMIT = 1000;

    private final AnalyticsCatalog catalog;
    @Autowired public AnalyticsPlanner(AnalyticsCatalog catalog){ this.catalog = catalog; }

    public static final class Planned {
        public final String sql; public final List<Object> params;
        public final List<String> columns; public final String grain;
        Planned(String sql, List<Object> params, List<String> columns, String grain){
            this.sql=sql; this.params=params; this.columns=columns; this.grain=grain;
        }
    }

    public Planned plan(JsonNode q, AnalyticsScope scope){
        String grainName = q.hasNonNull("grain") ? q.get("grain").asText() : inferGrain(q);
        Grain g = catalog.grain(grainName);
        if (g == null) throw new IllegalArgumentException("unknown_grain: " + grainName);

        List<Object> selectParams = new ArrayList<>();
        List<Object> whereParams  = new ArrayList<>();
        List<String> selectExprs  = new ArrayList<>();
        List<String> groupExprs   = new ArrayList<>();
        List<String> columns      = new ArrayList<>();

        // ---- time role (named time-role only; no free-form column) ----
        JsonNode window = q.get("window");
        String timeRole = window != null && window.hasNonNull("timeRole") ? window.get("timeRole").asText() : g.defaultTimeRole;
        if (!g.timeRoles.containsKey(timeRole))
            throw new IllegalArgumentException("invalid_param: timeRole '" + timeRole + "' not valid for grain " + grainName);
        String timeCol = g.timeRoles.get(timeRole);

        // ---- dimensions ----
        if (q.has("dimensions")) for (JsonNode d : q.get("dimensions")) {
            String col = d.asText();
            if (!g.groupable.contains(col)) throw new IllegalArgumentException("unknown_column: dimension '" + col + "' not groupable on " + grainName);
            selectExprs.add(col + " AS " + col);
            groupExprs.add(col);
            columns.add(col);
        }
        // ---- time bucket (adds a derived grouped dimension) ----
        if (window != null && window.hasNonNull("timeBucket")) {
            String unit = window.get("timeBucket").asText();
            if (!BUCKETS.contains(unit)) throw new IllegalArgumentException("invalid_param: timeBucket '" + unit + "'");
            String expr = g.isEpochMs(timeCol)
                ? "date_trunc('" + unit + "', to_timestamp(" + timeCol + "/1000) AT TIME ZONE 'Etc/GMT-3')::date"
                : "date_trunc('" + unit + "', " + timeCol + ")::date";
            String alias = "bucket";
            selectExprs.add(expr + " AS " + alias);
            groupExprs.add(expr);
            columns.add(alias);
        }

        // ---- measures ----
        if (!q.has("measures") || !q.get("measures").isArray() || q.get("measures").size()==0)
            throw new IllegalArgumentException("invalid_param: at least one measure is required");
        for (JsonNode m : q.get("measures")) {
            String name = m.path("name").asText(null);
            if (name == null || !ALIAS.matcher(name).matches())
                throw new IllegalArgumentException("invalid_param: measure name '" + name + "' must match [a-zA-Z_][a-zA-Z0-9_]*");
            String expr = measureExpr(m, g, selectParams);
            selectExprs.add(expr + " AS " + name);
            columns.add(name);
        }

        // ---- WHERE: explicit filters + window + injected RBAC scope ----
        List<String> conj = new ArrayList<>();
        if (q.has("filters")) {
            Iterator<Map.Entry<String,JsonNode>> it = q.get("filters").fields();
            while (it.hasNext()) {
                Map.Entry<String,JsonNode> e = it.next();
                conj.add(predicate(g, e.getKey(), e.getValue(), whereParams));
            }
        }
        applyWindow(window, g, timeCol, conj, whereParams);
        applyScope(scope, g, conj, whereParams);

        // ---- assemble ----
        StringBuilder sb = new StringBuilder("SELECT ").append(String.join(", ", selectExprs))
            .append(" FROM ").append(g.table);
        if (!conj.isEmpty()) sb.append(" WHERE ").append(String.join(" AND ", conj));
        if (!groupExprs.isEmpty()) {
            List<String> ords = new ArrayList<>();
            for (int i=1;i<=groupExprs.size();i++) ords.add(String.valueOf(i));
            sb.append(" GROUP BY ").append(String.join(", ", ords));
        }
        applySort(q.get("sort"), columns, sb);
        int limit = q.hasNonNull("limit") ? Math.min(q.get("limit").asInt(), MAX_LIMIT) : MAX_LIMIT;
        sb.append(" LIMIT ").append(limit);

        List<Object> params = new ArrayList<>(selectParams);   // SELECT params precede WHERE params
        params.addAll(whereParams);
        return new Planned(sb.toString(), params, columns, grainName);
    }

    // ---------- measures ----------
    private String measureExpr(JsonNode m, Grain g, List<Object> selectParams){
        String agg = m.path("agg").asText("count");
        if (!AnalyticsCatalog.AGG_FNS.contains(agg)) throw new IllegalArgumentException("unknown_agg: " + agg);
        switch (agg) {
            case "count":
                return "count(*)" + filterClause(m.get("filter"), g, selectParams);
            case "count_distinct": {
                String c = col(m); requireIn(g.distinctable, c, "distinct-countable", g);
                return "count(DISTINCT " + c + ")";
            }
            case "sum": case "avg": case "min": case "max": {
                String c = col(m); requireIn(g.measurable, c, "measurable", g);
                return agg + "(" + c + ")" + filterClause(m.get("filter"), g, selectParams);
            }
            case "percentile": {
                String c = col(m); requireIn(g.measurable, c, "measurable", g);
                double p = m.path("p").asDouble(-1);
                if (!(p > 0 && p < 100)) throw new IllegalArgumentException("invalid_param: percentile p must be in (0,100)");
                return "percentile_cont(" + String.format(Locale.US, "%.6f", p/100.0)
                        + ") WITHIN GROUP (ORDER BY " + c + ")";
            }
            case "ratio": {
                String num = ratioSide(m.get("numerator"), g, selectParams);
                String den = ratioSide(m.get("denominator"), g, selectParams);
                return "round((" + num + ")::numeric / NULLIF((" + den + "),0), 4)";
            }
            default: throw new IllegalArgumentException("unknown_agg: " + agg);
        }
    }

    private String ratioSide(JsonNode side, Grain g, List<Object> selectParams){
        if (side == null) throw new IllegalArgumentException("invalid_param: ratio needs numerator and denominator");
        String agg = side.path("agg").asText("count");
        if (agg.equals("count")) return "count(*)" + filterClause(side.get("filter"), g, selectParams);
        if (agg.equals("sum")) { String c = col(side); requireIn(g.measurable, c, "measurable", g);
            return "sum(" + c + ")" + filterClause(side.get("filter"), g, selectParams); }
        throw new IllegalArgumentException("invalid_param: ratio sides support agg count|sum");
    }

    private String filterClause(JsonNode filter, Grain g, List<Object> params){
        if (filter == null || filter.isNull()) return "";
        List<String> conj = new ArrayList<>();
        Iterator<Map.Entry<String,JsonNode>> it = filter.fields();
        while (it.hasNext()) { Map.Entry<String,JsonNode> e = it.next(); conj.add(predicate(g, e.getKey(), e.getValue(), params)); }
        return conj.isEmpty() ? "" : " FILTER (WHERE " + String.join(" AND ", conj) + ")";
    }

    private String col(JsonNode m){
        String c = m.path("column").asText(null);
        if (c == null) throw new IllegalArgumentException("invalid_param: this agg requires a column");
        return c;
    }

    // ---------- predicates (filterable whitelist + bound params) ----------
    private String predicate(Grain g, String colKey, JsonNode spec, List<Object> params){
        if (!g.filterable.contains(colKey))
            throw new IllegalArgumentException("op_not_allowed: column '" + colKey + "' is not filterable on " + g.name);
        if (!spec.isObject()) { params.add(value(spec)); return colKey + " = ?"; }      // shorthand: eq
        List<String> parts = new ArrayList<>();
        Iterator<Map.Entry<String,JsonNode>> it = spec.fields();
        while (it.hasNext()) {
            Map.Entry<String,JsonNode> e = it.next();
            String op = e.getKey(); JsonNode v = e.getValue();
            switch (op) {
                case "eq":  params.add(value(v)); parts.add(colKey + " = ?"); break;
                case "ne":  params.add(value(v)); parts.add(colKey + " <> ?"); break;
                case "gt":  params.add(value(v)); parts.add(colKey + " > ?"); break;
                case "gte": params.add(value(v)); parts.add(colKey + " >= ?"); break;
                case "lt":  params.add(value(v)); parts.add(colKey + " < ?"); break;
                case "lte": params.add(value(v)); parts.add(colKey + " <= ?"); break;
                case "isnull": parts.add(colKey + (v.asBoolean() ? " IS NULL" : " IS NOT NULL")); break;
                case "in": {
                    if (!v.isArray() || v.size()==0) throw new IllegalArgumentException("invalid_param: 'in' needs a non-empty array");
                    List<String> ph = new ArrayList<>();
                    for (JsonNode item : v) { params.add(value(item)); ph.add("?"); }
                    parts.add(colKey + " IN (" + String.join(",", ph) + ")");
                    break;
                }
                default: throw new IllegalArgumentException("invalid_param: unsupported filter op '" + op + "'");
            }
        }
        return parts.size()==1 ? parts.get(0) : "(" + String.join(" AND ", parts) + ")";
    }

    private Object value(JsonNode v){
        if (v.isBoolean()) return v.asBoolean();
        if (v.isInt() || v.isLong()) return v.asLong();
        if (v.isFloatingPointNumber()) return v.asDouble();
        return v.asText();
    }

    // ---------- window ----------
    private void applyWindow(JsonNode window, Grain g, String timeCol, List<String> conj, List<Object> params){
        if (window == null || !window.hasNonNull("name")) return;
        String name = window.get("name").asText();
        if (name.equals("all")) return;
        if (name.equals("live")) {
            if (g.filterable.contains("is_open")) conj.add("is_open = ?"); else return;
            params.add(true); return;
        }
        long now = System.currentTimeMillis();
        ZonedDateTime nowEat = Instant.ofEpochMilli(now).atZone(EAT);
        Long fromMs;
        java.util.regex.Matcher lastN = Pattern.compile("^last_(\\d+)d$").matcher(name);
        if (lastN.matches()) {
            fromMs = now - Long.parseLong(lastN.group(1)) * 86400000L;
        } else switch (name) {
            case "wtd": fromMs = nowEat.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY)).toLocalDate().atStartOfDay(EAT).toInstant().toEpochMilli(); break;
            case "mtd": fromMs = nowEat.withDayOfMonth(1).toLocalDate().atStartOfDay(EAT).toInstant().toEpochMilli(); break;
            case "qtd": { LocalDate d = nowEat.toLocalDate().with(IsoFields.DAY_OF_QUARTER, 1L); fromMs = d.atStartOfDay(EAT).toInstant().toEpochMilli(); break; }
            case "ytd": fromMs = nowEat.withDayOfYear(1).toLocalDate().atStartOfDay(EAT).toInstant().toEpochMilli(); break;
            default: throw new IllegalArgumentException("invalid_param: unknown window '" + name + "'");
        }
        if (g.isEpochMs(timeCol)) {
            conj.add(timeCol + " >= ?"); params.add(fromMs);
            conj.add(timeCol + " < ?");  params.add(now);
        } else { // sql date column (daily.snapshot_date)
            conj.add(timeCol + " >= ?"); params.add(java.sql.Date.valueOf(Instant.ofEpochMilli(fromMs).atZone(EAT).toLocalDate()));
        }
    }

    // ---------- RBAC scope (server-injected) ----------
    private void applyScope(AnalyticsScope scope, Grain g, List<String> conj, List<Object> params){
        if (scope.tenantId != null) {
            if (scope.tenantStateLevel) { conj.add(g.tenantColumn + " LIKE ?"); params.add(scope.tenantId + "%"); }
            else { conj.add(g.tenantColumn + " = ?"); params.add(scope.tenantId); }
        }
        if (scope.citizenUuid != null && g.citizenColumn != null) { conj.add(g.citizenColumn + " = ?"); params.add(scope.citizenUuid); }
        if (scope.boundaryPrefix != null && g.boundaryColumn != null) {
            conj.add(g.boundaryColumn + " LIKE ?");
            params.add(scope.boundaryPrefix.replace("\\","\\\\").replace("%","\\%").replace("_","\\_") + "%");
        }
    }

    // ---------- sort ----------
    private void applySort(JsonNode sort, List<String> columns, StringBuilder sb){
        if (sort == null || !sort.isArray() || sort.size()==0) return;
        List<String> parts = new ArrayList<>();
        for (JsonNode s : sort) {
            String by = s.path("by").asText(null);
            if (by == null || !columns.contains(by)) throw new IllegalArgumentException("invalid_param: sort.by '" + by + "' must be a selected dimension or measure");
            String dir = "desc".equalsIgnoreCase(s.path("dir").asText("asc")) ? "DESC" : "ASC";
            parts.add(by + " " + dir + " NULLS LAST");
        }
        sb.append(" ORDER BY ").append(String.join(", ", parts));
    }

    // ---------- grain inference ----------
    private String inferGrain(JsonNode q){
        // if any measure column is events-only (dwell_ms etc.) → events; else facts.
        Grain events = catalog.grain("events");
        if (q.has("measures")) for (JsonNode m : q.get("measures")) {
            String c = m.path("column").asText(null);
            if (c != null && events.measurable.contains(c) && !catalog.grain("facts").measurable.contains(c)) return "events";
        }
        return "facts";
    }

    private void requireIn(Set<String> set, String col, String role, Grain g){
        if (!set.contains(col)) throw new IllegalArgumentException("unknown_column: '" + col + "' is not " + role + " on " + g.name);
    }
}
