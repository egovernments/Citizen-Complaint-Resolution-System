package org.egov.pgr.analytics;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.egov.common.contract.request.RequestInfo;
import org.egov.common.contract.request.Role;
import org.egov.common.contract.request.User;
import org.egov.pgr.analytics.model.DashboardPack;
import org.egov.pgr.analytics.model.KpiDefinition;
import org.egov.pgr.config.PGRConfiguration;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.*;
import java.util.stream.Collectors;

/**
 * Dynamic analytics query API over the V2 grains (complaint_facts / complaint_events /
 * complaint_open_state_daily).
 *
 *   POST /v2/analytics/_query          — run a single query or a batch dict of named queries
 *   POST /v2/analytics/_schema         — capabilities/catalog so the FE can build the KPI editor
 *   POST /v2/analytics/packs           — return best-match DashboardPack + safe tile descriptors
 *   POST /v2/analytics/catalog/_search — return all visible KpiDefinition tiles (no query/rbac)
 *
 * Body (single):  { "RequestInfo": {...}, "tenantId": "ke", "query": { ...grammar... } }
 * Body (batch):   { "RequestInfo": {...}, "tenantId": "ke", "queries": { "name": {...}, ... } }
 */
@RestController
@RequestMapping("/v2/analytics")
@Slf4j
public class AnalyticsController {

    private final AnalyticsService service;
    private final KpiCatalogService kpiCatalogService;
    private final ObjectMapper mapper;
    private final PGRConfiguration config;

    @Autowired
    public AnalyticsController(AnalyticsService service, KpiCatalogService kpiCatalogService,
                               ObjectMapper mapper, PGRConfiguration config){
        this.service = service; this.kpiCatalogService = kpiCatalogService;
        this.mapper = mapper; this.config = config;
    }

