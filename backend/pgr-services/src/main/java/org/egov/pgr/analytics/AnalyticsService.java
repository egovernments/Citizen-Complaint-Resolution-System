package org.egov.pgr.analytics;

import com.fasterxml.jackson.databind.JsonNode;
import lombok.extern.slf4j.Slf4j;
import org.egov.common.contract.request.RequestInfo;
import org.egov.common.contract.request.Role;
import org.egov.common.contract.request.User;
import org.egov.pgr.analytics.AnalyticsCatalog.Grain;
import org.egov.pgr.analytics.model.KpiDefinition;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.stream.Collectors;

/**
 * Orchestrates the dynamic analytics query: resolve server-side RBAC scope, plan each query
 * against the catalog, execute parameterized SQL, and shape the response (single or batch dict).
 *
 * The batch-query arm supports a kpiId-by-reference shorthand: when a query node contains
 * {@code "kpiId": "<id>"} instead of an inline grammar, the KPI's query is loaded from MDMS
 * via {@link KpiCatalogService}. Callers not authorized for the KPI receive a per-entry
 * {@code kpi_forbidden} error with {@code partial: true}; the rest of the batch continues normally.
 */
@Service
@Slf4j
public class AnalyticsService {

    /**
     * Officer-identity (PII) dimension columns across the analytics grains
     * ({@link AnalyticsCatalog}). Projecting any of these as a raw DIMENSION returns
     * real officer/citizen UUIDs row-by-row. A {@code count_distinct} MEASURE over them
     * is aggregate-only and is NOT gated here.
     *
     * Source columns (per grain):
     *   facts  -> current_assignee_uuid, account_id
     *   events -> assignee_uuid, actor_uuid, account_id
     *   daily  -> current_assignee_uuid
     */
    static final Set<String> PII_DIMENSIONS = Set.of(
            "current_assignee_uuid", "assignee_uuid", "actor_uuid", "account_id");

    /**
     * Roles allowed to project officer-PII dimensions on an INLINE analytics query.
     * Mirrors the officer-PII KPI defs' {@code rbac.visibleTo}
     * (KpiDefinition.json uses {@code ["PGR_SUPERVISOR","PGR_ADMIN","SUPERUSER"]}; bomet's
     * live ke seed uses {@code SUPERVISOR}) plus the platform admin roles. Include BOTH
     * supervisor codes so a legit supervisor is never wrongly denied across tenants. The
     * kpiId-by-reference path already enforces {@code visibleTo} via
     * {@link KpiDefinition#isVisibleTo}; this constant gates only the inline path.
     */
    static final Set<String> OFFICER_PII_ROLES = Set.of(
            "SUPERVISOR", "PGR_SUPERVISOR", "PGR_ADMIN", "SUPERUSER", "MDMS_ADMIN", "HRMS_ADMIN");

    /**
     * Synthetic role for an unauthenticated / no-role caller (the "public floor", 70-view-management
     * §"Public (no login)"). An anonymous request degrades to THIS rather than to unrestricted-admin:
     * it may see only KPIs whose {@code rbac.visibleTo} explicitly lists {@code PUBLIC} (curated,
     * aggregate-only, no PII), and may NOT run inline (non-kpiId) queries. Tenant-aggregate scope is
     * still applied. This is the deliberate "degrade-to-public-floor", not a blanket lock-out.
     */
    static final String PUBLIC_ROLE = "PUBLIC";

    private final AnalyticsPlanner planner;
    private final AnalyticsCatalog catalog;
    private final JdbcTemplate jdbc;
    private final KpiCatalogService kpiCatalogService;
    private final PrincipalScopeResolver scopeResolver;
    private final KpiQueryComposer queryComposer;
    private final AnalyticsMetrics metrics;

    @Autowired
    public AnalyticsService(AnalyticsPlanner planner, AnalyticsCatalog catalog, JdbcTemplate jdbc,
                            KpiCatalogService kpiCatalogService, PrincipalScopeResolver scopeResolver,
                            KpiQueryComposer queryComposer, AnalyticsMetrics metrics){
        this.planner = planner; this.catalog = catalog; this.jdbc = jdbc;
        this.kpiCatalogService = kpiCatalogService; this.scopeResolver = scopeResolver;
        this.queryComposer = queryComposer; this.metrics = metrics;
    }

