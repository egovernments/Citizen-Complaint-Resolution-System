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

    private final AnalyticsPlanner planner;
    private final AnalyticsCatalog catalog;
    private final JdbcTemplate jdbc;
    private final KpiCatalogService kpiCatalogService;
    private final PrincipalScopeResolver scopeResolver;
    private final KpiQueryComposer queryComposer;

    @Autowired
    public AnalyticsService(AnalyticsPlanner planner, AnalyticsCatalog catalog, JdbcTemplate jdbc,
                            KpiCatalogService kpiCatalogService, PrincipalScopeResolver scopeResolver,
                            KpiQueryComposer queryComposer){
        this.planner = planner; this.catalog = catalog; this.jdbc = jdbc;
        this.kpiCatalogService = kpiCatalogService; this.scopeResolver = scopeResolver;
        this.queryComposer = queryComposer;
    }

    public Map<String,Object> query(JsonNode body, RequestInfo requestInfo, String tenantId, int stateLevelLen){
        if (tenantId == null || tenantId.isEmpty()) throw new IllegalArgumentException("invalid_param: tenantId is required");
        AnalyticsScope scope = scopeResolver.resolve(requestInfo, tenantId, stateLevelLen);
        Set<String> callerRoles = extractRoles(requestInfo);

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
                    results.put(name, runOne(actualQueryNode, scope));
                } catch (Exception ex) {
                    partial = true;
                    results.put(name, err(ex));
                }
            }
            out.put("results", results);
            out.put("partial", partial);
        } else if (body.has("query")) {
            JsonNode queryNode = body.get("query");
            JsonNode actualQueryNode = resolveKpiRef(queryNode, tenantId, callerRoles);
            if (actualQueryNode == null)
                throw new IllegalArgumentException("kpi_forbidden: KPI not found or not authorized");
            if (!queryNode.has("kpiId") && projectsForbiddenPii(actualQueryNode, callerRoles))
                throw new IllegalArgumentException("pii_forbidden: inline query projects officer-PII dimension(s); role not authorized");
            out.putAll(runOne(actualQueryNode, scope));
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
        JsonNode storedQuery = def.get().getQuery();
        if (storedQuery == null || storedQuery.isNull())
            throw new IllegalArgumentException("invalid_kpi: KPI '" + kpiId + "' has no query defined");
        return queryComposer.mergeParams(storedQuery, queryNode.get("params"));
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

    private Map<String,Object> runOne(JsonNode q, AnalyticsScope scope){
        AnalyticsPlanner.Planned p = planner.plan(q, scope);
        long t0 = System.currentTimeMillis();
        List<Map<String,Object>> rows = jdbc.queryForList(p.sql, p.params.toArray());
        Map<String,Object> r = new LinkedHashMap<>();
        r.put("grain", p.grain);
        r.put("columns", p.columns);
        r.put("rows", rows);
        r.put("rowCount", rows.size());
        r.put("tookMs", System.currentTimeMillis() - t0);
        return r;
    }

    /** /_schema capabilities — lets the FE build the KPI editor dynamically. */
    public Map<String,Object> schema(){
        Map<String,Object> out = new LinkedHashMap<>();
        out.put("aggFns", AnalyticsCatalog.AGG_FNS);
        out.put("filterOps", Arrays.asList("eq","ne","gt","gte","lt","lte","in","isnull"));
        out.put("windows", Arrays.asList("all","live","last_<N>d","wtd","mtd","qtd","ytd"));
        out.put("timeBuckets", Arrays.asList("day","week","month","quarter","year"));
        Map<String,Object> grains = new LinkedHashMap<>();
        for (Grain g : catalog.grains()) {
            Map<String,Object> gi = new LinkedHashMap<>();
            gi.put("timeRoles", g.timeRoles.keySet());
            gi.put("defaultTimeRole", g.defaultTimeRole);
            gi.put("dimensions", g.groupable);
            gi.put("filterable", g.filterable);
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

    /** Extract role codes from RequestInfo.userInfo.roles — mirrors AnalyticsScope role extraction. */
    private Set<String> extractRoles(RequestInfo requestInfo) {
        if (requestInfo == null) return Collections.emptySet();
        User u = requestInfo.getUserInfo();
        if (u == null || u.getRoles() == null) return Collections.emptySet();
        return u.getRoles().stream()
                .filter(r -> r != null && r.getCode() != null)
                .map(Role::getCode)
                .collect(Collectors.toSet());
    }
}
