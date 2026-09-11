package org.egov.pgr.analytics;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.egov.pgr.analytics.model.DashboardPack;
import org.egov.pgr.config.PGRConfiguration;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.http.ResponseEntity;

import java.util.*;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Pins the /packs recordCount authorization gate: recordCount is live tenant data
 * (complaint_facts corpus size) and must take the same coarse pack-match gate as
 * packId/persona. Without it, an anonymous caller (degraded to the PUBLIC floor)
 * could POST arbitrary tenantIds and enumerate every tenant's complaint volume
 * even when every sibling field correctly collapses to null/empty.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
public class AnalyticsControllerPacksTest {

    @Mock private AnalyticsService service;
    @Mock private KpiCatalogService kpiCatalogService;
    @Mock private PGRConfiguration config;
    @Mock private AnalyticsCapabilityService capabilityService;

    private AnalyticsController controller;

    @BeforeEach
    public void setUp() {
        controller = new AnalyticsController(service, kpiCatalogService, capabilityService,
                new ObjectMapper(), config);
        when(capabilityService.resolve(any(), anyString())).thenReturn(AnalyticsCapabilityFixtures.full());
        when(config.getStateLevelTenantIdLength()).thenReturn(1);
    }

    @Test
    public void noMatchingPackReturnsNullRecordCountAndNeverCounts() {
        // a caller holding the packs capability, on a tenant that has authored no pack for it
        when(kpiCatalogService.getVisibleDefs(eq("ke.othercity"), any())).thenReturn(Collections.emptyList());
        when(kpiCatalogService.getBestPack(eq("ke.othercity"), any(), any())).thenReturn(Optional.empty());

        Map<String,Object> body = new HashMap<>();
        body.put("tenantId", "ke.othercity");
        ResponseEntity<Map<String,Object>> resp = controller.getPacks(body);

        assertEquals(200, resp.getStatusCodeValue());
        assertNull(resp.getBody().get("recordCount"),
                "recordCount must not leak to a caller no pack matched for");
        // the count query (and its cache) must not even run for unmatched callers
        verify(service, never()).recordCount(anyString(), anyInt());
    }

    @Test
    public void matchingPackStillGetsTheTenantCorpusCount() {
        DashboardPack pack = new DashboardPack();
        pack.setId("supervisor-pack");
        pack.setRequiredActionUrl(AnalyticsCapabilities.QUERY);
        pack.setTiles(Collections.emptyList());
        when(kpiCatalogService.getVisibleDefs(eq("ke.bomet"), any())).thenReturn(Collections.emptyList());
        when(kpiCatalogService.getBestPack(eq("ke.bomet"), any(), any())).thenReturn(Optional.of(pack));
        when(service.recordCount("ke.bomet", 1)).thenReturn(1234L);

        Map<String,Object> body = new HashMap<>();
        body.put("tenantId", "ke.bomet");
        ResponseEntity<Map<String,Object>> resp = controller.getPacks(body);

        assertEquals(200, resp.getStatusCodeValue());
        assertEquals(1234L, resp.getBody().get("recordCount"));
        assertEquals("supervisor-pack", resp.getBody().get("packId"));
        // persona is an OTEL tag: the capability that selected the pack, short name not full URL.
        assertEquals("_query", resp.getBody().get("persona"));
        assertEquals(AnalyticsService.MAX_BATCH_QUERIES, resp.getBody().get("maxBatchQueries"));
    }
}
