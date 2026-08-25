package org.egov.pgr.analytics;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.egov.pgr.analytics.model.DashboardPack;
import org.egov.pgr.analytics.model.KpiDefinition;
import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.policy.AccessControlUnavailableException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.http.ResponseEntity;

import java.util.*;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** Security contract for the dedicated, always-anonymous public dashboard endpoints. */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
public class AnalyticsControllerPublicTest {

    @Mock private AnalyticsService service;
    @Mock private KpiCatalogService kpiCatalogService;
    @Mock private PGRConfiguration config;
    @Mock private AnalyticsCapabilityService capabilityService;

    private final ObjectMapper mapper = new ObjectMapper();
    private AnalyticsController controller;

    @BeforeEach
    public void setUp() {
        controller = new AnalyticsController(service, kpiCatalogService, capabilityService, mapper, config);
        when(config.getStateLevelTenantIdLength()).thenReturn(1);
        when(kpiCatalogService.isPublicDashboardEnabled(anyString())).thenReturn(true);
    }

    private KpiDefinition publicDef(String id) {
        KpiDefinition def = new KpiDefinition();
        def.setId(id);
        def.setVersion("1.0.0");
        def.setStatus("published");
        KpiDefinition.KpiViz viz = new KpiDefinition.KpiViz();
        viz.setKind("number-tile");
        viz.setTitleKey("DASHBOARD_" + id.toUpperCase(Locale.ROOT));
        def.setViz(viz);
        def.setPublicTile(true);
        return def;
    }

    private DashboardPack publicPack(String... ids) {
        DashboardPack pack = new DashboardPack();
        pack.setId("public-default");
        pack.setPublicPack(true);
        pack.setTiles(Arrays.asList(ids));
        pack.setLayout(Collections.emptyList());
        return pack;
    }

    private Map<String,Object> refreshBody(String targetTenant) {
        return Map.of("tenantId", targetTenant, "RequestInfo", Map.of("authToken", "token"));
    }

    private void givenRefreshCapability(boolean granted) {
        when(capabilityService.resolve(any(), anyString())).thenReturn(granted
                ? AnalyticsCapabilityFixtures.of(AnalyticsCapabilities.CONFIG_REFRESH)
                : AnalyticsCapabilityFixtures.of(AnalyticsCapabilities.QUERY));
    }

    @Test
    public void publicPackIgnoresSpoofedRequestInfoAndNeverReturnsRecordCount() {
        KpiDefinition def = publicDef("cl_public");
        DashboardPack pack = publicPack("cl_public");
        when(kpiCatalogService.getVisibleDefs(eq("ke"), any(AnalyticsCapabilities.class)))
                .thenReturn(Collections.singletonList(def));
        when(kpiCatalogService.getBestPack(eq("ke"), any(AnalyticsCapabilities.class), any()))
                .thenReturn(Optional.of(pack));

        Map<String,Object> body = new LinkedHashMap<>();
        body.put("tenantId", "ke");
        body.put("RequestInfo", Map.of("userInfo", Map.of(
                "roles", List.of(Map.of("code", "SUPERUSER")))));

        ResponseEntity<Map<String,Object>> response = controller.getPublicPack(body);

        assertEquals(200, response.getStatusCodeValue());
        assertEquals("public-default", response.getBody().get("packId"));
        assertEquals(true, response.getBody().get("enabled"));
        assertEquals(1, ((List<?>) response.getBody().get("tiles")).size());
        assertEquals(AnalyticsService.MAX_BATCH_QUERIES,
                response.getBody().get("maxBatchQueries"));
        assertFalse(response.getBody().containsKey("recordCount"));
        verify(service, never()).recordCount(anyString(), anyInt());
    }

    @Test
    public void publicPackHidesUnexpectedExceptionDetails() {
        when(kpiCatalogService.isPublicDashboardEnabled("ke"))
                .thenThrow(new RuntimeException("jdbc://internal-host/secret"));

        ResponseEntity<Map<String,Object>> response =
                controller.getPublicPack(Map.of("tenantId", "ke"));

        assertEquals(500, response.getStatusCodeValue());
        assertEquals(Map.of("error", "query_failed",
                        "message", "public dashboard is unavailable"), response.getBody());
        assertFalse(response.getBody().toString().contains("internal-host"));
    }

