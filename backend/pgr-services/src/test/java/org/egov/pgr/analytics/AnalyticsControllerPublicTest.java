package org.egov.pgr.analytics;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.egov.pgr.analytics.model.DashboardPack;
import org.egov.pgr.analytics.model.KpiDefinition;
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

    private final ObjectMapper mapper = new ObjectMapper();
    private AnalyticsController controller;

    @BeforeEach
    public void setUp() {
        controller = new AnalyticsController(service, kpiCatalogService, mapper, config);
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
        KpiDefinition.KpiRbac rbac = new KpiDefinition.KpiRbac();
        rbac.setVisibleTo(Collections.singletonList("PUBLIC"));
        def.setRbac(rbac);
        return def;
    }

    private DashboardPack publicPack(String... ids) {
        DashboardPack pack = new DashboardPack();
        pack.setId("public-default");
        pack.setRoles(Collections.singletonList("PUBLIC"));
        pack.setTiles(Arrays.asList(ids));
        pack.setLayout(Collections.emptyList());
        return pack;
    }

    @Test
    public void publicPackIgnoresSpoofedRequestInfoAndNeverReturnsRecordCount() {
        KpiDefinition def = publicDef("cl_public");
        DashboardPack pack = publicPack("cl_public");
        when(kpiCatalogService.getVisibleDefs(eq("ke"), eq(Set.of("PUBLIC"))))
                .thenReturn(Collections.singletonList(def));
        when(kpiCatalogService.getBestPack(eq("ke"), eq(Set.of("PUBLIC")), any()))
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
        assertFalse(response.getBody().containsKey("recordCount"));
        verify(service, never()).recordCount(anyString(), anyInt());
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
        verify(kpiCatalogService, never()).getVisibleDefs(anyString(), anySet());
        verify(kpiCatalogService, never()).getBestPack(anyString(), anySet(), anyList());
        verifyNoInteractions(service);
    }

    @Test
    public void disabledPublicDashboardRejectsQueriesBeforeCatalogLookup() throws Exception {
        when(kpiCatalogService.isPublicDashboardEnabled("ke")).thenReturn(false);

        ResponseEntity<Map<String,Object>> response = controller.publicQuery(mapper.readTree(
                "{\"tenantId\":\"ke\",\"queries\":{\"tile\":{\"kpiId\":\"cl_public\"}}}"), null);

        assertEquals(404, response.getStatusCodeValue());
        assertEquals("public_dashboard_disabled", response.getBody().get("error"));
        verify(kpiCatalogService, never()).getVisibleDefs(anyString(), anySet());
        verify(kpiCatalogService, never()).getBestPack(anyString(), anySet(), anyList());
        verifyNoInteractions(service);
    }

    @Test
    public void configRefreshReturnsFreshPublicDashboardState() {
        when(kpiCatalogService.refreshPublicDashboardConfig("ke")).thenReturn(true);

        ResponseEntity<Map<String,Object>> response =
                controller.refreshDashboardConfig(Map.of("tenantId", "ke"));

        assertEquals(200, response.getStatusCodeValue());
        assertEquals(true, response.getBody().get("publicDashboardEnabled"));
        verify(kpiCatalogService).refreshPublicDashboardConfig("ke");
    }

    @Test
    public void missingPublicPackFailsClosedToAnEmptyDashboard() {
        when(kpiCatalogService.getVisibleDefs(eq("ke"), eq(Set.of("PUBLIC"))))
                .thenReturn(Collections.singletonList(publicDef("cl_public")));
        when(kpiCatalogService.getBestPack(eq("ke"), eq(Set.of("PUBLIC")), any()))
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
        when(kpiCatalogService.getVisibleDefs(eq("ke"), eq(Set.of("PUBLIC"))))
                .thenReturn(Collections.singletonList(def));
        when(kpiCatalogService.getBestPack(eq("ke"), eq(Set.of("PUBLIC")), any()))
                .thenReturn(Optional.of(pack));
        when(service.query(any(JsonNode.class), isNull(), eq("ke"), eq(1), eq("trace-1")))
                .thenReturn(Map.of("results", Collections.emptyMap()));

        JsonNode body = mapper.readTree("{\"tenantId\":\"ke\"," +
                "\"RequestInfo\":{\"userInfo\":{\"roles\":[{\"code\":\"SUPERUSER\"}]}} ," +
                "\"queries\":{\"tile\":{\"kpiId\":\"cl_public\"}}}");

        ResponseEntity<Map<String,Object>> response = controller.publicQuery(body, "trace-1");

        assertEquals(200, response.getStatusCodeValue());
        ArgumentCaptor<JsonNode> sanitized = ArgumentCaptor.forClass(JsonNode.class);
        verify(service).query(sanitized.capture(), isNull(), eq("ke"), eq(1), eq("trace-1"));
        assertFalse(sanitized.getValue().has("RequestInfo"));
        assertEquals(mapper.readTree("{\"tenantId\":\"ke\",\"queries\":{\"tile\":{\"kpiId\":\"cl_public\"}}}"),
                sanitized.getValue());
    }

    @Test
    public void publicQueryRejectsCallerParamsAndKpisOutsideThePack() throws Exception {
        KpiDefinition def = publicDef("cl_public");
        DashboardPack pack = publicPack("cl_public");
        when(kpiCatalogService.getVisibleDefs(eq("ke"), eq(Set.of("PUBLIC"))))
                .thenReturn(Collections.singletonList(def));
        when(kpiCatalogService.getBestPack(eq("ke"), eq(Set.of("PUBLIC")), any()))
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
