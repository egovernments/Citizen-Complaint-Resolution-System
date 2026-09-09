package org.egov.pgr.analytics;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/** Pins the request budget before scope resolution or SQL execution. */
public class AnalyticsServiceBatchLimitTest {

    @Test
    public void oversizedBatchIsRejectedBeforeScopeOrDatabaseWork() {
        ObjectMapper mapper = new ObjectMapper();
        ObjectNode body = mapper.createObjectNode();
        ObjectNode queries = body.putObject("queries");
        for (int i = 0; i <= AnalyticsService.MAX_BATCH_QUERIES; i++)
            queries.putObject("q" + i).put("kpiId", "cl_test");

        AnalyticsRowScopeResolver scopeResolver = mock(AnalyticsRowScopeResolver.class);
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        AnalyticsService service = new AnalyticsService(
                null, null, jdbc, null, scopeResolver, null, new AnalyticsMetrics(), null);

        IllegalArgumentException error = assertThrows(IllegalArgumentException.class,
                () -> service.query(body, null, AnalyticsCapabilityFixtures.full(), "ke", 1));

        assertTrue(error.getMessage().startsWith("invalid_param"), error.getMessage());
        assertTrue(error.getMessage().contains(String.valueOf(AnalyticsService.MAX_BATCH_QUERIES)));
        verifyNoInteractions(scopeResolver, jdbc);
    }

    @Test
    public void batchAtTheLimitPassesValidation() {
        ObjectMapper mapper = new ObjectMapper();
        ObjectNode queries = mapper.createObjectNode();
        for (int i = 0; i < AnalyticsService.MAX_BATCH_QUERIES; i++)
            queries.putObject("q" + i).put("kpiId", "cl_test");

        assertDoesNotThrow(() -> AnalyticsService.validateBatchSize(queries));
    }

    @Test
    public void theAnonymousSurfaceNeverAsksTheAbacEngineForAScope() {
        // The public dashboard has no identity, so there is no role-scoped action lookup to make.
        // Sending it down the policy path fails the request outright — the engine refuses rather
        // than guessing for a caller with no roles — which would 503 every /public/_query call.
        AnalyticsRowScopeResolver scopeResolver = mock(AnalyticsRowScopeResolver.class);
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        AnalyticsPlanner planner = mock(AnalyticsPlanner.class);
        KpiCatalogService catalog = mock(KpiCatalogService.class);
        when(catalog.resolveTimeZone(anyString())).thenReturn(java.time.ZoneId.of("Africa/Nairobi"));
        when(planner.plan(any(), any(), any()))
                .thenReturn(new AnalyticsPlanner.Planned("SELECT 1", java.util.List.of(),
                        java.util.List.of("total"), "facts"));
        when(jdbc.queryForList(anyString(), any(Object[].class))).thenReturn(java.util.List.of());

        AnalyticsService service = new AnalyticsService(planner, null, jdbc, catalog, scopeResolver,
                null, new AnalyticsMetrics(), null);

        ObjectMapper mapper = new ObjectMapper();
        ObjectNode body = mapper.createObjectNode();
        body.put("tenantId", "ke");
        body.putObject("queries").putObject("tile").put("kpiId", "cl_public");

        service.query(body, null, AnalyticsCapabilities.publicSurface(), "ke", 1);

        verifyNoInteractions(scopeResolver);
    }
}