    @Test
    public void disabledPublicDashboardReturnsDataFreePackEnvelope() {
        when(kpiCatalogService.isPublicDashboardEnabled("ke")).thenReturn(false);

        ResponseEntity<Map<String,Object>> response =
                controller.getPublicPack(Map.of("tenantId", "ke"));

        assertEquals(200, response.getStatusCodeValue());
        assertEquals(false, response.getBody().get("enabled"));
        assertEquals(Collections.emptyList(), response.getBody().get("tiles"));
        assertEquals(Collections.emptyList(), response.getBody().get("defaultLayout"));
        assertNull(response.getBody().get("packId"));
        assertEquals(AnalyticsService.MAX_BATCH_QUERIES,
                response.getBody().get("maxBatchQueries"));
        verify(kpiCatalogService, never()).getVisibleDefs(anyString(), any(AnalyticsCapabilities.class));
        verify(kpiCatalogService, never()).getBestPack(anyString(), any(AnalyticsCapabilities.class), anyList());
        verifyNoInteractions(service);
    }

    @Test
    public void disabledPublicDashboardRejectsQueriesBeforeCatalogLookup() throws Exception {
        when(kpiCatalogService.isPublicDashboardEnabled("ke")).thenReturn(false);

        ResponseEntity<Map<String,Object>> response = controller.publicQuery(mapper.readTree(
                "{\"tenantId\":\"ke\",\"queries\":{\"tile\":{\"kpiId\":\"cl_public\"}}}"), null);

        assertEquals(404, response.getStatusCodeValue());
        assertEquals("public_dashboard_disabled", response.getBody().get("error"));
        verify(kpiCatalogService, never()).getVisibleDefs(anyString(), any(AnalyticsCapabilities.class));
        verify(kpiCatalogService, never()).getBestPack(anyString(), any(AnalyticsCapabilities.class), anyList());
        verifyNoInteractions(service);
    }

    @Test
    public void configRefreshReturnsFreshPublicDashboardState() {
        when(kpiCatalogService.refreshPublicDashboardConfig("ke")).thenReturn(true);

        givenRefreshCapability(true);

        ResponseEntity<Map<String,Object>> response =
                controller.refreshDashboardConfig(refreshBody("ke"));

        assertEquals(200, response.getStatusCodeValue());
        assertEquals(true, response.getBody().get("publicDashboardEnabled"));
        verify(kpiCatalogService).refreshPublicDashboardConfig("ke");
    }

    @Test
    public void configRefreshAllowsConfiguratorAdminWithinCallerTenantTree() {
        when(kpiCatalogService.refreshPublicDashboardConfig("ke.bomet")).thenReturn(false);

        givenRefreshCapability(true);

        ResponseEntity<Map<String,Object>> response = controller.refreshDashboardConfig(
                refreshBody("ke.bomet"));

        assertEquals(200, response.getStatusCodeValue());
        assertEquals(false, response.getBody().get("publicDashboardEnabled"));
        verify(kpiCatalogService).refreshPublicDashboardConfig("ke.bomet");
    }

    @Test
    public void configRefreshIsRefusedWithoutTheRefreshCapability() {
        // Who may bust the config cache is now the role-action master's answer (action 2645), not a
        // role list kept in this controller. The refusal surfaces as 403 through the handler.
        givenRefreshCapability(false);

        AnalyticsAccessDeniedException denied = assertThrows(AnalyticsAccessDeniedException.class,
                () -> controller.refreshDashboardConfig(refreshBody("ke")));

        assertEquals(AnalyticsCapabilities.CONFIG_REFRESH, denied.getAction());
        assertEquals(403, controller.onAccessDenied(denied).getStatusCodeValue());
        verify(kpiCatalogService, never()).refreshPublicDashboardConfig(anyString());
    }

