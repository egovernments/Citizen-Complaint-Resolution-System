package org.egov.pgr.analytics;

import com.fasterxml.jackson.databind.JsonNode;
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
 * The anonymous filter-bar option source (#1797): server-owned distinct queries, anonymous
 * tenant-aggregate scope, codes only on the wire.
 */
public class AnalyticsServicePublicOptionsTest {

    private AnalyticsPlanner planner;
    private JdbcTemplate jdbc;
    private PrincipalScopeResolver scopeResolver;
    private KpiCatalogService kpiCatalogService;
    private AnalyticsService service;

    @BeforeEach
    public void setUp() {
        planner = mock(AnalyticsPlanner.class);
        jdbc = mock(JdbcTemplate.class);
        scopeResolver = mock(PrincipalScopeResolver.class);
        kpiCatalogService = mock(KpiCatalogService.class);
        service = new AnalyticsService(planner, null, jdbc, kpiCatalogService, scopeResolver,
                null, new AnalyticsMetrics(), null);
        when(kpiCatalogService.resolveTimeZone("ke")).thenReturn(ZoneId.of("Africa/Nairobi"));
        when(scopeResolver.resolve(isNull(), eq("ke"), eq(1)))
                .thenReturn(new AnalyticsScope("ke", true, null, null, null));
        when(planner.plan(any(JsonNode.class), any(), any())).thenAnswer(inv -> {
            JsonNode q = inv.getArgument(0);
            String dim = q.get("dimensions").get(0).asText();
            return new AnalyticsPlanner.Planned("SELECT " + dim, new ArrayList<>(),
                    Arrays.asList(dim, "n"), "facts");
        });
    }

    private static Map<String,Object> row(String col, Object code, long n) {
        Map<String,Object> r = new LinkedHashMap<>();
        r.put(col, code);
        r.put("n", n);
        return r;
    }

    @Test
    @SuppressWarnings("unchecked")
    public void runsTheTwoFixedDistinctsUnderAnonymousScopeAndStripsCounts() {
        when(jdbc.queryForList(eq("SELECT ward_code"), any(Object[].class)))
                .thenReturn(Arrays.asList(row("ward_code", "W1", 7), row("ward_code", " ", 1),
                        row("ward_code", null, 2), row("ward_code", "W2", 3)));
        when(jdbc.queryForList(eq("SELECT service_code"), any(Object[].class)))
                .thenReturn(Collections.singletonList(row("service_code", "Pothole", 9)));

        Map<String,Object> out = service.publicFilterOptions("ke", 1, null);

        // Anonymous principal: no RequestInfo ever reaches the resolver.
        verify(scopeResolver).resolve(isNull(), eq("ke"), eq(1));

        // The planned nodes are the server-owned constants, not anything caller-shaped.
        ArgumentCaptor<JsonNode> planned = ArgumentCaptor.forClass(JsonNode.class);
        verify(planner, times(2)).plan(planned.capture(), any(), any());
        for (JsonNode q : planned.getAllValues()) {
            assertEquals("facts", q.get("grain").asText());
            assertEquals("all", q.at("/window/name").asText());
            assertEquals(1, q.get("dimensions").size());
            assertEquals("count", q.at("/measures/0/agg").asText());
        }

        Map<String,Object> results = (Map<String,Object>) out.get("results");
        assertEquals(new HashSet<>(Arrays.asList("wards", "complaintTypes")), results.keySet());
        Map<String,Object> wards = (Map<String,Object>) results.get("wards");
        List<Map<String,Object>> wardRows = (List<Map<String,Object>>) wards.get("rows");
        // Blank / null codes dropped; counts never leave the service.
        assertEquals(Arrays.asList(Map.of("ward_code", "W1"), Map.of("ward_code", "W2")), wardRows);
        assertEquals(Collections.singletonList("ward_code"), wards.get("columns"));
        assertFalse(wards.containsKey("tookMs"));
        Map<String,Object> types = (Map<String,Object>) results.get("complaintTypes");
        assertEquals(Collections.singletonList(Map.of("service_code", "Pothole")), types.get("rows"));
        assertEquals(Boolean.FALSE, out.get("partial"));
        assertTrue(out.containsKey("calendar"));
    }

    @Test
    @SuppressWarnings("unchecked")
    public void oneFailingDistinctLeavesTheOtherUsable() {
        when(jdbc.queryForList(eq("SELECT ward_code"), any(Object[].class)))
                .thenThrow(new RuntimeException("boom: relation complaint_facts does not exist"));
        when(jdbc.queryForList(eq("SELECT service_code"), any(Object[].class)))
                .thenReturn(Collections.singletonList(row("service_code", "Pothole", 9)));

        Map<String,Object> out = service.publicFilterOptions("ke", 1, null);

        Map<String,Object> results = (Map<String,Object>) out.get("results");
        assertEquals(Boolean.TRUE, out.get("partial"));
        // Anonymous envelope never carries the driver/SQL detail.
        assertEquals(Map.of("error", "query_failed", "message", "filter options are unavailable"),
                results.get("wards"));
        assertFalse(results.toString().contains("boom"));
        assertEquals(Collections.singletonList(Map.of("service_code", "Pothole")),
                ((Map<String,Object>) results.get("complaintTypes")).get("rows"));
    }

    @Test
    public void missingTenantIsRejectedBeforeAnyWork() {
        assertThrows(IllegalArgumentException.class, () -> service.publicFilterOptions("", 1, null));
        verifyNoInteractions(scopeResolver, jdbc, planner);
    }
}