    /** Back-compat entry point (no trace correlation header). */
    public Map<String,Object> query(JsonNode body, RequestInfo requestInfo, String tenantId, int stateLevelLen){
        return query(body, requestInfo, tenantId, stateLevelLen, null);
    }

    /**
     * #1110: instrumented entry point. Every executed SQL query (batch entry, single query,
     * compose SOURCE query) records an OTEL duration/rows point via {@link QueryTelemetry};
     * one {@code analytics.slow_queries} line (top-{@value QueryTelemetry#TOP_N} by tookMs)
     * is logged per request — also on partial failure, covering whatever did execute.
     *
     * @param headerTraceId the literal {@code x-trace-id} header — correlation FALLBACK only;
     *                      the active span's trace id (javaagent + Kong w3c propagation) wins.
     */
    public Map<String,Object> query(JsonNode body, RequestInfo requestInfo, String tenantId,
                                    int stateLevelLen, String headerTraceId){
        QueryTelemetry tel = new QueryTelemetry(metrics, tenantId, stateLevelLen);
        try {
            return doQuery(body, requestInfo, tenantId, stateLevelLen, tel);
        } finally {
            if (!tel.isEmpty())
                log.info(tel.slowQueryLine(QueryTelemetry.resolveTraceId(headerTraceId)));
        }
    }

    private Map<String,Object> doQuery(JsonNode body, RequestInfo requestInfo, String tenantId,
                                       int stateLevelLen, QueryTelemetry tel){
        if (tenantId == null || tenantId.isEmpty()) throw new IllegalArgumentException("invalid_param: tenantId is required");
        AnalyticsScope scope = scopeResolver.resolve(requestInfo, tenantId, stateLevelLen);
        Set<String> callerRoles = extractRoles(requestInfo);
        boolean publicFloor = isPublicFloor(callerRoles);

        Map<String,Object> out = new LinkedHashMap<>();
        out.put("asOf", asOf());
        out.put("scope", scopeInfo(scope));

        if (body.has("queries") && body.get("queries").isObject()) {
            // batch dict form: { name -> queryNode } => { results: { name -> result }, partial }
            Map<String,Object> results = new LinkedHashMap<>();
            boolean partial = false;
            Iterator<Map.Entry<String,JsonNode>> it = body.get("queries").fields();
            while (it.hasNext()) {
                Map.Entry<String,JsonNode> e = it.next();
                String name = e.getKey();
                JsonNode queryNode = e.getValue();
                try {
                    // Public floor: only published PUBLIC-eligible KPIs, by reference. No inline (an
                    // inline body bypasses the catalog's PUBLIC opt-in + publish-time PII check).
                    if (publicFloor && !queryNode.has("kpiId")) {
                        partial = true;
                        results.put(name, Map.of("error", "kpi_forbidden",
                                "message", "public access is limited to published PUBLIC KPIs"));
                        continue;
                    }
                    // D1a: backend-composed defs (query:null + viz.compose) resolve recursively here.
                    Map<String,Object> composed = maybeComposeResult(queryNode, scope, tenantId, callerRoles, tel, name);
                    if (composed != null) { results.put(name, composed); continue; }

                    JsonNode actualQueryNode = resolveKpiRef(queryNode, tenantId, callerRoles);
                    if (actualQueryNode == null) {
                        partial = true;
                        results.put(name, Map.of("error", "kpi_forbidden",
                                "message", "KPI not found or not authorized for role set"));
                        continue;
                    }
                    // INLINE-only PII gate: the kpiId path already enforced visibleTo above; an inline
                    // body (no kpiId) bypasses that, so block inline projection of officer-PII dimensions
                    // unless the caller holds an officer-PII-authorized role.
                    if (!queryNode.has("kpiId") && projectsForbiddenPii(actualQueryNode, callerRoles)) {
                        partial = true;
                        results.put(name, Map.of("error", "pii_forbidden",
                                "message", "inline query projects officer-PII dimension(s); role not authorized"));
                        continue;
                    }
                    results.put(name, runOne(actualQueryNode, scope, tel, name, kpiContext(queryNode)));
                } catch (Exception ex) {
                    partial = true;
                    results.put(name, err(ex));
                }
            }
            out.put("results", results);
            out.put("partial", partial);
        } else if (body.has("query")) {
            JsonNode queryNode = body.get("query");
            if (publicFloor && !queryNode.has("kpiId"))
                throw new IllegalArgumentException("kpi_forbidden: public access is limited to published PUBLIC KPIs");
            Map<String,Object> composed = maybeComposeResult(queryNode, scope, tenantId, callerRoles, tel, "query");
            if (composed != null) { out.putAll(composed); return out; }
            JsonNode actualQueryNode = resolveKpiRef(queryNode, tenantId, callerRoles);
            if (actualQueryNode == null)
                throw new IllegalArgumentException("kpi_forbidden: KPI not found or not authorized");
            if (!queryNode.has("kpiId") && projectsForbiddenPii(actualQueryNode, callerRoles))
                throw new IllegalArgumentException("pii_forbidden: inline query projects officer-PII dimension(s); role not authorized");
            out.putAll(runOne(actualQueryNode, scope, tel, "query", kpiContext(queryNode)));
        } else {
            throw new IllegalArgumentException("invalid_param: body must contain 'query' or 'queries'");
        }
        return out;
    }