    @Test
    public void anUnreachableAccessControlIsAServiceUnavailableNotAnEmptyDashboard() {
        when(capabilityService.resolve(any(), anyString()))
                .thenThrow(new AccessControlUnavailableException("accesscontrol unreachable"));

        AccessControlUnavailableException e = assertThrows(AccessControlUnavailableException.class,
                () -> controller.refreshDashboardConfig(refreshBody("ke")));

        assertEquals(503, controller.onAccessControlUnavailable(e).getStatusCodeValue());
        verify(kpiCatalogService, never()).refreshPublicDashboardConfig(anyString());
    }

    @Test
    public void nullBodyReturnsTheExistingMissingTenantValidationError() {
        ResponseEntity<Map<String,Object>> publicPack = controller.getPublicPack(null);
        ResponseEntity<Map<String,Object>> publicQuery = controller.publicQuery(null, null);
        ResponseEntity<Map<String,Object>> refresh = controller.refreshDashboardConfig(null);

        assertEquals(400, publicPack.getStatusCodeValue());
        assertEquals("invalid_param", publicPack.getBody().get("error"));
        assertEquals("invalid_param: tenantId is required", publicPack.getBody().get("message"));
        assertEquals(400, publicQuery.getStatusCodeValue());
        assertEquals(publicPack.getBody(), publicQuery.getBody());
        assertEquals(400, refresh.getStatusCodeValue());
        assertEquals(publicPack.getBody(), refresh.getBody());
        verifyNoInteractions(kpiCatalogService, service);
    }

    @Test
    public void missingPublicPackFailsClosedToAnEmptyDashboard() {
        when(kpiCatalogService.getVisibleDefs(eq("ke"), any(AnalyticsCapabilities.class)))
                .thenReturn(Collections.singletonList(publicDef("cl_public")));
        when(kpiCatalogService.getBestPack(eq("ke"), any(AnalyticsCapabilities.class), any()))
                .thenReturn(Optional.empty());

        ResponseEntity<Map<String,Object>> response =
                controller.getPublicPack(Map.of("tenantId", "ke"));

        assertEquals(200, response.getStatusCodeValue());
        assertEquals(Collections.emptyList(), response.getBody().get("tiles"));
        assertEquals(Collections.emptyList(), response.getBody().get("defaultLayout"));
        assertNull(response.getBody().get("packId"));
        assertFalse(response.getBody().containsKey("recordCount"));
    }

    @Test
    public void publicQueryForcesPublicAndDelegatesOnlyTheSanitizedBarePackRef() throws Exception {
        KpiDefinition def = publicDef("cl_public");
        DashboardPack pack = publicPack("cl_public");
        when(kpiCatalogService.getVisibleDefs(eq("ke"), any(AnalyticsCapabilities.class)))
                .thenReturn(Collections.singletonList(def));
        when(kpiCatalogService.getBestPack(eq("ke"), any(AnalyticsCapabilities.class), any()))
                .thenReturn(Optional.of(pack));
        when(service.query(any(JsonNode.class), isNull(), any(AnalyticsCapabilities.class), eq("ke"), eq(1), eq("trace-1")))
                .thenReturn(Map.of("results", Collections.emptyMap()));

        JsonNode body = mapper.readTree("{\"tenantId\":\"ke\"," +
                "\"RequestInfo\":{\"userInfo\":{\"roles\":[{\"code\":\"SUPERUSER\"}]}} ," +
                "\"queries\":{\"tile\":{\"kpiId\":\"cl_public\"}}}");

        ResponseEntity<Map<String,Object>> response = controller.publicQuery(body, "trace-1");

        assertEquals(200, response.getStatusCodeValue());
        ArgumentCaptor<JsonNode> sanitized = ArgumentCaptor.forClass(JsonNode.class);
        verify(service).query(sanitized.capture(), isNull(), any(AnalyticsCapabilities.class), eq("ke"), eq(1), eq("trace-1"));
        assertFalse(sanitized.getValue().has("RequestInfo"));
        assertEquals(mapper.readTree("{\"tenantId\":\"ke\",\"queries\":{\"tile\":{\"kpiId\":\"cl_public\"}}}"),
                sanitized.getValue());
    }

