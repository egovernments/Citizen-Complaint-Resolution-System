package org.egov.pgr.analytics;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
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
 * Anonymous twins (Kong-only auth-optional aliases; RequestInfo is discarded by construction):
 *   POST /v2/analytics/public/packs           — curated PUBLIC pack, fail-closed when disabled
 *   POST /v2/analytics/public/catalog/_search — every PUBLIC-tagged published tile (Add KPI menu)
 *   POST /v2/analytics/public/_options        — filter-bar option codes (wards / complaint types)
 *   POST /v2/analytics/public/_query          — {kpiId[, params]} refs over PUBLIC tiles, with
 *                                               params restricted to AnalyticsService.PUBLIC_QUERY_PARAMS
 *
 * Body (single):  { "RequestInfo": {...}, "tenantId": "ke", "query": { ...grammar... } }
 * Body (batch):   { "RequestInfo": {...}, "tenantId": "ke", "queries": { "name": {...}, ... } }
 */
@RestController
@RequestMapping("/v2/analytics")
@Slf4j
public class AnalyticsController {

    private static final Set<String> DASHBOARD_CONFIG_ROLES =
            Set.of("MDMS_ADMIN", "SUPERUSER", "LOC_ADMIN");

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
    public ResponseEntity<Map<String,Object>> query(@RequestBody JsonNode body,
            // #1110: correlation FALLBACK only — when the OTEL javaagent is attached, the
            // active span's trace id (W3C traceparent, propagated by Kong) takes precedence.
            @RequestHeader(value = "x-trace-id", required = false) String xTraceId){
        try {
            RequestInfo requestInfo = body.has("RequestInfo")
                    ? mapper.convertValue(body.get("RequestInfo"), RequestInfo.class) : null;
            String tenantId = body.hasNonNull("tenantId") ? body.get("tenantId").asText() : null;
            int stateLen = config.getStateLevelTenantIdLength() == null ? 1 : config.getStateLevelTenantIdLength();
            Map<String,Object> result = service.query(body, requestInfo, tenantId, stateLen, xTraceId);
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
     * Anonymous dashboard bootstrap. Unlike the mixed authenticated endpoint, this route never
     * reads RequestInfo from the body: its identity is unconditionally the synthetic PUBLIC role.
     * A missing PUBLIC pack fails closed to an empty dashboard rather than falling back to every
     * PUBLIC-visible definition.
     */
    @PostMapping("/public/packs")
    public ResponseEntity<Map<String,Object>> getPublicPack(@RequestBody Map<String,Object> body){
        try {
            String tenantId = extractTenantId(body);
            if (!kpiCatalogService.isPublicDashboardEnabled(tenantId)) {
                Map<String,Object> out = new LinkedHashMap<>();
                out.put("enabled", false);
                out.put("tiles", Collections.emptyList());
                out.put("defaultLayout", Collections.emptyList());
                out.put("packId", null);
                out.put("maxBatchQueries", AnalyticsService.MAX_BATCH_QUERIES);
                // A 200 response lets the anonymous shell render an intentional unavailable
                // screen. No KPI descriptors, layouts, counts, or query data leave the service.
                return ResponseEntity.ok(out);
            }
            Set<String> publicRoles = Set.of(AnalyticsService.PUBLIC_ROLE);
            List<KpiDefinition> visibleDefs = kpiCatalogService.getVisibleDefs(tenantId, publicRoles);
            Map<String,KpiDefinition> defIndex = visibleDefs.stream()
                    .collect(Collectors.toMap(KpiDefinition::getId, d -> d));
            Optional<DashboardPack> pack = kpiCatalogService.getBestPack(tenantId, publicRoles, visibleDefs);

            List<Map<String,Object>> tiles = new ArrayList<>();
            for (String kpiId : pack.map(DashboardPack::getTiles).orElse(Collections.emptyList())) {
                KpiDefinition def = defIndex.get(kpiId);
                if (def != null) tiles.add(safeTile(def));
            }

            Map<String,Object> out = new LinkedHashMap<>();
            out.put("enabled", true);
            out.put("tiles", tiles);
            out.put("defaultLayout", pack.map(DashboardPack::getLayout).orElse(Collections.emptyList()));
            out.put("asOf", System.currentTimeMillis());
            out.put("packId", pack.map(DashboardPack::getId).orElse(null));
            out.put("maxBatchQueries", AnalyticsService.MAX_BATCH_QUERIES);
            // Deliberately no recordCount: even a matching public pack must not become a
            // tenant-volume enumeration primitive.
            return ResponseEntity.ok(out);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(error(e));
        } catch (Exception e) {
            log.error("public analytics packs failed", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(publicUnavailable());
        }
    }

    /**
     * Anonymous dashboard data endpoint. Accepts a bounded batch of {@code {kpiId[, params]}}
     * references over the tenant's PUBLIC-tagged published tiles (the same set the public Add-KPI
     * menu offers; the matched PUBLIC pack must still exist as the fail-closed gate). RequestInfo
     * is discarded by construction; {@code params} is rebuilt from the {@link #PUBLIC_QUERY_PARAMS}
     * allow-list — never forwarded verbatim — before delegating to the normal execution path.
     */
    @PostMapping("/public/_query")
    public ResponseEntity<Map<String,Object>> publicQuery(@RequestBody JsonNode body,
            @RequestHeader(value = "x-trace-id", required = false) String xTraceId){
        try {
            if (body == null || body.isNull())
                throw new IllegalArgumentException("invalid_param: tenantId is required");
            String tenantId = body.hasNonNull("tenantId") ? body.get("tenantId").asText() : null;
            if (tenantId == null || tenantId.isEmpty())
                throw new IllegalArgumentException("invalid_param: tenantId is required");
            if (!kpiCatalogService.isPublicDashboardEnabled(tenantId)) {
                return ResponseEntity.status(HttpStatus.NOT_FOUND).body(error(
                        new IllegalArgumentException(
                                "public_dashboard_disabled: public dashboard is not enabled for this tenant")));
            }

            JsonNode queries = body.get("queries");
            if (queries == null || !queries.isObject() || queries.isEmpty())
                throw new IllegalArgumentException("invalid_param: public query requires a non-empty 'queries' object");
            AnalyticsService.validateBatchSize(queries);

            Set<String> publicRoles = Set.of(AnalyticsService.PUBLIC_ROLE);
            List<KpiDefinition> visibleDefs = kpiCatalogService.getVisibleDefs(tenantId, publicRoles);
            // The pack is the fail-closed enablement gate; the tile set is the PUBLIC catalog,
            // so a tile a visitor added from the public Add-KPI menu is queryable too (#1797).
            requirePublicPack(tenantId, publicRoles, visibleDefs);
            Set<String> allowedKpis = visibleDefs.stream()
                    .map(KpiDefinition::getId).collect(Collectors.toSet());

            ObjectNode sanitizedQueries = mapper.createObjectNode();
            Iterator<Map.Entry<String,JsonNode>> it = queries.fields();
            while (it.hasNext()) {
                Map.Entry<String,JsonNode> entry = it.next();
                JsonNode ref = entry.getValue();
                if (ref == null || !ref.isObject() || !ref.hasNonNull("kpiId")
                        || !ref.get("kpiId").isTextual() || ref.get("kpiId").asText().isEmpty()) {
                    throw new IllegalArgumentException(
                            "invalid_param: public queries must be {kpiId[, params]} references");
                }
                for (Iterator<String> names = ref.fieldNames(); names.hasNext();) {
                    String field = names.next();
                    if (!field.equals("kpiId") && !field.equals("params"))
                        throw new IllegalArgumentException(
                                "invalid_param: public queries must be {kpiId[, params]} references");
                }
                String kpiId = ref.get("kpiId").asText();
                if (!allowedKpis.contains(kpiId))
                    throw new IllegalArgumentException(
                            "kpi_forbidden: KPI is not published to the PUBLIC audience");
                // Same allow-list the service re-applies for every PUBLIC-floor caller; rejecting
                // here keeps the alias's whole-batch 400 contract for malformed input.
                sanitizedQueries.set(entry.getKey(), AnalyticsService.publicFloorRef(ref));
            }

            ObjectNode sanitizedBody = mapper.createObjectNode();
            sanitizedBody.put("tenantId", tenantId);
            sanitizedBody.set("queries", sanitizedQueries);
            int stateLen = config.getStateLevelTenantIdLength() == null
                    ? 1 : config.getStateLevelTenantIdLength();
            return ResponseEntity.ok(service.query(
                    sanitizedBody, null, tenantId, stateLen, xTraceId));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(error(e));
        } catch (Exception e) {
            log.error("public analytics query failed", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(publicUnavailable());
        }
    }

    /**
     * Anonymous catalog: every published tile tagged PUBLIC, as safe descriptors. Feeds the public
     * page's Add-KPI menu (#1797) — the public equivalent of "everything your role can see". Same
     * disabled/RequestInfo contract as {@link #publicQuery}.
     */
    @PostMapping("/public/catalog/_search")
    public ResponseEntity<Map<String,Object>> searchPublicCatalog(@RequestBody Map<String,Object> body){
        try {
            String tenantId = extractTenantId(body);
            if (!kpiCatalogService.isPublicDashboardEnabled(tenantId)) {
                return ResponseEntity.status(HttpStatus.NOT_FOUND).body(error(
                        new IllegalArgumentException(
                                "public_dashboard_disabled: public dashboard is not enabled for this tenant")));
            }
            Set<String> publicRoles = Set.of(AnalyticsService.PUBLIC_ROLE);
            List<KpiDefinition> visibleDefs = kpiCatalogService.getVisibleDefs(tenantId, publicRoles);
            // Same fail-closed gate as /public/_query: no PUBLIC pack -> no catalog either, so an
            // enabled-but-unconfigured tenant never exposes descriptors it cannot serve data for.
            requirePublicPack(tenantId, publicRoles, visibleDefs);
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
            log.error("public analytics catalog search failed", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(publicUnavailable());
        }
    }

    /**
     * Anonymous filter-bar options: the ward and complaint-type codes that carry complaints on
     * this tenant (#1797). The caller supplies nothing but the tenant; the two distinct queries
     * are server-owned constants (see {@link AnalyticsService#publicFilterOptions}).
     */
    @PostMapping("/public/_options")
    public ResponseEntity<Map<String,Object>> publicFilterOptions(@RequestBody Map<String,Object> body,
            @RequestHeader(value = "x-trace-id", required = false) String xTraceId){
        try {
            String tenantId = extractTenantId(body);
            if (!kpiCatalogService.isPublicDashboardEnabled(tenantId)) {
                return ResponseEntity.status(HttpStatus.NOT_FOUND).body(error(
                        new IllegalArgumentException(
                                "public_dashboard_disabled: public dashboard is not enabled for this tenant")));
            }
            Set<String> publicRoles = Set.of(AnalyticsService.PUBLIC_ROLE);
            requirePublicPack(tenantId, publicRoles, kpiCatalogService.getVisibleDefs(tenantId, publicRoles));
            int stateLen = config.getStateLevelTenantIdLength() == null
                    ? 1 : config.getStateLevelTenantIdLength();
            return ResponseEntity.ok(service.publicFilterOptions(tenantId, stateLen, xTraceId));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(error(e));
        } catch (Exception e) {
            log.error("public analytics filter options failed", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(publicUnavailable());
        }
    }

    /** Refresh DashboardConfig after an authenticated configurator MDMS write. */
    @PostMapping("/config/_refresh")
    public ResponseEntity<Map<String,Object>> refreshDashboardConfig(
            @RequestBody Map<String,Object> body) {
        try {
            String tenantId = extractTenantId(body);
            RequestInfo requestInfo = extractRequestInfo(body);
            String authorizationError = dashboardConfigAuthorizationError(requestInfo, tenantId);
            if (authorizationError != null) {
                return ResponseEntity.status(HttpStatus.FORBIDDEN).body(error(
                        new IllegalArgumentException("config_refresh_forbidden: " + authorizationError)));
            }
            boolean enabled = kpiCatalogService.refreshPublicDashboardConfig(tenantId);
            return ResponseEntity.ok(Map.of("publicDashboardEnabled", enabled));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(error(e));
        } catch (Exception e) {
            log.error("analytics DashboardConfig refresh failed", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(error(e));
        }
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
            // #1110: additive fields the dashboard reads defensively (null until data exists).
            // packId -> layout_id tag; persona -> the server's ACTUAL pack-match decision
            // (first pack-role the caller holds, in the pack's declared role order — same
            // semantics as DashboardPack.matchesRoles); recordCount -> record_count_tier tag
            // (tenant corpus on complaint_facts, NOT the caller's ABAC-visible subset).
            out.put("packId", pack.map(DashboardPack::getId).orElse(null));
            out.put("persona", pack.map(p -> matchingRole(p, callerRoles)).orElse(null));
            // recordCount is live tenant data, so it takes the same coarse pack-match
            // gate as packId/persona: no matching pack (e.g. the anonymous PUBLIC floor
            // on a tenant with no public pack) -> null. Without this gate an
            // unauthenticated caller could POST arbitrary tenantIds and enumerate every
            // tenant's complaint volume. The corpus-not-ABAC-subset semantics (R9-C9)
            // are unchanged for callers that do match a pack.
            int stateLen = config.getStateLevelTenantIdLength() == null ? 1 : config.getStateLevelTenantIdLength();
            out.put("recordCount", pack.isPresent() ? service.recordCount(tenantId, stateLen) : null);
            out.put("maxBatchQueries", AnalyticsService.MAX_BATCH_QUERIES);
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

    /**
     * The role that made the pack match (#1110/R9-C7): first role in the PACK's declared
     * roles list that the caller holds. Deterministic (pack order, not set order) and
     * consistent with {@link DashboardPack#matchesRoles} — a non-null result is exactly
     * "this pack matched". Returned as the {@code persona} tag source for the FE.
     */
    private String matchingRole(DashboardPack pack, Set<String> callerRoles) {
        if (pack.getRoles() == null || callerRoles == null) return null;
        return pack.getRoles().stream().filter(callerRoles::contains).findFirst().orElse(null);
    }

    /** The matched PUBLIC pack is the fail-closed gate shared by every public alias. */
    private DashboardPack requirePublicPack(String tenantId, Set<String> publicRoles, List<KpiDefinition> visibleDefs) {
        return kpiCatalogService.getBestPack(tenantId, publicRoles, visibleDefs)
                .orElseThrow(() -> new IllegalArgumentException(
                        "public_pack_not_found: no PUBLIC dashboard pack is configured"));
    }

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
        if (body == null)
            throw new IllegalArgumentException("invalid_param: tenantId is required");
        Object t = body.get("tenantId");
        if (t == null || t.toString().isEmpty())
            throw new IllegalArgumentException("invalid_param: tenantId is required");
        return t.toString();
    }

    /** Fixed anonymous 500 envelope: internal exception detail belongs only in the server log. */
    private Map<String,Object> publicUnavailable() {
        return Map.of("error", "query_failed", "message", "public dashboard is unavailable");
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

    /** Restrict the cache-busting write hook to configurator admins within their tenant tree. */
    private String dashboardConfigAuthorizationError(RequestInfo requestInfo, String tenantId) {
        User user = requestInfo == null ? null : requestInfo.getUserInfo();
        if (user == null) return "authenticated configurator user is required";

        Set<String> roles = extractRoles(requestInfo);
        if (Collections.disjoint(roles, DASHBOARD_CONFIG_ROLES)) {
            return "MDMS_ADMIN, SUPERUSER, or LOC_ADMIN role is required";
        }

        String callerTenant = user.getTenantId();
        if (callerTenant == null || callerTenant.trim().isEmpty()) {
            return "caller tenant is required";
        }
        callerTenant = callerTenant.trim();
        if (!tenantId.equals(callerTenant) && !tenantId.startsWith(callerTenant + ".")) {
            return "requested tenant is outside the caller tenant tree";
        }
        return null;
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
