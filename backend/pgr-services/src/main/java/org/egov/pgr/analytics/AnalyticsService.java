package org.egov.pgr.analytics;

import com.fasterxml.jackson.databind.JsonNode;
import lombok.extern.slf4j.Slf4j;
import org.egov.common.contract.request.RequestInfo;
import org.egov.pgr.analytics.AnalyticsCatalog.Grain;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.*;

/**
 * Orchestrates the dynamic analytics query: resolve server-side RBAC scope, plan each query
 * against the catalog, execute parameterized SQL, and shape the response (single or batch dict).
 */
@Service
@Slf4j
public class AnalyticsService {

    private final AnalyticsPlanner planner;
    private final AnalyticsCatalog catalog;
    private final JdbcTemplate jdbc;

    @Autowired
    public AnalyticsService(AnalyticsPlanner planner, AnalyticsCatalog catalog, JdbcTemplate jdbc){
        this.planner = planner; this.catalog = catalog; this.jdbc = jdbc;
    }

    public Map<String,Object> query(JsonNode body, RequestInfo requestInfo, String tenantId, int stateLevelLen){
        if (tenantId == null || tenantId.isEmpty()) throw new IllegalArgumentException("invalid_param: tenantId is required");
        AnalyticsScope scope = AnalyticsScope.resolve(requestInfo, tenantId, stateLevelLen);

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
                try { results.put(e.getKey(), runOne(e.getValue(), scope)); }
                catch (Exception ex) { partial = true; results.put(e.getKey(), err(ex)); }
            }
            out.put("results", results);
            out.put("partial", partial);
        } else if (body.has("query")) {
            out.putAll(runOne(body.get("query"), scope));
        } else {
            throw new IllegalArgumentException("invalid_param: body must contain 'query' or 'queries'");
        }
        return out;
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