    /**
     * If the query node has a {@code "kpiId"} field, resolve it to the KPI's stored query
     * and check authorization. Returns null if forbidden. Returns queryNode unchanged when
     * there is no {@code "kpiId"} field (inline query path is unchanged).
     *
     * <p>When the request node carries a {@code "params"} object (the dashboard's global filters —
     * window / date range / ward / serviceCode), those are merged onto the def's base query via
     * {@link KpiQueryComposer} so the kpiId-by-reference path honours the global filters. The merge
     * produces only narrowing filters; the server-injected RBAC row-scope ({@code applyScope}) is
     * still layered on top by the planner and is never widened here.
     */
    private JsonNode resolveKpiRef(JsonNode queryNode, String tenantId, Set<String> callerRoles) {
        if (!queryNode.has("kpiId")) return queryNode;

        String kpiId = queryNode.get("kpiId").asText();
        Optional<KpiDefinition> def = kpiCatalogService.getDef(kpiId, tenantId);
        if (def.isEmpty() || !def.get().isPublished() || !def.get().isVisibleTo(callerRoles)) {
            log.debug("kpiId '{}' not found or not authorized (roles={})", kpiId, callerRoles);
            return null;
        }
        // #1026: apply the def's declared params[].default for any param the caller omitted.
        // Precedence: explicit caller param > declared default > the def's baked query.
        JsonNode effectiveParams = withDeclaredDefaults(def.get(), queryNode.get("params"));

        // C1: validate the EFFECTIVE window param against the def's params.allowed allow-list
        // (the def is in scope here). An out-of-list window must be a per-entry invalid_param,
        // not silently honoured by the composer/planner (which accept any well-formed window).
        validateWindowParam(def.get(), effectiveParams);

        JsonNode storedQuery = def.get().getQuery();
        if (storedQuery == null || storedQuery.isNull())
            // D1a backend-composed defs are intercepted by maybeComposeResult before this point;
            // a query:null def WITHOUT a valid compose op is a genuine misconfiguration.
            throw new IllegalArgumentException("invalid_kpi: KPI '" + kpiId + "' has no query defined");
        return queryComposer.mergeParams(storedQuery, effectiveParams);
    }

