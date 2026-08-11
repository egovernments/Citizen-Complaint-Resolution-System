package org.egov.pgr.analytics;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.egov.common.contract.request.RequestInfo;
import org.egov.common.contract.request.Role;
import org.egov.common.contract.request.User;
import org.egov.pgr.analytics.model.KpiDefinition;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.when;

/**
 * Pins the additive batch error contract: legacy inline errors remain under results while the
 * canonical top-level errors index makes every failed entry visible to the dashboard.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
public class AnalyticsServiceBatchErrorContractTest {

    private final ObjectMapper mapper = new ObjectMapper();

    @Mock private AnalyticsPlanner planner;
    @Mock private JdbcTemplate jdbc;
    @Mock private KpiCatalogService kpiCatalogService;
    @Mock private PrincipalScopeResolver scopeResolver;
    @Mock private KpiQueryComposer queryComposer;

    private AnalyticsService service;
    private RequestInfo requestInfo;

    @BeforeEach
    public void setUp() {
        service = new AnalyticsService(planner, null, jdbc, kpiCatalogService, scopeResolver,
                queryComposer, new AnalyticsMetrics(), null);
        requestInfo = RequestInfo.builder()
                .userInfo(User.builder().uuid("employee-1").type("EMPLOYEE")
                        .roles(Collections.singletonList(Role.builder().code("PGR_ADMIN").build()))
                        .build())
                .build();
        when(scopeResolver.resolve(same(requestInfo), eq("ke.bomet"), eq(1)))
                .thenReturn(new AnalyticsScope("ke.bomet", false, null, null, null));
    }

    @Test
    public void mixedBatchKeepsLegacyInlineErrorAndAddsTopLevelIndex() throws Exception {
        AnalyticsPlanner.Planned planned = new AnalyticsPlanner.Planned(
                "SELECT 7", Collections.emptyList(), Collections.singletonList("total"), "facts");
        when(planner.plan(any(JsonNode.class), any(AnalyticsScope.class))).thenReturn(planned);
        when(jdbc.queryForList(eq("SELECT 7"), any(Object[].class)))
                .thenReturn(Collections.singletonList(Map.of("total", 7)));
        when(kpiCatalogService.getDef("missing", "ke.bomet")).thenReturn(Optional.empty());

        Map<String,Object> response = query("{\"queries\":{"
                + "\"ok\":{\"grain\":\"facts\",\"measures\":[{\"name\":\"total\",\"agg\":\"count\"}]},"
                + "\"denied\":{\"kpiId\":\"missing\"}}}");

        Map<String,Object> results = map(response.get("results"));
        Map<String,Object> errors = map(response.get("errors"));
        assertTrue(results.containsKey("ok"));
        assertEquals("kpi_forbidden", map(results.get("denied")).get("error"),
                "legacy inline error must remain during the compatibility period");
        assertEquals(map(results.get("denied")), map(errors.get("denied")));
        assertEquals(Boolean.TRUE, response.get("partial"));
    }

    @Test
    public void caughtEntryExceptionIsIndexedWithoutFailingWholeBatch() throws Exception {
        when(planner.plan(any(JsonNode.class), any(AnalyticsScope.class)))
                .thenThrow(new IllegalArgumentException("invalid_param: bad window"));

        Map<String,Object> response = query("{\"queries\":{"
                + "\"invalid\":{\"grain\":\"facts\",\"measures\":[{\"name\":\"total\",\"agg\":\"count\"}]}}}");

        Map<String,Object> error = map(map(response.get("errors")).get("invalid"));
        assertEquals("invalid_param", error.get("error"));
        assertEquals("invalid_param: bad window", error.get("message"));
        assertEquals(error, map(map(response.get("results")).get("invalid")));
        assertEquals(Boolean.TRUE, response.get("partial"));
    }

    @Test
    public void forbiddenComposedKpiAlsoMarksBatchPartial() throws Exception {
        KpiDefinition hiddenCompose = mapper.readValue("{"
                + "\"id\":\"hidden_compose\",\"status\":\"draft\","
                + "\"viz\":{\"compose\":{\"type\":\"netBacklogDaily\","
                + "\"sourceKpiIds\":[\"source_a\",\"source_b\"]}}}", KpiDefinition.class);
        when(kpiCatalogService.getDef("hidden_compose", "ke.bomet"))
                .thenReturn(Optional.of(hiddenCompose));

        Map<String,Object> response = query(
                "{\"queries\":{\"tile\":{\"kpiId\":\"hidden_compose\"}}}");

        Map<String,Object> resultError = map(map(response.get("results")).get("tile"));
        Map<String,Object> indexedError = map(map(response.get("errors")).get("tile"));
        assertEquals("kpi_forbidden", resultError.get("error"));
        assertEquals(resultError, indexedError);
        assertEquals(Boolean.TRUE, response.get("partial"),
                "the composed-result fast path must not bypass partial/error accounting");
    }

    @Test
    public void successfulBatchHasEmptyErrorIndexAndIsNotPartial() throws Exception {
        AnalyticsPlanner.Planned planned = new AnalyticsPlanner.Planned(
                "SELECT 1", Collections.emptyList(), Collections.singletonList("total"), "facts");
        when(planner.plan(any(JsonNode.class), any(AnalyticsScope.class))).thenReturn(planned);
        when(jdbc.queryForList(eq("SELECT 1"), any(Object[].class)))
                .thenReturn(Collections.singletonList(Map.of("total", 1)));

        Map<String,Object> response = query("{\"queries\":{"
                + "\"ok\":{\"grain\":\"facts\",\"measures\":[{\"name\":\"total\",\"agg\":\"count\"}]}}}");

        assertTrue(map(response.get("errors")).isEmpty());
        assertEquals(Boolean.FALSE, response.get("partial"));
        assertEquals(1, ((List<?>) map(map(response.get("results")).get("ok")).get("rows")).size());
    }

    private Map<String,Object> query(String json) throws Exception {
        return service.query(mapper.readTree(json), requestInfo, "ke.bomet", 1);
    }

    @SuppressWarnings("unchecked")
    private Map<String,Object> map(Object value) {
        return (Map<String,Object>) value;
    }
}