    @Test
    public void publicQueryHidesUnexpectedExceptionDetails() throws Exception {
        KpiDefinition def = publicDef("cl_public");
        DashboardPack pack = publicPack("cl_public");
        when(kpiCatalogService.getVisibleDefs(eq("ke"), any(AnalyticsCapabilities.class)))
                .thenReturn(Collections.singletonList(def));
        when(kpiCatalogService.getBestPack(eq("ke"), any(AnalyticsCapabilities.class), any()))
                .thenReturn(Optional.of(pack));
        when(service.query(any(JsonNode.class), isNull(), any(AnalyticsCapabilities.class), eq("ke"), eq(1), isNull()))
                .thenThrow(new RuntimeException("select password from private_table"));

        ResponseEntity<Map<String,Object>> response = controller.publicQuery(mapper.readTree(
                "{\"tenantId\":\"ke\",\"queries\":{\"tile\":{\"kpiId\":\"cl_public\"}}}"), null);

        assertEquals(500, response.getStatusCodeValue());
        assertEquals(Map.of("error", "query_failed",
                        "message", "public dashboard is unavailable"), response.getBody());
        assertFalse(response.getBody().toString().contains("private_table"));
    }

    @Test
    public void publicQueryForwardsOnlyAllowListedFilterParams() throws Exception {
        KpiDefinition def = publicDef("cl_public");
        DashboardPack pack = publicPack("cl_public");
        when(kpiCatalogService.getVisibleDefs(eq("ke"), any(AnalyticsCapabilities.class)))
                .thenReturn(Collections.singletonList(def));
        when(kpiCatalogService.getBestPack(eq("ke"), any(AnalyticsCapabilities.class), any()))
                .thenReturn(Optional.of(pack));
        when(service.query(any(JsonNode.class), isNull(), any(AnalyticsCapabilities.class),
                eq("ke"), eq(1), isNull()))
                .thenReturn(Map.of("results", Collections.emptyMap()));

        ResponseEntity<Map<String,Object>> response = controller.publicQuery(mapper.readTree(
                "{\"tenantId\":\"ke\",\"queries\":{\"tile\":{\"kpiId\":\"cl_public\"," +
                        "\"params\":{\"dateFrom\":\"2026-07-01\",\"dateTo\":\"2026-07-31\"," +
                        "\"ward\":\" W1 \",\"serviceCode\":\"Pothole\",\"complaintPath\":\"Roads\"}}}}"),
                null);

        assertEquals(200, response.getStatusCodeValue());
        ArgumentCaptor<JsonNode> sanitized = ArgumentCaptor.forClass(JsonNode.class);
        verify(service).query(sanitized.capture(), isNull(), any(AnalyticsCapabilities.class),
                eq("ke"), eq(1), isNull());
        JsonNode params = sanitized.getValue().at("/queries/tile/params");
        assertEquals(mapper.readTree("{\"dateFrom\":\"2026-07-01\",\"dateTo\":\"2026-07-31\"," +
                "\"ward\":\"W1\",\"serviceCode\":\"Pothole\",\"complaintPath\":\"Roads\"}"), params);
    }

    @Test
    public void publicQueryAllowsAnyPublicTileNotJustPackTiles() throws Exception {
        when(kpiCatalogService.getVisibleDefs(eq("ke"), any(AnalyticsCapabilities.class)))
                .thenReturn(Arrays.asList(publicDef("cl_public"), publicDef("cl_public_extra")));
        when(kpiCatalogService.getBestPack(eq("ke"), any(AnalyticsCapabilities.class), any()))
                .thenReturn(Optional.of(publicPack("cl_public")));
        when(service.query(any(JsonNode.class), isNull(), any(AnalyticsCapabilities.class),
                eq("ke"), eq(1), isNull()))
                .thenReturn(Map.of("results", Collections.emptyMap()));

        ResponseEntity<Map<String,Object>> added = controller.publicQuery(mapper.readTree(
                "{\"tenantId\":\"ke\",\"queries\":{\"tile\":{\"kpiId\":\"cl_public_extra\"}}}"), null);
        ResponseEntity<Map<String,Object>> notPublic = controller.publicQuery(mapper.readTree(
                "{\"tenantId\":\"ke\",\"queries\":{\"tile\":{\"kpiId\":\"cl_officer_pii\"}}}"), null);

        assertEquals(200, added.getStatusCodeValue());
        assertEquals(400, notPublic.getStatusCodeValue());
        assertEquals("kpi_forbidden", notPublic.getBody().get("error"));
        verify(service, times(1)).query(any(JsonNode.class), isNull(), any(AnalyticsCapabilities.class),
                eq("ke"), eq(1), isNull());
    }

