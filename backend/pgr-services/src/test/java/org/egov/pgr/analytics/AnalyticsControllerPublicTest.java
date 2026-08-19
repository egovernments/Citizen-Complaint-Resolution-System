package org.egov.pgr.analytics;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.egov.pgr.analytics.model.DashboardPack;
import org.egov.pgr.analytics.model.KpiDefinition;
import org.egov.pgr.accesscontrol.AccessControlUnavailableException;
import org.egov.pgr.accesscontrol.AccessDeniedException;
import org.egov.pgr.accesscontrol.AuthenticationRequiredException;
import org.egov.pgr.config.PGRConfiguration;
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
    @Mock private AnalyticsAccessService accessService;

    private final ObjectMapper mapper = new ObjectMapper();
    private AnalyticsController controller;

    @BeforeEach
    public void setUp() {
        controller = new AnalyticsController(service, kpiCatalogService, accessService, mapper, config);
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
        return Map.of("tenantId", targetTenant,
                "RequestInfo", Map.of("authToken", "token"));
    }

    private void givenRefreshCapability(boolean granted) {
        when(accessService.resolve(any(), anyString())).thenReturn(granted
                ? AnalyticsAccessFixtures.withCapabilities(AnalyticsAccess.CONFIG_REFRESH)
                : AnalyticsAccessFixtures.withCapabilities(AnalyticsAccess.QUERY));
    }

    @Test
    public void publicPackIgnoresSpoofedRequestInfoAndNeverReturnsRecordCount() {
        KpiDefinition def = publicDef("cl_public");
        DashboardPack pack = publicPack("cl_public");
        when(kpiCatalogService.getVisibleDefs(eq("ke"), any(AnalyticsAccess.class)))
                .thenReturn(Collections.singletonList(def));
        when(kpiCatalogService.getBestPack(eq("ke"), any(AnalyticsAccess.class), any()))
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
        verify(kpiCatalogService, never()).getVisibleDefs(anyString(), any(AnalyticsAccess.class));
        verify(kpiCatalogService, never()).getBestPack(anyString(), any(AnalyticsAccess.class), anyList());
        verifyNoInteractions(service);
    }

    @Test
    public void disabledPublicDashboardRejectsQueriesBeforeCatalogLookup() throws Exception {
        when(kpiCatalogService.isPublicDashboardEnabled("ke")).thenReturn(false);

        ResponseEntity<Map<String,Object>> response = controller.publicQuery(mapper.readTree(
                "{\"tenantId\":\"ke\",\"queries\":{\"tile\":{\"kpiId\":\"cl_public\"}}}"), null);

        assertEquals(404, response.getStatusCodeValue());
        assertEquals("public_dashboard_disabled", response.getBody().get("error"));
        verify(kpiCatalogService, never()).getVisibleDefs(anyString(), any(AnalyticsAccess.class));
        verify(kpiCatalogService, never()).getBestPack(anyString(), any(AnalyticsAccess.class), anyList());
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
        // Who may bust the config cache is now the PDP's answer (action 2645), not a role list
        // kept in this controller. The refusal surfaces as 403 through the exception handler.
        givenRefreshCapability(false);

        AccessDeniedException denied = assertThrows(AccessDeniedException.class,
                () -> controller.refreshDashboardConfig(refreshBody("ke")));

        assertEquals(AnalyticsAccess.CONFIG_REFRESH, denied.getAction());
        assertEquals(403, controller.onAccessDenied(denied).getStatusCodeValue());
        verify(kpiCatalogService, never()).refreshPublicDashboardConfig(anyString());
    }

    @Test
    public void anExpiredTokenIsAnUnauthorizedNotAServerError() {
        when(accessService.resolve(any(), anyString()))
                .thenThrow(new AuthenticationRequiredException("token rejected"));

        AuthenticationRequiredException e = assertThrows(AuthenticationRequiredException.class,
                () -> controller.refreshDashboardConfig(refreshBody("ke")));

        assertEquals(401, controller.onAuthenticationRequired(e).getStatusCodeValue());
    }

    @Test
    public void anUnreachablePolicyDecisionPointIsAServiceUnavailableNotAnEmptyDashboard() {
        when(accessService.resolve(any(), anyString()))
                .thenThrow(new AccessControlUnavailableException("access-control unreachable"));

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
        when(kpiCatalogService.getVisibleDefs(eq("ke"), any(AnalyticsAccess.class)))
                .thenReturn(Collections.singletonList(publicDef("cl_public")));
        when(kpiCatalogService.getBestPack(eq("ke"), any(AnalyticsAccess.class), any()))
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
        when(kpiCatalogService.getVisibleDefs(eq("ke"), any(AnalyticsAccess.class)))
                .thenReturn(Collections.singletonList(def));
        when(kpiCatalogService.getBestPack(eq("ke"), any(AnalyticsAccess.class), any()))
                .thenReturn(Optional.of(pack));
        when(service.query(any(JsonNode.class), any(AnalyticsAccess.class), eq("ke"), eq(1), eq("trace-1")))
                .thenReturn(Map.of("results", Collections.emptyMap()));

        JsonNode body = mapper.readTree("{\"tenantId\":\"ke\"," +
                "\"RequestInfo\":{\"userInfo\":{\"roles\":[{\"code\":\"SUPERUSER\"}]}} ," +
                "\"queries\":{\"tile\":{\"kpiId\":\"cl_public\"}}}");

        ResponseEntity<Map<String,Object>> response = controller.publicQuery(body, "trace-1");

        assertEquals(200, response.getStatusCodeValue());
        ArgumentCaptor<JsonNode> sanitized = ArgumentCaptor.forClass(JsonNode.class);
        ArgumentCaptor<AnalyticsAccess> access = ArgumentCaptor.forClass(AnalyticsAccess.class);
        verify(service).query(sanitized.capture(), access.capture(), eq("ke"), eq(1), eq("trace-1"));
        assertFalse(sanitized.getValue().has("RequestInfo"));
        // The spoofed SUPERUSER in the body buys nothing: this route always runs on the public
        // surface, which holds no capability at all.
        assertTrue(access.getValue().isPublicSurface());
        assertTrue(access.getValue().getCapabilities().isEmpty());
        assertEquals(mapper.readTree("{\"tenantId\":\"ke\",\"queries\":{\"tile\":{\"kpiId\":\"cl_public\"}}}"),
                sanitized.getValue());
    }

    @Test
    public void publicQueryHidesUnexpectedExceptionDetails() throws Exception {
        KpiDefinition def = publicDef("cl_public");
        DashboardPack pack = publicPack("cl_public");
        when(kpiCatalogService.getVisibleDefs(eq("ke"), any(AnalyticsAccess.class)))
                .thenReturn(Collections.singletonList(def));
        when(kpiCatalogService.getBestPack(eq("ke"), any(AnalyticsAccess.class), any()))
                .thenReturn(Optional.of(pack));
        when(service.query(any(JsonNode.class), any(AnalyticsAccess.class), eq("ke"), eq(1), isNull()))
                .thenThrow(new RuntimeException("select password from private_table"));

        ResponseEntity<Map<String,Object>> response = controller.publicQuery(mapper.readTree(
                "{\"tenantId\":\"ke\",\"queries\":{\"tile\":{\"kpiId\":\"cl_public\"}}}"), null);

        assertEquals(500, response.getStatusCodeValue());
        assertEquals(Map.of("error", "query_failed",
                        "message", "public dashboard is unavailable"), response.getBody());
        assertFalse(response.getBody().toString().contains("private_table"));
    }

    @Test
    public void publicQueryRejectsCallerParamsAndKpisOutsideThePack() throws Exception {
        KpiDefinition def = publicDef("cl_public");
        DashboardPack pack = publicPack("cl_public");
        when(kpiCatalogService.getVisibleDefs(eq("ke"), any(AnalyticsAccess.class)))
                .thenReturn(Collections.singletonList(def));
        when(kpiCatalogService.getBestPack(eq("ke"), any(AnalyticsAccess.class), any()))
                .thenReturn(Optional.of(pack));

        ResponseEntity<Map<String,Object>> withParams = controller.publicQuery(mapper.readTree(
                "{\"tenantId\":\"ke\",\"queries\":{\"tile\":{" +
                        "\"kpiId\":\"cl_public\",\"params\":{\"ward\":\"W1\"}}}}"), null);
        ResponseEntity<Map<String,Object>> outsidePack = controller.publicQuery(mapper.readTree(
                "{\"tenantId\":\"ke\",\"queries\":{\"tile\":{" +
                        "\"kpiId\":\"cl_other\"}}}"), null);

        assertEquals(400, withParams.getStatusCodeValue());
        assertEquals("invalid_param", withParams.getBody().get("error"));
        assertEquals(400, outsidePack.getStatusCodeValue());
        assertEquals("kpi_forbidden", outsidePack.getBody().get("error"));
        verifyNoInteractions(service);
    }
}