    @PostMapping("/_query")
    public ResponseEntity<Map<String,Object>> query(@RequestBody JsonNode body){
        try {
            RequestInfo requestInfo = body.has("RequestInfo")
                    ? mapper.convertValue(body.get("RequestInfo"), RequestInfo.class) : null;
            String tenantId = body.hasNonNull("tenantId") ? body.get("tenantId").asText() : null;
            int stateLen = config.getStateLevelTenantIdLength() == null ? 1 : config.getStateLevelTenantIdLength();
            Map<String,Object> result = service.query(body, requestInfo, tenantId, stateLen);
            return ResponseEntity.ok(result);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(error(e));
        } catch (Exception e) {
            log.error("analytics query failed", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(error(e));
        }
    }

    @PostMapping("/_schema")
    public ResponseEntity<Map<String,Object>> schema(){
        return ResponseEntity.ok(service.schema());
    }

    /**
     * POST /v2/analytics/packs
     *
     * Returns the best-matching DashboardPack for the caller plus safe tile descriptors
     * (viz metadata only — query and rbac are never included in the response).
     *
     * Response: { "tiles": [...], "defaultLayout": [...], "asOf": epochMs }
     */
    @PostMapping("/packs")
    public ResponseEntity<Map<String,Object>> getPacks(@RequestBody Map<String,Object> body){
        try {
            RequestInfo requestInfo = extractRequestInfo(body);
            String tenantId = extractTenantId(body);
            Set<String> callerRoles = extractRoles(requestInfo);

            List<KpiDefinition> visibleDefs = kpiCatalogService.getVisibleDefs(tenantId, callerRoles);
            Map<String,KpiDefinition> defIndex = visibleDefs.stream()
                    .collect(Collectors.toMap(KpiDefinition::getId, d -> d));

            Optional<DashboardPack> pack = kpiCatalogService.getBestPack(tenantId, callerRoles, visibleDefs);

            List<Map<String,Object>> tiles = new ArrayList<>();
            List<String> tileIds = pack.map(DashboardPack::getTiles)
                    .filter(l -> l != null)
                    .orElse(visibleDefs.stream().map(KpiDefinition::getId).collect(Collectors.toList()));

            for (String kpiId : tileIds) {
                KpiDefinition def = defIndex.get(kpiId);
                if (def != null) tiles.add(safeTile(def));
            }

            Map<String,Object> out = new LinkedHashMap<>();
            out.put("tiles", tiles);
            out.put("defaultLayout", pack.map(DashboardPack::getLayout).orElse(Collections.emptyList()));
            out.put("asOf", System.currentTimeMillis());
            return ResponseEntity.ok(out);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(error(e));
        } catch (Exception e) {
            log.error("analytics packs failed", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(error(e));
        }
    }

    /**
     * POST /v2/analytics/catalog/_search
     *
     * Returns all published KpiDefinition tiles visible to the caller (no query/rbac).
     *
     * Response: { "tiles": [...], "total": n }
     */
    @PostMapping("/catalog/_search")
    public ResponseEntity<Map<String,Object>> searchCatalog(@RequestBody Map<String,Object> body){
        try {
            RequestInfo requestInfo = extractRequestInfo(body);
            String tenantId = extractTenantId(body);
            Set<String> callerRoles = extractRoles(requestInfo);

            List<KpiDefinition> visibleDefs = kpiCatalogService.getVisibleDefs(tenantId, callerRoles);
            List<Map<String,Object>> tiles = visibleDefs.stream()
                    .map(this::safeTile)
                    .collect(Collectors.toList());

            Map<String,Object> out = new LinkedHashMap<>();
            out.put("tiles", tiles);
            out.put("total", tiles.size());
            return ResponseEntity.ok(out);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(error(e));
        } catch (Exception e) {
            log.error("analytics catalog search failed", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(error(e));
        }
    }

    // ---- helpers ----

    /** Serializes a KpiDefinition for external consumption: includes viz/params but NEVER query or rbac. */
    private Map<String,Object> safeTile(KpiDefinition def) {
        Map<String,Object> t = new LinkedHashMap<>();
        t.put("kpiId", def.getId());
        t.put("version", def.getVersion());
        t.put("titleKey", def.getViz() != null ? def.getViz().getTitleKey() : null);
        t.put("viz", def.getViz());
        t.put("params", def.getParams());
        return t;
    }

    private RequestInfo extractRequestInfo(Map<String,Object> body) {
        Object ri = body.get("RequestInfo");
        if (ri == null) return null;
        return mapper.convertValue(ri, RequestInfo.class);
    }

    private String extractTenantId(Map<String,Object> body) {
        Object t = body.get("tenantId");
        if (t == null || t.toString().isEmpty())
            throw new IllegalArgumentException("invalid_param: tenantId is required");
        return t.toString();
    }

    private Set<String> extractRoles(RequestInfo requestInfo) {
        // Mirror AnalyticsService's public floor: an anonymous / role-less caller degrades
        // to PUBLIC so the catalog endpoints expose only PUBLIC tiles (not every
        // visibleTo:[] tile). Keeps /packs + /catalog/_search consistent with /_query.
        if (requestInfo == null) return Set.of(AnalyticsService.PUBLIC_ROLE);
        User u = requestInfo.getUserInfo();
        if (u == null || u.getRoles() == null) return Set.of(AnalyticsService.PUBLIC_ROLE);
        Set<String> roles = u.getRoles().stream()
                .filter(r -> r != null && r.getCode() != null)
                .map(Role::getCode)
                .collect(Collectors.toSet());
        return roles.isEmpty() ? Set.of(AnalyticsService.PUBLIC_ROLE) : roles;
    }

    private Map<String,Object> error(Exception e){
        String msg = e.getMessage() == null ? e.toString() : e.getMessage();
        String code = msg.contains(":") ? msg.substring(0, msg.indexOf(':')) : "query_failed";
        Map<String,Object> m = new LinkedHashMap<>();
        m.put("error", code);
        m.put("message", msg);
        return m;
    }
}