    /**
     * #1026 — server-side application of the def's declared {@code params[].default}. Any declared
     * param with a non-empty default that the caller did NOT supply is filled in, so a bare
     * {@code {kpiId}} reference behaves like the dashboard's default global-filter state instead of
     * silently ignoring the declared default. Precedence: explicit caller param > declared default
     * > the def's baked query (a defaulted param flows through {@link KpiQueryComposer#mergeParams}
     * exactly like a caller-sent one, and the C1 window allow-list check runs on the EFFECTIVE
     * params). Returns {@code reqParams} untouched (possibly null) when no default applies.
     */
    private JsonNode withDeclaredDefaults(KpiDefinition def, JsonNode reqParams) {
        List<KpiDefinition.KpiParam> declared = def.getParams();
        if (declared == null || declared.isEmpty()) return reqParams;
        com.fasterxml.jackson.databind.node.ObjectNode merged = null;
        for (KpiDefinition.KpiParam p : declared) {
            if (p == null || p.getName() == null) continue;
            String dflt = p.getDefaultValue();
            if (dflt == null || dflt.isEmpty()) continue;
            if (reqParams != null && reqParams.hasNonNull(p.getName())) continue;   // explicit wins
            if (merged == null) {
                merged = com.fasterxml.jackson.databind.node.JsonNodeFactory.instance.objectNode();
                if (reqParams != null && reqParams.isObject())
                    merged.setAll((com.fasterxml.jackson.databind.node.ObjectNode) reqParams);
            }
            merged.put(p.getName(), dflt);
        }
        return merged != null ? merged : reqParams;
    }

    /**
     * C1 — window allow-list enforcement. If the request {@code params} carries a {@code window}
     * and the def declares a {@code window} param with a non-empty {@code allowed} list, the value
     * must be in that list. Out-of-list (incl. arbitrary {@code last_Nd}) → {@code invalid_param}.
     * No-op when the def declares no allow-list for {@code window} (open window).
     */
    private void validateWindowParam(KpiDefinition def, JsonNode reqParams) {
        if (reqParams == null || !reqParams.hasNonNull("window")) return;
        String requested = reqParams.get("window").asText();
        if (requested.isEmpty()) return;
        if (def.getParams() == null) return;
        for (KpiDefinition.KpiParam p : def.getParams()) {
            if (p != null && "window".equals(p.getName())) {
                List<String> allowed = p.getAllowed();
                if (allowed != null && !allowed.isEmpty() && !allowed.contains(requested))
                    throw new IllegalArgumentException(
                            "invalid_param: window '" + requested + "' is not allowed for KPI '" + def.getId()
                                    + "'; allowed=" + allowed);
                return;
            }
        }
    }

