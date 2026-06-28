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

    private final AnalyticsPlanner planner;
    private final AnalyticsCatalog catalog;
    private final JdbcTemplate jdbc;
    private final KpiCatalogService kpiCatalogService;
    private final PrincipalScopeResolver scopeResolver;

    @Autowired
    public AnalyticsService(AnalyticsPlanner planner, AnalyticsCatalog catalog, JdbcTemplate jdbc,
                            KpiCatalogService kpiCatalogService, PrincipalScopeResolver scopeResolver){
        this.planner = planner; this.catalog = catalog; this.jdbc = jdbc;
        this.kpiCatalogService = kpiCatalogService; this.scopeResolver = scopeResolver;
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
        return storedQuery;
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