    @Test
    public void publicQueryRejectsEveryParamOutsideTheAllowList() throws Exception {
        KpiDefinition def = publicDef("cl_public");
        when(kpiCatalogService.getVisibleDefs(eq("ke"), any(AnalyticsCapabilities.class)))
                .thenReturn(Collections.singletonList(def));
        when(kpiCatalogService.getBestPack(eq("ke"), any(AnalyticsCapabilities.class), any()))
                .thenReturn(Optional.of(publicPack("cl_public")));

        String[] rejected = {
                "{\"hierLevel\":\"1\"}",                       // aggregation level
                "{\"compare\":\"prior\"}",                     // companion fan-out
                "{\"series\":\"daily\"}",
                "{\"window\":\"all\"}",                        // window override
                "{\"ward\":[\"W1\",\"W2\"]}",                 // non-scalar
                "{\"ward\":\"   \"}",                          // blank
                "{\"dateFrom\":\"01/07/2026\"}",               // not an ISO day
                "{\"dateFrom\":\"2026-07-01\"}",               // incomplete range
                "{\"dateTo\":\"2026-07-31\"}",                 // incomplete range
                "{\"serviceCode\":\"" + "x".repeat(129) + "\"}", // over-long
        };
        for (String params : rejected) {
            ResponseEntity<Map<String,Object>> response = controller.publicQuery(mapper.readTree(
                    "{\"tenantId\":\"ke\",\"queries\":{\"tile\":{" +
                            "\"kpiId\":\"cl_public\",\"params\":" + params + "}}}"), null);
            assertEquals(400, response.getStatusCodeValue(), params);
            assertEquals("invalid_param", response.getBody().get("error"), params);
        }
        // A foreign top-level field on the ref is rejected too (nothing but kpiId/params).
        ResponseEntity<Map<String,Object>> foreign = controller.publicQuery(mapper.readTree(
                "{\"tenantId\":\"ke\",\"queries\":{\"tile\":{" +
                        "\"kpiId\":\"cl_public\",\"query\":{\"grain\":\"facts\"}}}}"), null);
        assertEquals(400, foreign.getStatusCodeValue());
        assertEquals("invalid_param", foreign.getBody().get("error"));
        verifyNoInteractions(service);
    }

    @Test
    public void publicCatalogListsEveryPublicTileAndIgnoresSpoofedRequestInfo() {
        when(kpiCatalogService.getVisibleDefs(eq("ke"), any(AnalyticsCapabilities.class)))
                .thenReturn(Arrays.asList(publicDef("cl_public"), publicDef("cl_public_extra")));
        when(kpiCatalogService.getBestPack(eq("ke"), any(AnalyticsCapabilities.class), any()))
                .thenReturn(Optional.of(publicPack("cl_public")));

        ResponseEntity<Map<String,Object>> response = controller.searchPublicCatalog(Map.of(
                "tenantId", "ke",
                "RequestInfo", Map.of("userInfo", Map.of("roles", List.of(Map.of("code", "SUPERUSER"))))));

        assertEquals(200, response.getStatusCodeValue());
        assertEquals(2, response.getBody().get("total"));
        @SuppressWarnings("unchecked")
        List<Map<String,Object>> tiles = (List<Map<String,Object>>) response.getBody().get("tiles");
        assertEquals(List.of("cl_public", "cl_public_extra"),
                tiles.stream().map(t -> t.get("kpiId")).collect(java.util.stream.Collectors.toList()));
        for (Map<String,Object> tile : tiles) {
            assertFalse(tile.containsKey("query"));
            assertFalse(tile.containsKey("rbac"));
        }
        ArgumentCaptor<AnalyticsCapabilities> capabilities = ArgumentCaptor.forClass(AnalyticsCapabilities.class);
        verify(kpiCatalogService).getVisibleDefs(eq("ke"), capabilities.capture());
        assertTrue(capabilities.getValue().isPublicSurface(),
                "spoofed RequestInfo must not turn the anonymous catalog into an employee query");
    }