    /**
     * D1a — BACKEND compose-resolver. When {@code queryNode} references (by {@code kpiId}) a def with
     * {@code query:null} + a {@code viz.compose} op + {@code sourceKpiIds}, recursively resolve each
     * source kpiId (re-applying the SAME request params, RBAC visibility and row-scope), run them, and
     * compute the compose op into a scalar result shaped like every other scalar KPI
     * ({@code rows:[{<valueKey>:v}], columns, rowCount, grain:"compose"}).
     *
     * <p>Returns {@code null} when this is NOT a backend-compose ref (caller proceeds normally). For a
     * compose def that is not found / not visible, returns a {@code kpi_forbidden} result map (parity
     * with the kpiId path). Ports the 4 ops from the FE {@code composeKpi.js}: {@code dailyAvgFromWeekly},
     * {@code hourlyAvgFromDaily}, {@code openRateComplement}, {@code netBacklogDaily}.
     */
    private Map<String,Object> maybeComposeResult(JsonNode queryNode, AnalyticsScope scope,
                                                  String tenantId, Set<String> callerRoles,
                                                  QueryTelemetry tel, String entryName) {
        if (queryNode == null || !queryNode.has("kpiId")) return null;
        String kpiId = queryNode.get("kpiId").asText();
        Optional<KpiDefinition> defOpt = kpiCatalogService.getDef(kpiId, tenantId);
        if (defOpt.isEmpty() || !isComposeDef(defOpt.get())) return null;   // not a compose ref → normal path

        KpiDefinition def = defOpt.get();
        if (!def.isPublished() || !def.isVisibleTo(callerRoles))
            return Map.of("error", "kpi_forbidden", "message", "KPI not found or not authorized for role set");

        // #1026: apply the compose def's declared params[].default before validation/propagation,
        // so a bare {kpiId} compose ref honours its declared defaults too (explicit caller wins).
        JsonNode params = withDeclaredDefaults(def, queryNode.get("params"));

        // C1: the compose def's window allow-list still applies to the effective params.
        validateWindowParam(def, params);

        JsonNode compose = def.getViz().getCompose();
        String type = compose.get("type").asText();

        // Resolve + run each source kpiId with the same params, RBAC and row-scope.
        // #1110/R9: each SOURCE query records its own metric point and joins the per-request
        // slow-query pool (attributed to its own kpiId, under the composed entry's name).
        List<Map<String,Object>> sourceRows = new ArrayList<>();
        for (JsonNode srcId : compose.get("sourceKpiIds")) {
            JsonNode srcRef = synthRef(srcId.asText(), params);
            JsonNode srcQuery = resolveKpiRef(srcRef, tenantId, callerRoles);
            if (srcQuery == null)
                throw new IllegalArgumentException("kpi_forbidden: compose source '" + srcId.asText() + "' not authorized");
            Map<String,Object> r = runOne(srcQuery, scope, tel, entryName, srcId.asText());
            sourceRows.add(firstRow(r));
        }

        Double value = computeCompose(type, compose, sourceRows);
        String valueKey = def.getViz().getValueKey() != null ? def.getViz().getValueKey() : "value";
        Map<String,Object> row = new LinkedHashMap<>();
        row.put(valueKey, value);
        Map<String,Object> out = new LinkedHashMap<>();
        out.put("grain", "compose");
        out.put("columns", List.of(valueKey));
        out.put("rows", List.of(row));
        out.put("rowCount", 1);
        out.put("compose", type);
        return out;
    }

    /** Build a synthetic {kpiId, params} ref node so a source kpiId resolves through the normal path. */
    private JsonNode synthRef(String kpiId, JsonNode params) {
        com.fasterxml.jackson.databind.node.ObjectNode n =
                com.fasterxml.jackson.databind.node.JsonNodeFactory.instance.objectNode();
        n.put("kpiId", kpiId);
        if (params != null && !params.isNull()) n.set("params", params);
        return n;
    }

    /** First result row (or an empty map) from a runOne() result. */
    @SuppressWarnings("unchecked")
    private Map<String,Object> firstRow(Map<String,Object> r) {
        Object rows = r == null ? null : r.get("rows");
        if (rows instanceof List && !((List<?>) rows).isEmpty()) {
            Object r0 = ((List<?>) rows).get(0);
            if (r0 instanceof Map) return (Map<String,Object>) r0;
        }
        return Collections.emptyMap();
    }

    private Double num(Map<String,Object> row, String key) {
        Object v = row == null ? null : row.get(key);
        return (v instanceof Number) ? ((Number) v).doubleValue() : null;
    }

    /**
     * Compute the compose op against the source rows. Faithful port of {@code composeKpi.js}:
     * the *_Avg ops divide the source total by the elapsed days/hours since the start of the
     * current week/day (in the dashboard EAT zone), measured from {@link #asOf()} (server clock
     * authority, mirroring the FE's use of {@code results[..].asOf}).
     */
    private Double computeCompose(String type, JsonNode compose, List<Map<String,Object>> src) {
        switch (type) {
            case "openRateComplement": {
                // pct is a 0..1 ratio (the planner's round(.. ,4)); complement -> percentage points.
                Double pct = num(src.get(0), "pct");
                if (pct == null) pct = num(src.get(0), "total");
                return pct == null ? null : (1.0 - pct) * 100.0;
            }
            case "netBacklogDaily": {
                double inflow  = orZero(num(src.get(0), "total"));
                double outflow = src.size() > 1 ? orZero(num(src.get(1), "total")) : 0.0;
                return inflow - outflow;
            }
            case "dailyAvgFromWeekly": {
                double total = orZero(num(src.get(0), "total"));
                if (!compose.path("elapsedFromAsOf").asBoolean(false)) return null;
                long elapsed = elapsedDaysSinceStartOfWeek(asOf());
                return elapsed > 0 ? total / elapsed : null;
            }
            case "hourlyAvgFromDaily": {
                double total = orZero(num(src.get(0), "total"));
                if (!compose.path("elapsedFromAsOf").asBoolean(false)) return null;
                long elapsed = elapsedHoursSinceStartOfDay(asOf());
                return elapsed > 0 ? total / elapsed : null;
            }
            default:
                throw new IllegalArgumentException("invalid_kpi: unsupported compose op '" + type + "'");
        }
    }

