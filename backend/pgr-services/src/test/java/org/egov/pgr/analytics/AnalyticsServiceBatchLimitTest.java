package org.egov.pgr.analytics;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

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

        PrincipalScopeResolver scopeResolver = mock(PrincipalScopeResolver.class);
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        AnalyticsService service = new AnalyticsService(
                null, null, jdbc, null, scopeResolver, null, new AnalyticsMetrics(), null);

        IllegalArgumentException error = assertThrows(IllegalArgumentException.class,
                () -> service.query(body, null, "ke", 1));

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
}
