package org.egov.pgr.analytics;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import lombok.extern.slf4j.Slf4j;
import org.egov.common.contract.request.RequestInfo;
import org.egov.pgr.analytics.AnalyticsCatalog.Grain;
import org.egov.pgr.analytics.model.KpiDefinition;
import org.egov.pgr.policy.PgrSearchScope;
import org.egov.pgr.config.PGRConfiguration;
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
     * Synthetic role for an unauthenticated / no-role caller (the "public floor", 70-view-management
     * §"Public (no login)"). An anonymous request degrades to THIS rather than to unrestricted-admin:
     * it may see only KPIs whose {@code rbac.visibleTo} explicitly lists {@code PUBLIC} (curated,
     * aggregate-only, no PII), and may NOT run inline (non-kpiId) queries. Tenant-aggregate scope is
     * still applied. This is the deliberate "degrade-to-public-floor", not a blanket lock-out.
     */
    /** Hard request budget: batch entries execute sequentially and each may hit PostgreSQL. */
    static final int MAX_BATCH_QUERIES = 50;

    /**
     * The only query params a PUBLIC-floor caller may attach to a KPI reference (#1797): the
     * dashboard's global filter bar. Enforced HERE — on every path that resolves a kpiId for the
     * public floor, not only the {@code /public/_query} alias — because Kong's audit mode
     * ({@code ENFORCE_UNAUTH=false}) still lets an anonymous body reach {@code /_query}, where it
     * degrades to the same PUBLIC floor. Each is a narrowing predicate the composer layers under
     * the def's own query; none can switch the aggregation level ({@code hierLevel}), fan out
     * companions ({@code compare}/{@code series}) or override the def's named {@code window}.
     * Values are scalar strings, length-capped, and dates must be ISO calendar days supplied as a
     * pair.
     */
    static final Set<String> PUBLIC_QUERY_PARAMS =
            Set.of("dateFrom", "dateTo", "ward", "serviceCode", "complaintPath");
    static final int PUBLIC_QUERY_PARAM_MAX_LENGTH = 128;
    private static final java.util.regex.Pattern ISO_DAY =
            java.util.regex.Pattern.compile("\\d{4}-\\d{2}-\\d{2}");

    /**
     * Public narrowing param -> the grain column it binds. A PUBLIC def that already filters that
     * column (e.g. "water complaints" with a baked {@code service_code} eq) must keep its own
     * predicate: the composer's {@link KpiQueryComposer} REPLACES an existing eq rather than
     * intersecting with it, which for an anonymous caller would turn a curated subset tile into
     * a "count anything" primitive. Such params are dropped and reported as {@code paramsIgnored}.
     */
    private static final Map<String,String> PUBLIC_PARAM_COLUMNS = Map.of(
            "ward", "ward_code",
            "serviceCode", "service_code",
            "complaintPath", "complaint_node_path");

    /**
     * Rebuild a public ref's {@code params} from the allow-list. Returns null for an absent or
     * empty object (the ref stays bare); throws {@code invalid_param} for any foreign key,
     * non-scalar or blank value, over-long value, non-ISO-day date, or incomplete date range.
     */
    static ObjectNode sanitizePublicParams(JsonNode params) {
        if (params == null || params.isNull()) return null;
        if (!params.isObject())
            throw new IllegalArgumentException("invalid_param: public params must be an object");
        if (params.isEmpty()) return null;
        ObjectNode clean = JsonNodeFactory.instance.objectNode();
        for (Iterator<Map.Entry<String,JsonNode>> it = params.fields(); it.hasNext();) {
            Map.Entry<String,JsonNode> e = it.next();
            String name = e.getKey();
            JsonNode v = e.getValue();
            if (!PUBLIC_QUERY_PARAMS.contains(name))
                throw new IllegalArgumentException("invalid_param: public queries accept only "
                        + new TreeSet<>(PUBLIC_QUERY_PARAMS) + "; got '" + name + "'");
            if (v == null || !v.isValueNode() || v.isNull() || v.asText().trim().isEmpty())
                throw new IllegalArgumentException("invalid_param: " + name + " must be a non-empty scalar value");
            String text = v.asText().trim();
            if (text.length() > PUBLIC_QUERY_PARAM_MAX_LENGTH)
                throw new IllegalArgumentException("invalid_param: " + name + " exceeds "
                        + PUBLIC_QUERY_PARAM_MAX_LENGTH + " characters");
            if ((name.equals("dateFrom") || name.equals("dateTo")) && !ISO_DAY.matcher(text).matches())
                throw new IllegalArgumentException("invalid_param: " + name + " must be yyyy-MM-dd");
            clean.put(name, text);
        }
        if (clean.has("dateFrom") != clean.has("dateTo"))
            throw new IllegalArgumentException(
                    "invalid_param: dateFrom and dateTo must be supplied together");
        return clean;
    }

    /**
     * Public-floor view of a kpiId reference: {@code kpiId} plus sanitized {@code params} and
     * nothing else. Inline bodies are rejected by the caller before this runs.
     */
    static ObjectNode publicFloorRef(JsonNode queryNode) {
        ObjectNode ref = JsonNodeFactory.instance.objectNode();
        ref.set("kpiId", queryNode.get("kpiId"));
        ObjectNode params = sanitizePublicParams(queryNode.get("params"));
        if (params != null) ref.set("params", params);
        return ref;
    }

    /** Drop public params whose column the def's own query already filters (see PUBLIC_PARAM_COLUMNS). */
    private static JsonNode withoutBakedNarrowings(KpiDefinition def, JsonNode params, List<String> paramsIgnored) {
        if (params == null || !params.isObject()) return params;
        JsonNode filters = def.getQuery() == null ? null : def.getQuery().get("filters");
        if (filters == null || !filters.isObject()) return params;
        ObjectNode out = null;
        for (Map.Entry<String,String> e : PUBLIC_PARAM_COLUMNS.entrySet()) {
            if (params.has(e.getKey()) && filters.has(e.getValue())) {
                if (out == null) out = ((ObjectNode) params).deepCopy();
                out.remove(e.getKey());
                if (paramsIgnored != null && !paramsIgnored.contains(e.getKey())) paramsIgnored.add(e.getKey());
            }
        }
        return out == null ? params : out;
    }

    private final AnalyticsPlanner planner;
    private final AnalyticsCatalog catalog;
    private final JdbcTemplate jdbc;
    private final KpiCatalogService kpiCatalogService;
    private final AnalyticsRowScopeResolver scopeResolver;
    private final KpiQueryComposer queryComposer;
    private final AnalyticsMetrics metrics;
    private final PGRConfiguration config;
    /** Injectable request clock; captured once so every query in a batch shares one calendar. */
    private java.util.function.LongSupplier requestClock = System::currentTimeMillis;

    @Autowired
    public AnalyticsService(AnalyticsPlanner planner, AnalyticsCatalog catalog, JdbcTemplate jdbc,
                            KpiCatalogService kpiCatalogService, AnalyticsRowScopeResolver scopeResolver,
                            KpiQueryComposer queryComposer, AnalyticsMetrics metrics,
                            PGRConfiguration config){
        this.planner = planner; this.catalog = catalog; this.jdbc = jdbc;
        this.kpiCatalogService = kpiCatalogService; this.scopeResolver = scopeResolver;
        this.queryComposer = queryComposer; this.metrics = metrics; this.config = config;
    }

    /** Back-compat entry point (no trace correlation header). */
    public Map<String,Object> query(JsonNode body, RequestInfo requestInfo, AnalyticsCapabilities capabilities,
                                    String tenantId, int stateLevelLen){
        return query(body, requestInfo, capabilities, tenantId, stateLevelLen, null);
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
    public Map<String,Object> query(JsonNode body, RequestInfo requestInfo, AnalyticsCapabilities capabilities,
                                    String tenantId, int stateLevelLen, String headerTraceId){
        QueryTelemetry tel = new QueryTelemetry(metrics, tenantId, stateLevelLen);
        try {
            return doQuery(body, requestInfo, capabilities, tenantId, stateLevelLen, tel);
        } finally {
            if (!tel.isEmpty())
                log.info(tel.slowQueryLine(QueryTelemetry.resolveTraceId(headerTraceId)));
        }
    }

    private Map<String,Object> doQuery(JsonNode body, RequestInfo requestInfo, AnalyticsCapabilities capabilities,
                                       String tenantId, int stateLevelLen, QueryTelemetry tel){
        if (tenantId == null || tenantId.isEmpty()) throw new IllegalArgumentException("invalid_param: tenantId is required");
        if (body.has("queries")) validateBatchSize(body.get("queries"));
        // Action 2008's authored policy, resolved by the ABAC engine — the identical scope
        // /v2/request/_search runs under, so the two surfaces cannot disagree about a caller.
        //
        // The anonymous surface has no identity to resolve, so it never asks. Sending it down the
        // policy path would fail the request outright: with no roles there is no role-scoped action
        // lookup to make, and the engine correctly refuses rather than guessing. Its scope is the
        // tenant aggregate, and what it may SEE is decided by the catalog's own `public` markers.
        PgrSearchScope scope = capabilities.isPublicSurface()
                ? AnalyticsRowScopeResolver.publicSurfaceScope(tenantId, isStateLevel(tenantId, stateLevelLen))
                : scopeResolver.resolve(requestInfo, tenantId, stateLevelLen);
        boolean publicFloor = capabilities.isPublicSurface();

        // Data freshness and request time are deliberately separate. factsAsOfMs may be null for an
        // empty materialized view, while named windows must use the current request instant rather
        // than becoming stale when the refresh scheduler stalls. Capture request time exactly once
        // so planner, composer, compose ops and response calendar still share one coherent clock.
        Long factsAsOfMs = asOf();
        long requestNowMs = requestClock.getAsLong();
        BusinessCalendar calendar = BusinessCalendar.of(
                kpiCatalogService.resolveTimeZone(tenantId), requestNowMs);

        Map<String,Object> out = new LinkedHashMap<>();
        out.put("asOf", factsAsOfMs);
        out.put("calendar", calendarInfo(calendar));
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
                    // ... and only the filter-bar params (#1797) — an out-of-list param is a
                    // per-entry invalid_param, whichever gateway path the body arrived through.
                    if (publicFloor) queryNode = publicFloorRef(queryNode);
                    // D1a: backend-composed defs (query:null + viz.compose) resolve recursively here.
                    Map<String,Object> composed = maybeComposeResult(queryNode, scope, tenantId, capabilities, tel, name, calendar);
                    if (composed != null) { results.put(name, composed); continue; }

                    List<String> paramsIgnored = new ArrayList<>();
                    JsonNode actualQueryNode = resolveKpiRef(queryNode, tenantId, capabilities, paramsIgnored, calendar);
                    if (actualQueryNode == null) {
                        partial = true;
                        results.put(name, Map.of("error", "kpi_forbidden",
                                "message", "KPI not found or not authorized for this caller"));
                        continue;
                    }
                    // INLINE-only PII gate: the kpiId path already enforced visibleTo above; an inline
                    // body (no kpiId) bypasses that, so block inline projection of officer-PII dimensions
                    // unless the caller holds an officer-PII-authorized role.
                    if (!queryNode.has("kpiId") && projectsForbiddenPii(actualQueryNode, capabilities)) {
                        partial = true;
                        results.put(name, Map.of("error", "pii_forbidden",
                                "message", "inline query projects officer-PII dimension(s); caller lacks the officer capability"));
                        continue;
                    }
                    Map<String,Object> result = runOne(actualQueryNode, scope, tel, name, kpiContext(queryNode), calendar);
                    if (!paramsIgnored.isEmpty()) result.put("paramsIgnored", paramsIgnored);
                    results.put(name, result);
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
            if (publicFloor) queryNode = publicFloorRef(queryNode);
            Map<String,Object> composed = maybeComposeResult(queryNode, scope, tenantId, capabilities, tel, "query", calendar);
            if (composed != null) { out.putAll(composed); return out; }
            List<String> paramsIgnored = new ArrayList<>();
            JsonNode actualQueryNode = resolveKpiRef(queryNode, tenantId, capabilities, paramsIgnored, calendar);
            if (actualQueryNode == null)
                throw new IllegalArgumentException("kpi_forbidden: KPI not found or not authorized");
            if (!queryNode.has("kpiId") && projectsForbiddenPii(actualQueryNode, capabilities))
                throw new IllegalArgumentException("pii_forbidden: inline query projects officer-PII dimension(s); caller lacks the officer capability");
            out.putAll(runOne(actualQueryNode, scope, tel, "query", kpiContext(queryNode), calendar));
            if (!paramsIgnored.isEmpty()) out.put("paramsIgnored", paramsIgnored);
        } else {
            throw new IllegalArgumentException("invalid_param: body must contain 'query' or 'queries'");
        }
        return out;
    }

    /** Same state-level test the scope resolvers use, for the anonymous tenant-only scope. */
    private static boolean isStateLevel(String tenantId, int stateLevelLen) {
        return tenantId != null && tenantId.split("\\.").length == stateLevelLen;
    }

    /**
     * The two filter-bar option sources the dashboard derives from ABAC-scoped distincts (the
     * employee FE posts these verbatim as an inline batch; see useFilterOptions.OPTION_QUERIES).
     * Fixed server-owned shape so the public arm can serve them without accepting an inline body.
     */
    static final String PUBLIC_OPTIONS_WARDS = "wards";
    static final String PUBLIC_OPTIONS_COMPLAINT_TYPES = "complaintTypes";
    private static final int PUBLIC_OPTIONS_LIMIT = 300;

    /**
     * Anonymous filter-bar options (#1797). The public floor forbids inline queries — an inline
     * body bypasses the catalog's PUBLIC opt-in — so the two distinct-dimension queries the
     * employee filter bar runs inline are built HERE from constants, with no caller input beyond
     * the tenant, and executed under the anonymous tenant-aggregate scope. The response mirrors
     * the batch envelope ({@code results.wards.rows[].ward_code},
     * {@code results.complaintTypes.rows[].service_code}) so the dashboard's option builder is
     * shared between the two surfaces, but the per-code counts are dropped: a public caller
     * learns WHICH codes carry complaints, never how many.
     */
    public Map<String,Object> publicFilterOptions(String tenantId, int stateLevelLen, String headerTraceId){
        if (tenantId == null || tenantId.isEmpty()) throw new IllegalArgumentException("invalid_param: tenantId is required");
        QueryTelemetry tel = new QueryTelemetry(metrics, tenantId, stateLevelLen);
        try {
            PgrSearchScope scope = AnalyticsRowScopeResolver.publicSurfaceScope(
                    tenantId, isStateLevel(tenantId, stateLevelLen));
            BusinessCalendar calendar = BusinessCalendar.of(
                    kpiCatalogService.resolveTimeZone(tenantId), requestClock.getAsLong());
            Map<String,Object> results = new LinkedHashMap<>();
            boolean partial = false;
            Map<String,String> sources = new LinkedHashMap<>();
            sources.put(PUBLIC_OPTIONS_WARDS, "ward_code");
            sources.put(PUBLIC_OPTIONS_COMPLAINT_TYPES, "service_code");
            for (Map.Entry<String,String> src : sources.entrySet()) {
                try {
                    Map<String,Object> r = runOne(distinctDimensionQuery(src.getValue()), scope, tel,
                            src.getKey(), "public-options", calendar);
                    results.put(src.getKey(), codesOnly(r, src.getValue()));
                } catch (Exception ex) {
                    // Anonymous envelope: the driver/SQL detail belongs only in the server log.
                    log.warn("public filter options: {} distinct failed", src.getKey(), ex);
                    partial = true;
                    results.put(src.getKey(), Map.of("error", "query_failed",
                            "message", "filter options are unavailable"));
                }
            }
            Map<String,Object> out = new LinkedHashMap<>();
            out.put("asOf", asOf());
            out.put("calendar", calendarInfo(calendar));
            out.put("scope", scopeInfo(scope));
            out.put("results", results);
            out.put("partial", partial);
            return out;
        } finally {
            if (!tel.isEmpty())
                log.info(tel.slowQueryLine(QueryTelemetry.resolveTraceId(headerTraceId)));
        }
    }

    /** {@code SELECT <dimension>, count(*) FROM facts (all time)} — the filter bar's distinct source. */
    private JsonNode distinctDimensionQuery(String dimension) {
        ObjectNode q = JsonNodeFactory.instance.objectNode();
        q.put("grain", "facts");
        q.putObject("window").put("name", "all");
        q.putArray("dimensions").add(dimension);
        q.putArray("measures").addObject().put("name", "n").put("agg", "count");
        q.put("limit", PUBLIC_OPTIONS_LIMIT);
        return q;
    }

    /** Project a distinct result down to its dimension column: no counts, no timing. */
    @SuppressWarnings("unchecked")
    private static Map<String,Object> codesOnly(Map<String,Object> result, String dimension) {
        List<Map<String,Object>> rows = new ArrayList<>();
        Object rawRows = result.get("rows");
        if (rawRows instanceof List) {
            for (Object row : (List<Object>) rawRows) {
                if (!(row instanceof Map)) continue;
                Object code = ((Map<String,Object>) row).get(dimension);
                if (code == null || code.toString().trim().isEmpty()) continue;
                rows.add(Collections.singletonMap(dimension, code));
            }
        }
        Map<String,Object> out = new LinkedHashMap<>();
        out.put("columns", Collections.singletonList(dimension));
        out.put("rows", rows);
        out.put("rowCount", rows.size());
        return out;
    }

    /** Reject oversized batches before principal resolution or any SQL execution. */
    static void validateBatchSize(JsonNode queries) {
        if (queries != null && queries.isObject() && queries.size() > MAX_BATCH_QUERIES)
            throw new IllegalArgumentException("invalid_param: queries may contain at most "
                    + MAX_BATCH_QUERIES + " entries");
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
     *
     * @param paramsIgnored collector (nullable) for supplied params the composer could not apply
     *                      to this def's grain and must report (today: {@code complaintPath} on
     *                      the path-less daily grain) — surfaced on the result envelope as
     *                      {@code paramsIgnored:[...]}
     */
    private JsonNode resolveKpiRef(JsonNode queryNode, String tenantId, AnalyticsCapabilities capabilities,
                                   List<String> paramsIgnored, BusinessCalendar calendar) {
        // Inline path: the suppression marker is composer-internal, so a caller-supplied one is
        // stripped rather than trusted. Replaying a logged effective query (which legitimately
        // carries it) must still be planned and validated, not short-circuited into a clean empty
        // result that masks whatever the planner would have rejected.
        if (!queryNode.has("kpiId")) return stripSuppressionMarker(queryNode);

        String kpiId = queryNode.get("kpiId").asText();
        Optional<KpiDefinition> def = kpiCatalogService.getDef(kpiId, tenantId);
        if (def.isEmpty() || !def.get().isPublished() || !capabilities.canSee(def.get())) {
            log.debug("kpiId '{}' not found or not reachable by capabilities {}", kpiId, capabilities.granted());
            return null;
        }
        boolean publicFloor = capabilities.isPublicSurface();
        // Public floor (#1797): a caller param may not displace a predicate the PUBLIC def bakes
        // itself. Do this before defaults so a rejected caller param is still reported accurately.
        JsonNode callerParams = publicFloor
                ? withoutBakedNarrowings(def.get(), queryNode.get("params"), paramsIgnored)
                : queryNode.get("params");
        // #1026: apply the def's declared params[].default for any param the caller omitted.
        // Precedence: explicit caller param > declared default > the def's baked query.
        JsonNode effectiveParams = withDeclaredDefaults(def.get(), callerParams);
        // A declared default is server configuration rather than a caller-supplied param, but it
        // must obey the same PUBLIC invariant: it cannot redefine a KPI whose identity is baked
        // into its query. Do not report such a default as ignored input because the caller did not
        // supply it.
        if (publicFloor)
            effectiveParams = withoutBakedNarrowings(def.get(), effectiveParams, null);

        // C1 (generalized in #1111/R3): validate EVERY effective param against the def's declared
        // params.allowed allow-list (the def is in scope here). An out-of-list value (window,
        // hierLevel, ...) must be a per-entry invalid_param, not silently honoured by the
        // composer/planner (which accept any well-formed value).
        validateAllowedParams(def.get(), effectiveParams);

        JsonNode storedQuery = def.get().getQuery();
        if (storedQuery == null || storedQuery.isNull())
            // D1a backend-composed defs are intercepted by maybeComposeResult before this point;
            // a query:null def WITHOUT a valid compose op is a genuine misconfiguration.
            throw new IllegalArgumentException("invalid_kpi: KPI '" + kpiId + "' has no query defined");
        return queryComposer.mergeParams(storedQuery, effectiveParams, paramsIgnored, calendar);
    }

    /**
     * #1026 — server-side application of the def's declared {@code params[].default}. Any declared
     * param with a non-empty default that the caller did NOT supply is filled in, so a bare
     * {@code {kpiId}} reference behaves like the dashboard's default global-filter state instead of
     * silently ignoring the declared default. Precedence: explicit caller param > declared default
     * > the def's baked query (a defaulted param flows through {@link KpiQueryComposer#mergeParams}
     * exactly like a caller-sent one, and the C1 window allow-list check runs on the EFFECTIVE
     * params). Returns {@code reqParams} untouched (possibly null) when no default applies.
     * An EMPTY-STRING default is a no-op (skipped like an absent one) — the dss.KpiDefinition
     * schema requires {@code default} on every params entry, so free-form params (complaintPath)
     * are seeded with {@code "default":""}. Package-private for tests.
     */
    JsonNode withDeclaredDefaults(KpiDefinition def, JsonNode reqParams) {
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
     * C1, generalized in #1111/R3 — allow-list enforcement for ANY declared param. For each of the
     * def's declared params carrying a non-empty {@code allowed} list, an effective (caller-sent or
     * defaulted) value must be in that list. Out-of-list (incl. arbitrary {@code last_Nd} windows,
     * out-of-range {@code hierLevel}s) → {@code invalid_param}. No-op for params the def declares
     * without an allow-list — absent OR empty {@code "allowed":[]} both mean unvalidated free-form
     * (the dss.KpiDefinition schema requires the key, so complaintPath is seeded with an empty
     * list) — and for undeclared params (composer vocabulary applies).
     * Runs on BOTH the normal kpiId path and the compose path (each calls this on its own def).
     * Malformed shapes are rejected outright: a non-object {@code params} node, or an object/array
     * value for a declared allow-listed param, is {@code invalid_param} (never a silent bypass).
     */
    void validateAllowedParams(KpiDefinition def, JsonNode reqParams) {
        if (reqParams == null || reqParams.isNull()) return;
        if (!reqParams.isObject())
            throw new IllegalArgumentException("invalid_param: params must be an object");
        if (def.getParams() == null) return;
        for (KpiDefinition.KpiParam p : def.getParams()) {
            if (p == null || p.getName() == null) continue;
            List<String> allowed = p.getAllowed();
            if (allowed == null || allowed.isEmpty()) continue;
            if (!reqParams.hasNonNull(p.getName())) continue;
            JsonNode value = reqParams.get(p.getName());
            if (!value.isValueNode())
                throw new IllegalArgumentException(
                        "invalid_param: " + p.getName() + " must be a scalar value");
            String requested = value.asText();
            if (requested.isEmpty()) continue;
            if (!allowed.contains(requested))
                throw new IllegalArgumentException(
                        "invalid_param: " + p.getName() + " '" + requested + "' is not allowed for KPI '"
                                + def.getId() + "'; allowed=" + allowed);
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
    private Map<String,Object> maybeComposeResult(JsonNode queryNode, PgrSearchScope scope,
                                                  String tenantId, AnalyticsCapabilities capabilities,
                                                  QueryTelemetry tel, String entryName,
                                                  BusinessCalendar calendar) {
        if (queryNode == null || !queryNode.has("kpiId")) return null;
        String kpiId = queryNode.get("kpiId").asText();
        Optional<KpiDefinition> defOpt = kpiCatalogService.getDef(kpiId, tenantId);
        if (defOpt.isEmpty() || !isComposeDef(defOpt.get())) return null;   // not a compose ref → normal path

        KpiDefinition def = defOpt.get();
        if (!def.isPublished() || !capabilities.canSee(def))
            return Map.of("error", "kpi_forbidden", "message", "KPI not found or not authorized for this caller");

        // #1026: apply the compose def's declared params[].default before validation/propagation,
        // so a bare {kpiId} compose ref honours its declared defaults too (explicit caller wins).
        JsonNode params = withDeclaredDefaults(def, queryNode.get("params"));

        // C1 (generalized, #1111/R3): the compose def's declared allow-lists still apply to the
        // effective params before they propagate to every source KPI.
        validateAllowedParams(def, params);

        JsonNode compose = def.getViz().getCompose();
        String type = compose.get("type").asText();

        // Resolve + run each source kpiId with the same params, RBAC and row-scope.
        // #1110/R9: each SOURCE query records its own metric point and joins the per-request
        // slow-query pool (attributed to its own kpiId, under the composed entry's name).
        List<Map<String,Object>> sourceRows = new ArrayList<>();
        List<String> paramsIgnored = new ArrayList<>();   // deduped in resolveKpiRef/composer
        for (JsonNode srcId : compose.get("sourceKpiIds")) {
            JsonNode srcRef = synthRef(srcId.asText(), params);
            JsonNode srcQuery = resolveKpiRef(srcRef, tenantId, capabilities, paramsIgnored, calendar);
            if (srcQuery == null)
                throw new IllegalArgumentException("kpi_forbidden: compose source '" + srcId.asText() + "' not authorized");
            Map<String,Object> r = runOne(srcQuery, scope, tel, entryName, srcId.asText(), calendar);
            // A suppressed source is UNANSWERABLE, not zero. firstRow() would flatten it to {} and
            // computeCompose would read a missing measure as 0 — netBacklogDaily would then publish a
            // confident number derived from a period the filter excludes. Propagate instead.
            if (r.containsKey("suppressed")) {
                Map<String,Object> out = new LinkedHashMap<>();
                out.put("grain", "compose");
                out.put("columns", Collections.emptyList());
                out.put("rows", Collections.emptyList());
                out.put("rowCount", 0);
                out.put("compose", type);
                out.put("suppressed", r.get("suppressed"));
                if (!paramsIgnored.isEmpty()) out.put("paramsIgnored", paramsIgnored);
                return out;
            }
            sourceRows.add(firstRow(r));
        }

        Double value = computeCompose(type, compose, sourceRows, calendar);
        String valueKey = def.getViz().getValueKey() != null ? def.getViz().getValueKey() : "value";
        Map<String,Object> row = new LinkedHashMap<>();
        row.put(valueKey, value);
        Map<String,Object> out = new LinkedHashMap<>();
        out.put("grain", "compose");
        out.put("columns", List.of(valueKey));
        out.put("rows", List.of(row));
        out.put("rowCount", 1);
        out.put("compose", type);
        if (!paramsIgnored.isEmpty()) out.put("paramsIgnored", paramsIgnored);
        return out;
    }

    /**
     * Remove a caller-supplied {@link KpiQueryComposer#SUPPRESSED} marker. Copy-on-write: the request
     * body is left untouched unless the marker is actually present.
     */
    private JsonNode stripSuppressionMarker(JsonNode queryNode) {
        if (queryNode == null || !queryNode.isObject() || !queryNode.has(KpiQueryComposer.SUPPRESSED))
            return queryNode;
        com.fasterxml.jackson.databind.node.ObjectNode copy =
                (com.fasterxml.jackson.databind.node.ObjectNode) queryNode.deepCopy();
        copy.remove(KpiQueryComposer.SUPPRESSED);
        log.debug("ignoring caller-supplied '{}' on an inline query", KpiQueryComposer.SUPPRESSED);
        return copy;
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
     * current week/day in the request's resolved {@link BusinessCalendar} zone (mirroring the
     * FE's use of {@code results[..].asOf}). Package-private for tests.
     */
    Double computeCompose(String type, JsonNode compose, List<Map<String,Object>> src,
                          BusinessCalendar calendar) {
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
                long elapsed = elapsedDaysSinceStartOfWeek(calendar);
                return elapsed > 0 ? total / elapsed : null;
            }
            case "hourlyAvgFromDaily": {
                double total = orZero(num(src.get(0), "total"));
                if (!compose.path("elapsedFromAsOf").asBoolean(false)) return null;
                long elapsed = elapsedHoursSinceStartOfDay(calendar);
                return elapsed > 0 ? total / elapsed : null;
            }
            default:
                throw new IllegalArgumentException("invalid_kpi: unsupported compose op '" + type + "'");
        }
    }

    private double orZero(Double d) { return d == null ? 0.0 : d; }

    /**
     * FE elapsedDaysSince(startOfWeek(now), now): max(1, floor((now-weekStart)/day)). Preserves
     * the existing Sunday week-start semantic (FE {@code getDay()}) for THIS operation only — wtd
     * elsewhere in the planner/composer uses Monday; that is a separate, intentionally distinct
     * product semantic and is left unchanged (#29 requirement: don't silently unify week starts).
     * Measured from the request's captured wall clock and shared zone. Package-private for tests.
     */
    long elapsedDaysSinceStartOfWeek(BusinessCalendar calendar) {
        java.time.ZonedDateTime now = java.time.Instant.ofEpochMilli(calendar.nowMs).atZone(calendar.zoneId);
        java.time.ZonedDateTime weekStart = now.toLocalDate()
                .with(java.time.temporal.TemporalAdjusters.previousOrSame(java.time.DayOfWeek.SUNDAY))
                .atStartOfDay(calendar.zoneId);
        long ms = calendar.nowMs - weekStart.toInstant().toEpochMilli();
        return Math.max(1, ms / 86_400_000L);
    }

    /** FE elapsedHoursSince(startOfDay(now), now): max(1, floor((now-dayStart)/hour)). Package-private for tests. */
    long elapsedHoursSinceStartOfDay(BusinessCalendar calendar) {
        long dayStart = calendar.businessDate.atStartOfDay(calendar.zoneId).toInstant().toEpochMilli();
        long ms = calendar.nowMs - dayStart;
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
     * AND the caller lacks the officer capability. Only DIMENSION projection
     * is gated; aggregate measures ({@code count_distinct} over a PII column) are not, since
     * they never expose individual UUIDs. Caller is responsible for invoking this only on the
     * INLINE path (no {@code kpiId}); the kpiId path enforces {@code visibleTo} separately.
     */
    boolean projectsForbiddenPii(JsonNode queryNode, AnalyticsCapabilities capabilities) {
        if (queryNode == null || !queryNode.has("dimensions") || !queryNode.get("dimensions").isArray())
            return false;
        boolean projectsPii = false;
        for (JsonNode d : queryNode.get("dimensions")) {
            if (d != null && d.isTextual() && PII_DIMENSIONS.contains(d.asText())) { projectsPii = true; break; }
        }
        if (!projectsPii) return false;
        // Authorized iff accesscontrol granted the officer capability — the same grant the
        // officer KPI definitions are gated on, so the inline and by-reference paths agree.
        return !capabilities.allowsOfficerPii();
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
    private Map<String,Object> runOne(JsonNode q, PgrSearchScope scope, QueryTelemetry tel,
                                      String entryName, String kpiId, BusinessCalendar calendar){
        // #1462: a pinned-window def whose interval falls outside the selected date range is
        // unanswerable, not empty-by-filter. Return no rows WITHOUT running SQL, flagged so the tile
        // renders "no data for the applied filters" rather than a zero the user would read as fact.
        if (q.path(KpiQueryComposer.SUPPRESSED).asBoolean(false)) {
            Map<String,Object> r = new LinkedHashMap<>();
            r.put("grain", q.hasNonNull("grain") ? q.get("grain").asText() : "facts");
            r.put("columns", Collections.emptyList());
            r.put("rows", Collections.emptyList());
            r.put("rowCount", 0);
            r.put("suppressed", "filter_excludes_window");
            r.put("tookMs", 0L);
            return r;
        }
        AnalyticsPlanner.Planned p = planner.plan(q, scope, calendar);
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
        out.put("filterOps", Arrays.asList("eq","ne","gt","gte","lt","lte","in","isnull","starts_with","subtree"));
        out.put("windows", Arrays.asList("all","live","last_<N>d","dtd","wtd","mtd","qtd","ytd"));
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
     * <p>Cached in-memory per tenant for {@code pgr.analytics.config-cache-ttl-ms}
     * (the single TTL shared by every analytics config cache; default 5 minutes);
     * errors return null (additive, never fails the /packs response) and are not cached.
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
                                          Long.class, AnalyticsPlanner.escapeLikeLiteral(tenantId) + "%")
                    : jdbc.queryForObject("SELECT count(*) FROM complaint_facts WHERE tenant_id = ?",
                                          Long.class, tenantId);
            if (count == null) return null;
            recordCountCache.put(tenantId, new long[]{count, now + configCacheTtlMs()});
            return count;
        } catch (Exception e) {
            log.debug("recordCount for tenant {} failed (returning null)", tenantId, e);
            return null;
        }
    }

    /**
     * The shared analytics config-cache TTL ({@code pgr.analytics.config-cache-ttl-ms});
     * falls back to the 5-minute default when constructed without a Spring config
     * (tests). Same accessor idiom as KpiCatalogService.configCacheTtlMs().
     */
    private long configCacheTtlMs() {
        Long v = config == null ? null : config.getAnalyticsConfigCacheTtlMs();
        return v != null ? v : PGRConfiguration.DEFAULT_ANALYTICS_CONFIG_CACHE_TTL_MS;
    }

    /** Additive top-level response metadata (#29): the resolved zone + businessDate the whole batch used. */
    private Map<String,Object> calendarInfo(BusinessCalendar c){
        Map<String,Object> m = new LinkedHashMap<>();
        m.put("timeZone", c.zoneId.getId());
        m.put("businessDate", c.businessDate.toString());
        return m;
    }

    /** A description of the scope actually applied, for the response envelope. Never the policy. */
    private Map<String,Object> scopeInfo(PgrSearchScope s){
        Map<String,Object> m = new LinkedHashMap<>();
        m.put("tenantId", s.tenantId);
        m.put("level", s.tenantStateLevel ? "state" : "city");
        if (s.citizenUuid != null) m.put("restrictedTo", "own-records");
        if (s.departmentCodes != null) m.put("departments", s.departmentCodes);
        if (s.jurisdictionCodes != null) m.put("jurisdictions", s.jurisdictionCodes);
        return m;
    }

    private Map<String,Object> err(Exception ex){
        Map<String,Object> m = new LinkedHashMap<>();
        String msg = ex.getMessage()==null ? ex.toString() : ex.getMessage();
        String code = msg.contains(":") ? msg.substring(0, msg.indexOf(':')) : "query_failed";
        m.put("error", code); m.put("message", msg);
        return m;
    }

}
