package org.egov.pgr.analytics;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.egov.pgr.analytics.model.KpiDefinition;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.jdbc.core.JdbcTemplate;

import java.time.ZoneId;
import java.util.*;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * The PUBLIC-floor param policy is enforced in the SERVICE (#1797), so it holds on the plain
 * {@code /_query} path too — the door an anonymous body still reaches while Kong runs in audit
 * mode — not only on the {@code /public/_query} alias.
 */
public class AnalyticsServicePublicFloorParamsTest {

    private final ObjectMapper om = new ObjectMapper();
    private final AnalyticsCatalog catalog = new AnalyticsCatalog();
    private AnalyticsPlanner planner;
    private JdbcTemplate jdbc;
    private KpiCatalogService kpiCatalogService;
    private AnalyticsService service;

    @BeforeEach
    public void setUp() {
        planner = spy(new AnalyticsPlanner(catalog));
        jdbc = mock(JdbcTemplate.class);
        when(jdbc.queryForList(anyString(), any(Object[].class))).thenReturn(Collections.emptyList());
        kpiCatalogService = mock(KpiCatalogService.class);
        when(kpiCatalogService.resolveTimeZone(anyString())).thenReturn(ZoneId.of("Africa/Nairobi"));
        AnalyticsRowScopeResolver scopeResolver = mock(AnalyticsRowScopeResolver.class);
        service = new AnalyticsService(planner, catalog, jdbc, kpiCatalogService, scopeResolver,
                new KpiQueryComposer(catalog), new AnalyticsMetrics(), null);
    }

    private JsonNode json(String s) {
        try { return om.readTree(s); } catch (Exception e) { throw new RuntimeException(e); }
    }

    private KpiDefinition publishPublicDef(String id, String queryJson) {
        KpiDefinition def = new KpiDefinition();
        def.setId(id);
        def.setVersion("1.0.0");
        def.setStatus("published");
        def.setQuery(json(queryJson));
        def.setPublicTile(true);
        when(kpiCatalogService.getDef(id, "ke")).thenReturn(Optional.of(def));
        return def;
    }

    @SuppressWarnings("unchecked")
    private Map<String,Object> entry(Map<String,Object> out, String name) {
        return (Map<String,Object>) ((Map<String,Object>) out.get("results")).get(name);
    }

    @Test
    public void anonymousBatchOnThePlainQueryPathRejectsParamsOutsideTheAllowList() {
        publishPublicDef("cl_public", "{\"grain\":\"facts\",\"measures\":[{\"name\":\"total\",\"agg\":\"count\"}]}");

        Map<String,Object> out = service.query(json("{\"queries\":{" +
                "\"ok\":{\"kpiId\":\"cl_public\",\"params\":{\"ward\":\"W1\",\"dateFrom\":\"2026-07-01\",\"dateTo\":\"2026-07-31\"}}," +
                "\"hier\":{\"kpiId\":\"cl_public\",\"params\":{\"hierLevel\":\"1\"}}," +
                "\"prior\":{\"kpiId\":\"cl_public\",\"params\":{\"compare\":\"prior\"}}," +
                "\"window\":{\"kpiId\":\"cl_public\",\"params\":{\"window\":\"all\"}}," +
                "\"dateFromOnly\":{\"kpiId\":\"cl_public\",\"params\":{\"dateFrom\":\"2026-07-01\"}}," +
                "\"dateToOnly\":{\"kpiId\":\"cl_public\",\"params\":{\"dateTo\":\"2026-07-31\"}}," +
                "\"inline\":{\"grain\":\"facts\",\"measures\":[{\"name\":\"total\",\"agg\":\"count\"}]}}}"),
                null, AnalyticsCapabilities.publicSurface(), "ke", 1);

        assertFalse(entry(out, "ok").containsKey("error"), entry(out, "ok").toString());
        for (String rejected : Arrays.asList("hier", "prior", "window", "dateFromOnly", "dateToOnly"))
            assertEquals("invalid_param", entry(out, rejected).get("error"), rejected);
        assertEquals("kpi_forbidden", entry(out, "inline").get("error"));
        assertEquals(Boolean.TRUE, out.get("partial"));

        // Only the allow-listed entry reached SQL, with its narrowing bound.
        ArgumentCaptor<String> sql = ArgumentCaptor.forClass(String.class);
        verify(jdbc, times(1)).queryForList(sql.capture(), any(Object[].class));
        assertTrue(sql.getValue().contains("ward_code"), sql.getValue());
    }

    @Test
    public void publicParamsMayNotDisplaceAPublicDefsOwnBakedFilter() {
        // "Water complaints" — the def's identity IS its service_code predicate.
        publishPublicDef("cl_water", "{\"grain\":\"facts\",\"filters\":{\"service_code\":\"WATER\"}," +
                "\"measures\":[{\"name\":\"total\",\"agg\":\"count\"}]}");

        Map<String,Object> out = service.query(json("{\"queries\":{\"t\":{\"kpiId\":\"cl_water\"," +
                "\"params\":{\"serviceCode\":\"POLICE_MISCONDUCT\",\"ward\":\"W1\"}}}}"), null,
                AnalyticsCapabilities.publicSurface(), "ke", 1);

        Map<String,Object> t = entry(out, "t");
        assertFalse(t.containsKey("error"), t.toString());
        assertEquals(Collections.singletonList("serviceCode"), t.get("paramsIgnored"));
        ArgumentCaptor<Object[]> binds = ArgumentCaptor.forClass(Object[].class);
        verify(jdbc).queryForList(anyString(), binds.capture());
        List<Object> bound = Arrays.asList(binds.getValue());
        assertTrue(bound.contains("WATER"), bound.toString());
        assertFalse(bound.contains("POLICE_MISCONDUCT"), bound.toString());
        assertTrue(bound.contains("W1"), "the non-baked ward narrowing still applies: " + bound);
    }

    @Test
    public void publicDefaultsMayNotDisplaceAPublicDefsOwnBakedFilter() {
        KpiDefinition def = publishPublicDef("cl_water",
                "{\"grain\":\"facts\",\"filters\":{\"service_code\":\"WATER\"}," +
                        "\"measures\":[{\"name\":\"total\",\"agg\":\"count\"}]}");
        KpiDefinition.KpiParam serviceCode = new KpiDefinition.KpiParam();
        serviceCode.setName("serviceCode");
        serviceCode.setDefaultValue("POLICE_MISCONDUCT");
        def.setParams(Collections.singletonList(serviceCode));

        Map<String,Object> out = service.query(
                json("{\"queries\":{\"t\":{\"kpiId\":\"cl_water\"}}}"), null,
                AnalyticsCapabilities.publicSurface(), "ke", 1);

        Map<String,Object> t = entry(out, "t");
        assertFalse(t.containsKey("error"), t.toString());
        assertFalse(t.containsKey("paramsIgnored"),
                "a server-declared default must not be reported as caller input: " + t);
        ArgumentCaptor<Object[]> binds = ArgumentCaptor.forClass(Object[].class);
        verify(jdbc).queryForList(anyString(), binds.capture());
        List<Object> bound = Arrays.asList(binds.getValue());
        assertTrue(bound.contains("WATER"), bound.toString());
        assertFalse(bound.contains("POLICE_MISCONDUCT"), bound.toString());
    }

    @Test
    public void authenticatedCallersKeepTheEmployeeParamSemantics() {
        publishPublicDef("cl_water", "{\"grain\":\"facts\",\"filters\":{\"service_code\":\"WATER\"}," +
                "\"measures\":[{\"name\":\"total\",\"agg\":\"count\"}]}");
        org.egov.common.contract.request.RequestInfo ri = new org.egov.common.contract.request.RequestInfo();
        org.egov.common.contract.request.User u = new org.egov.common.contract.request.User();
        org.egov.common.contract.request.Role r = new org.egov.common.contract.request.Role();
        r.setCode("SUPERVISOR");
        u.setRoles(Collections.singletonList(r));
        u.setTenantId("ke");
        ri.setUserInfo(u);
        AnalyticsRowScopeResolver resolver = mock(AnalyticsRowScopeResolver.class);
        when(resolver.resolve(eq(ri), eq("ke"), eq(1)))
                .thenReturn(new org.egov.pgr.policy.PgrSearchScope("ke", true, null, null, null));
        AnalyticsService authed = new AnalyticsService(planner, catalog, jdbc, kpiCatalogService, resolver,
                new KpiQueryComposer(catalog), new AnalyticsMetrics(), null);

        Map<String,Object> out = authed.query(json("{\"queries\":{\"t\":{\"kpiId\":\"cl_water\"," +
                "\"params\":{\"serviceCode\":\"ROADS\"}}}}"), ri,
                AnalyticsCapabilityFixtures.full(), "ke", 1);

        // Unchanged pre-#1797 behaviour for employees: the filter bar replaces the baked eq.
        assertFalse(entry(out, "t").containsKey("paramsIgnored"));
        ArgumentCaptor<Object[]> binds = ArgumentCaptor.forClass(Object[].class);
        verify(jdbc).queryForList(anyString(), binds.capture());
        assertTrue(Arrays.asList(binds.getValue()).contains("ROADS"));
    }
}
