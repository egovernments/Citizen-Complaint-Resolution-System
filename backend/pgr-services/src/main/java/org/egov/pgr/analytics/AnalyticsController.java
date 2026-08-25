package org.egov.pgr.analytics;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import lombok.extern.slf4j.Slf4j;
import org.egov.common.contract.request.RequestInfo;
import org.egov.pgr.analytics.model.DashboardPack;
import org.egov.pgr.policy.AccessControlUnavailableException;
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

    private final AnalyticsService service;
    private final KpiCatalogService kpiCatalogService;
    private final AnalyticsCapabilityService capabilityService;
    private final ObjectMapper mapper;
    private final PGRConfiguration config;

    @Autowired
    public AnalyticsController(AnalyticsService service, KpiCatalogService kpiCatalogService,
                               AnalyticsCapabilityService capabilityService, ObjectMapper mapper,
                               PGRConfiguration config){
        this.service = service; this.kpiCatalogService = kpiCatalogService;
        this.capabilityService = capabilityService; this.mapper = mapper; this.config = config;
    }

    /**
     * POST /v2/analytics/_access — the dashboard's authorization bootstrap.
     *
     * Answers "what may I do here?" in one call, so the browser renders from the server's decision
     * instead of re-deriving it from a role list of its own. The response is the caller's granted
     * action URLs; the dashboard reads them as capabilities and shows exactly the routes, cards and
     * tiles they reach.
     *
     * Response: { "allowed": true|false, "capabilities": ["/pgr-services/v2/analytics/_query", ...] }
     */
    @PostMapping("/_access")
    public ResponseEntity<Map<String,Object>> access(@RequestBody Map<String,Object> body){
        try {
            String tenantId = extractTenantId(body);
            AnalyticsCapabilities capabilities =
                    capabilityService.resolve(extractRequestInfo(body), tenantId);
            Map<String,Object> out = new LinkedHashMap<>();
            // `allowed` is the dashboard's own gate: without the bootstrap grant there is no
            // dashboard to render, whatever else the caller holds.
            out.put("allowed", capabilities.allows(AnalyticsCapabilities.ACCESS));
            out.put("capabilities", new ArrayList<>(capabilities.granted()));
            return ResponseEntity.ok(out);
        } catch (AnalyticsAccessDeniedException | AccessControlUnavailableException e) {
            throw e;
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(error(e));
        }
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
            if (tenantId == null || tenantId.isEmpty())
                throw new IllegalArgumentException("invalid_param: tenantId is required");
            AnalyticsCapabilities capabilities = capabilityService.resolve(requestInfo, tenantId);
            capabilities.require(AnalyticsCapabilities.QUERY);
            int stateLen = config.getStateLevelTenantIdLength() == null ? 1 : config.getStateLevelTenantIdLength();
            Map<String,Object> result = service.query(body, requestInfo, capabilities, tenantId, stateLen, xTraceId);
            return ResponseEntity.ok(result);
        } catch (AnalyticsAccessDeniedException | AccessControlUnavailableException e) {
            throw e;
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(error(e));
        } catch (Exception e) {
            log.error("analytics query failed", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(error(e));
        }
    }

    @PostMapping("/_schema")
    public ResponseEntity<Map<String,Object>> schema(@RequestBody(required = false) Map<String,Object> body){
        try {
            String tenantId = extractTenantId(body);
            capabilityService.resolve(extractRequestInfo(body), tenantId)
                    .require(AnalyticsCapabilities.SCHEMA);
            return ResponseEntity.ok(service.schema());
        } catch (AnalyticsAccessDeniedException | AccessControlUnavailableException e) {
            throw e;
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(error(e));
        }
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
            AnalyticsCapabilities publicSurface = AnalyticsCapabilities.publicSurface();
            List<KpiDefinition> visibleDefs = kpiCatalogService.getVisibleDefs(tenantId, publicSurface);
            Map<String,KpiDefinition> defIndex = visibleDefs.stream()
                    .collect(Collectors.toMap(KpiDefinition::getId, d -> d));
            Optional<DashboardPack> pack = kpiCatalogService.getBestPack(tenantId, publicSurface, visibleDefs);

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
        } catch (AnalyticsAccessDeniedException | AccessControlUnavailableException e) {
            throw e;
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

            AnalyticsCapabilities publicSurface = AnalyticsCapabilities.publicSurface();
            List<KpiDefinition> visibleDefs = kpiCatalogService.getVisibleDefs(tenantId, publicSurface);
            // The pack is the fail-closed enablement gate; the tile set is the PUBLIC catalog,
            // so a tile a visitor added from the public Add-KPI menu is queryable too (#1797).
            requirePublicPack(tenantId, publicSurface, visibleDefs);
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
                    sanitizedBody, null, publicSurface, tenantId, stateLen, xTraceId));
        } catch (AnalyticsAccessDeniedException | AccessControlUnavailableException e) {
            throw e;
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
            AnalyticsCapabilities publicSurface = AnalyticsCapabilities.publicSurface();
            List<KpiDefinition> visibleDefs = kpiCatalogService.getVisibleDefs(tenantId, publicSurface);
            // Same fail-closed gate as /public/_query: no PUBLIC pack -> no catalog either, so an
            // enabled-but-unconfigured tenant never exposes descriptors it cannot serve data for.
            requirePublicPack(tenantId, publicSurface, visibleDefs);
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
            AnalyticsCapabilities publicSurface = AnalyticsCapabilities.publicSurface();
            requirePublicPack(tenantId, publicSurface,
                    kpiCatalogService.getVisibleDefs(tenantId, publicSurface));
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
            capabilityService.resolve(extractRequestInfo(body), tenantId)
                    .require(AnalyticsCapabilities.CONFIG_REFRESH);
            boolean enabled = kpiCatalogService.refreshPublicDashboardConfig(tenantId);
            return ResponseEntity.ok(Map.of("publicDashboardEnabled", enabled));
        } catch (AnalyticsAccessDeniedException | AccessControlUnavailableException e) {
            throw e;
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
            String tenantId = extractTenantId(body);
            AnalyticsCapabilities capabilities =
                    capabilityService.resolve(extractRequestInfo(body), tenantId);
            capabilities.require(AnalyticsCapabilities.PACKS);

            List<KpiDefinition> visibleDefs = kpiCatalogService.getVisibleDefs(tenantId, capabilities);
            Map<String,KpiDefinition> defIndex = visibleDefs.stream()
                    .collect(Collectors.toMap(KpiDefinition::getId, d -> d));

            Optional<DashboardPack> pack = kpiCatalogService.getBestPack(tenantId, capabilities, visibleDefs);

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
            out.put("persona", pack.map(AnalyticsController::personaTag).orElse(null));
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
        } catch (AnalyticsAccessDeniedException | AccessControlUnavailableException e) {
            throw e;
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
            String tenantId = extractTenantId(body);
            AnalyticsCapabilities capabilities =
                    capabilityService.resolve(extractRequestInfo(body), tenantId);
            capabilities.require(AnalyticsCapabilities.CATALOG_SEARCH);

            List<KpiDefinition> visibleDefs = kpiCatalogService.getVisibleDefs(tenantId, capabilities);
            List<Map<String,Object>> tiles = visibleDefs.stream()
                    .map(this::safeTile)
                    .collect(Collectors.toList());

            Map<String,Object> out = new LinkedHashMap<>();
            out.put("tiles", tiles);
            out.put("total", tiles.size());
            return ResponseEntity.ok(out);
        } catch (AnalyticsAccessDeniedException | AccessControlUnavailableException e) {
            throw e;
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(error(e));
        } catch (Exception e) {
            log.error("analytics catalog search failed", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(error(e));
        }
    }

    // ---- helpers ----

    /**
     * The {@code persona} metric tag (#1110): which capability selected the caller's pack.
     *
     * <p>It used to be the first matching role code. The pack is now selected by a capability, so
     * the equivalent value is that capability — but emitted as its short name rather than the whole
     * action URL, because this is an OTEL datapoint attribute and a URL makes for a poor tag. The
     * cardinality stays bounded by the number of dashboard capabilities, as it was bounded by the
     * number of pack roles before.
     */
    private static String personaTag(DashboardPack pack) {
        String requiredActionUrl = pack.getRequiredActionUrl();
        if (requiredActionUrl == null)
            return pack.isPublicPack() ? "public" : null;
        int lastSegment = requiredActionUrl.lastIndexOf("/analytics/");
        return lastSegment < 0 ? requiredActionUrl : requiredActionUrl.substring(lastSegment + "/analytics/".length());
    }

    /** The matched PUBLIC pack is the fail-closed gate shared by every public alias. */
    private DashboardPack requirePublicPack(String tenantId, AnalyticsCapabilities capabilities,
                                            List<KpiDefinition> visibleDefs) {
        return kpiCatalogService.getBestPack(tenantId, capabilities, visibleDefs)
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

    /**
     * Three distinct failures, three distinct statuses. "You may not do this" and "we could not
     * find out" send a user to different remedies, and collapsing them means the dashboard shows
     * the wrong one during an incident. Rethrown past the generic catches above so they arrive
     * here rather than as an indistinguishable 500.
     */
    @ExceptionHandler(AnalyticsAccessDeniedException.class)
    public ResponseEntity<Map<String,Object>> onAccessDenied(AnalyticsAccessDeniedException e) {
        return ResponseEntity.status(HttpStatus.FORBIDDEN)
                .body(Map.of("error", "forbidden",
                        "message", "action '" + e.getAction() + "' is not permitted"));
    }

    @ExceptionHandler(AccessControlUnavailableException.class)
    public ResponseEntity<Map<String,Object>> onAccessControlUnavailable(AccessControlUnavailableException e) {
        log.error("analytics: no trustworthy access decision — failing closed: {}", e.getMessage());
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                .body(Map.of("error", "access_control_unavailable",
                        "message", "authorization could not be determined; no data was returned"));
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