    private double orZero(Double d) { return d == null ? 0.0 : d; }

    /** EAT zone for week/day-start, matching {@link AnalyticsPlanner}/{@link KpiQueryComposer}. */
    private static final java.time.ZoneId EAT = java.time.ZoneId.of("Africa/Nairobi");

    /** FE elapsedDaysSince(startOfWeek(asOf), asOf): max(1, floor((asOf-weekStart)/day)). startOfWeek = Sunday (JS getDay). */
    private long elapsedDaysSinceStartOfWeek(long asOfMs) {
        java.time.ZonedDateTime now = java.time.Instant.ofEpochMilli(asOfMs).atZone(EAT);
        // FE startOfWeek: d.getDate() - d.getDay() => previous (or same) Sunday at local midnight.
        java.time.ZonedDateTime weekStart = now.toLocalDate()
                .with(java.time.temporal.TemporalAdjusters.previousOrSame(java.time.DayOfWeek.SUNDAY))
                .atStartOfDay(EAT);
        long ms = asOfMs - weekStart.toInstant().toEpochMilli();
        return Math.max(1, ms / 86_400_000L);
    }

    /** FE elapsedHoursSince(startOfDay(asOf), asOf): max(1, floor((asOf-dayStart)/hour)). */
    private long elapsedHoursSinceStartOfDay(long asOfMs) {
        java.time.ZonedDateTime now = java.time.Instant.ofEpochMilli(asOfMs).atZone(EAT);
        long dayStart = now.toLocalDate().atStartOfDay(EAT).toInstant().toEpochMilli();
        long ms = asOfMs - dayStart;
        return Math.max(1, ms / 3_600_000L);
    }

    /** A def is backend-composed when it has no query, a viz.compose op, and source kpiIds (D1a). */
    private boolean isComposeDef(KpiDefinition def) {
        JsonNode compose = def.getViz() == null ? null : def.getViz().getCompose();
        return (def.getQuery() == null || def.getQuery().isNull())
                && compose != null && compose.isObject()
                && compose.hasNonNull("type")
                && compose.has("sourceKpiIds") && compose.get("sourceKpiIds").isArray()
                && compose.get("sourceKpiIds").size() > 0;
    }

    /**
     * Inline-query PII gate. Returns true when {@code queryNode} projects (in its
     * {@code dimensions} array) at least one officer-PII column ({@link #PII_DIMENSIONS})
     * AND the caller holds none of the {@link #OFFICER_PII_ROLES}. Only DIMENSION projection
     * is gated; aggregate measures ({@code count_distinct} over a PII column) are not, since
     * they never expose individual UUIDs. Caller is responsible for invoking this only on the
     * INLINE path (no {@code kpiId}); the kpiId path enforces {@code visibleTo} separately.
     */
    boolean projectsForbiddenPii(JsonNode queryNode, Set<String> callerRoles) {
        if (queryNode == null || !queryNode.has("dimensions") || !queryNode.get("dimensions").isArray())
            return false;
        boolean projectsPii = false;
        for (JsonNode d : queryNode.get("dimensions")) {
            if (d != null && d.isTextual() && PII_DIMENSIONS.contains(d.asText())) { projectsPii = true; break; }
        }
        if (!projectsPii) return false;
        // authorized iff the caller holds any officer-PII role
        return callerRoles == null || callerRoles.stream().noneMatch(OFFICER_PII_ROLES::contains);
    }