    @Test
    public void publicCatalogAndOptionsFailClosedWhenDisabled() {
        when(kpiCatalogService.isPublicDashboardEnabled("ke")).thenReturn(false);

        ResponseEntity<Map<String,Object>> catalog = controller.searchPublicCatalog(Map.of("tenantId", "ke"));
        ResponseEntity<Map<String,Object>> options = controller.publicFilterOptions(Map.of("tenantId", "ke"), null);

        assertEquals(404, catalog.getStatusCodeValue());
        assertEquals("public_dashboard_disabled", catalog.getBody().get("error"));
        assertEquals(404, options.getStatusCodeValue());
        assertEquals("public_dashboard_disabled", options.getBody().get("error"));
        verifyNoInteractions(service);
        verify(kpiCatalogService, never()).getVisibleDefs(anyString(), any());
    }

    @Test
    public void publicCatalogAndOptionsFailClosedWithoutAPublicPack() {
        when(kpiCatalogService.getVisibleDefs(eq("ke"), any(AnalyticsCapabilities.class)))
                .thenReturn(Collections.singletonList(publicDef("cl_public")));
        when(kpiCatalogService.getBestPack(eq("ke"), any(AnalyticsCapabilities.class), any()))
                .thenReturn(Optional.empty());

        ResponseEntity<Map<String,Object>> catalog = controller.searchPublicCatalog(Map.of("tenantId", "ke"));
        ResponseEntity<Map<String,Object>> options = controller.publicFilterOptions(Map.of("tenantId", "ke"), null);

        // Same gate as /public/_query: enabled-but-unconfigured exposes neither descriptors nor codes.
        assertEquals(400, catalog.getStatusCodeValue());
        assertEquals("public_pack_not_found", catalog.getBody().get("error"));
        assertEquals(400, options.getStatusCodeValue());
        assertEquals("public_pack_not_found", options.getBody().get("error"));
        verifyNoInteractions(service);
    }

    @Test
    public void publicOptionsDelegateToTheServerOwnedDistinctsAndHideFailures() {
        when(kpiCatalogService.getVisibleDefs(eq("ke"), any(AnalyticsCapabilities.class)))
                .thenReturn(Collections.singletonList(publicDef("cl_public")));
        when(kpiCatalogService.getBestPack(eq("ke"), any(AnalyticsCapabilities.class), any()))
                .thenReturn(Optional.of(publicPack("cl_public")));
        when(service.publicFilterOptions("ke", 1, "trace-9"))
                .thenReturn(Map.of("results", Map.of("wards", Map.of("rows", List.of(Map.of("ward_code", "W1"))))));

        ResponseEntity<Map<String,Object>> response = controller.publicFilterOptions(Map.of(
                "tenantId", "ke",
                "RequestInfo", Map.of("authToken", "stolen")), "trace-9");

        assertEquals(200, response.getStatusCodeValue());
        assertTrue(response.getBody().containsKey("results"));
        verify(service).publicFilterOptions("ke", 1, "trace-9");

        when(service.publicFilterOptions("ke", 1, null))
                .thenThrow(new RuntimeException("select password from private_table"));
        ResponseEntity<Map<String,Object>> failure = controller.publicFilterOptions(Map.of("tenantId", "ke"), null);
        assertEquals(500, failure.getStatusCodeValue());
        assertFalse(failure.getBody().toString().contains("private_table"));
    }
}