    /**
     * Execute one planned query. THE choke point for every analytics SQL execution
     * (batch entries, the single-query arm, compose SOURCE queries) — each successful run
     * records one OTEL metric point + one slow-query-pool entry (#1110).
     *
     * @param entryName the batch dict key this run belongs to ({@code "query"} on the
     *                  single arm); compose sources share their composed entry's name
     * @param kpiId     the resolved KPI id, or {@code "inline"} for inline-grammar queries
     */
    private Map<String,Object> runOne(JsonNode q, AnalyticsScope scope, QueryTelemetry tel,
                                      String entryName, String kpiId){
        AnalyticsPlanner.Planned p = planner.plan(q, scope);
        long t0 = System.currentTimeMillis();
        List<Map<String,Object>> rows = jdbc.queryForList(p.sql, p.params.toArray());
        long tookMs = System.currentTimeMillis() - t0;
        if (tel != null) tel.record(entryName, kpiId, p.grain, tookMs, rows.size());
        Map<String,Object> r = new LinkedHashMap<>();
        r.put("grain", p.grain);
        r.put("columns", p.columns);
        r.put("rows", rows);
        r.put("rowCount", rows.size());
        r.put("tookMs", tookMs);
        return r;
    }

    /** Metric attribution for a request query node: its kpiId, or {@code "inline"}. */
    private static String kpiContext(JsonNode queryNode) {
        return queryNode != null && queryNode.hasNonNull("kpiId")
                ? queryNode.get("kpiId").asText() : "inline";
    }

    /** /_schema capabilities — lets the FE build the KPI editor dynamically. */
    public Map<String,Object> schema(){
        Map<String,Object> out = new LinkedHashMap<>();
        out.put("aggFns", AnalyticsCatalog.AGG_FNS);
        out.put("filterOps", Arrays.asList("eq","ne","gt","gte","lt","lte","in","isnull","starts_with"));
        out.put("windows", Arrays.asList("all","live","last_<N>d","wtd","mtd","qtd","ytd"));
        out.put("timeBuckets", Arrays.asList("day","week","month","quarter","year"));
        Map<String,Object> grains = new LinkedHashMap<>();
        for (Grain g : catalog.grains()) {
            Map<String,Object> gi = new LinkedHashMap<>();
            gi.put("timeRoles", g.timeRoles.keySet());
            gi.put("defaultTimeRole", g.defaultTimeRole);
            gi.put("dimensions", g.groupable);
            gi.put("filterable", g.filterable);
            gi.put("prefixFilterable", g.prefixFilterable);   // #1079: starts_with-eligible path columns
            gi.put("measurable", g.measurable);
            gi.put("distinctCountable", g.distinctable);
            gi.put("scopeColumns", scopeCols(g));
            grains.put(g.name, gi);
        }
        out.put("grains", grains);
        out.put("notes", "Closed grammar over an open catalog: any listed column is queryable; "
                + "UUID columns are groupable/distinct-countable but not filterable; RBAC scope is server-injected.");
        return out;
    }

    private List<String> scopeCols(Grain g){
        List<String> l = new ArrayList<>();
        if (g.tenantColumn != null) l.add("tenant:" + g.tenantColumn);
        if (g.boundaryColumn != null) l.add("boundary:" + g.boundaryColumn);
        if (g.citizenColumn != null) l.add("citizen:" + g.citizenColumn);
        return l;
    }

    private Long asOf(){
        try { return jdbc.queryForObject("SELECT max(facts_built_at) FROM complaint_facts", Long.class); }
        catch (Exception e) { return System.currentTimeMillis(); }
    }

    // ---- #1110: tenant record-count for /packs (record_count_tier tag source) ----

    private static final long RECORD_COUNT_TTL_MS = 5 * 60_000L;
    /** tenantId -> [count, expiresAtMs]. Concurrent; a stale entry is simply recomputed. */
    private final java.util.concurrent.ConcurrentHashMap<String, long[]> recordCountCache =
            new java.util.concurrent.ConcurrentHashMap<>();
    /** Injectable clock for cache-expiry tests (see AnalyticsServiceRecordCountTest). */
    private java.util.function.LongSupplier recordCountClock = System::currentTimeMillis;

    /**
     * TENANT-CORPUS size of {@code complaint_facts} — how many fact rows exist for the
     * tenant subtree, using {@link AnalyticsPlanner#applyScope}'s tenant semantics
     * (state level: {@code tenant_id LIKE 'ke%'}; city level: exact match). This is
     * deliberately NOT the caller's ABAC-visible subset: the dashboard uses it as the
     * {@code record_count_tier} tag, which must describe the tenant's data volume so
     * render-lag comparisons across personas share a denominator (#1110/R9-C9).
     *
     * <p>Cached in-memory for 5 minutes per tenant; errors return null (additive,
     * never fails the /packs response) and are not cached.
     */
    public Long recordCount(String tenantId, int stateLevelLen) {
        if (tenantId == null || tenantId.isEmpty()) return null;
        long now = recordCountClock.getAsLong();
        long[] cached = recordCountCache.get(tenantId);
        if (cached != null && cached[1] > now) return cached[0];
        // same state-level test as PrincipalScopeResolver.resolve()
        boolean stateLevel = tenantId.split("\\.").length == stateLevelLen;
        try {
            Long count = stateLevel
                    ? jdbc.queryForObject("SELECT count(*) FROM complaint_facts WHERE tenant_id LIKE ?",
                                          Long.class, tenantId + "%")
                    : jdbc.queryForObject("SELECT count(*) FROM complaint_facts WHERE tenant_id = ?",
                                          Long.class, tenantId);
            if (count == null) return null;
            recordCountCache.put(tenantId, new long[]{count, now + RECORD_COUNT_TTL_MS});
            return count;
        } catch (Exception e) {
            log.debug("recordCount for tenant {} failed (returning null)", tenantId, e);
            return null;
        }
    }

    private Map<String,Object> scopeInfo(AnalyticsScope s){
        Map<String,Object> m = new LinkedHashMap<>();
        m.put("tenantId", s.tenantId);
        m.put("level", s.tenantStateLevel ? "state" : "city");
        if (s.citizenUuid != null) m.put("restrictedTo", "own-records");
        if (s.boundaryPrefix != null) m.put("boundaryPrefix", s.boundaryPrefix);
        if (s.departmentCodes != null && !s.departmentCodes.isEmpty()) m.put("departments", s.departmentCodes);
        return m;
    }

    private Map<String,Object> err(Exception ex){
        Map<String,Object> m = new LinkedHashMap<>();
        String msg = ex.getMessage()==null ? ex.toString() : ex.getMessage();
        String code = msg.contains(":") ? msg.substring(0, msg.indexOf(':')) : "query_failed";
        m.put("error", code); m.put("message", msg);
        return m;
    }

    /**
     * Extract role codes from RequestInfo.userInfo.roles — mirrors AnalyticsScope role extraction.
     * An anonymous caller (no userInfo, or userInfo with no roles) degrades to the {@link #PUBLIC_ROLE}
     * floor — NOT to an empty set (which {@link KpiDefinition#isVisibleTo} would have read as "no
     * ceiling => visible", the old fail-open that let anonymous read every visibleTo:[] tile).
     */
    private Set<String> extractRoles(RequestInfo requestInfo) {
        if (requestInfo == null) return Set.of(PUBLIC_ROLE);
        User u = requestInfo.getUserInfo();
        if (u == null || u.getRoles() == null) return Set.of(PUBLIC_ROLE);
        Set<String> roles = u.getRoles().stream()
                .filter(r -> r != null && r.getCode() != null)
                .map(Role::getCode)
                .collect(Collectors.toSet());
        return roles.isEmpty() ? Set.of(PUBLIC_ROLE) : roles;
    }

    /** True when this is the unauthenticated public-floor caller (only PUBLIC-eligible KPIs, no inline). */
    private boolean isPublicFloor(Set<String> callerRoles) {
        return callerRoles != null && callerRoles.size() == 1 && callerRoles.contains(PUBLIC_ROLE);
    }
}
