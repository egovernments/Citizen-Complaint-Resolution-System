package org.egov.pgr.analytics;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/** Tenant-prefix scope must treat LIKE metacharacters as literal tenant-id characters. */
public class AnalyticsPlannerTenantScopeTest {

    @Test
    public void stateTenantLikePrefixEscapesMetacharacters() throws Exception {
        JsonNode query = new ObjectMapper().readTree(
                "{\"grain\":\"facts\",\"measures\":[{\"name\":\"total\",\"agg\":\"count\"}]}");
        AnalyticsScope scope = new AnalyticsScope("ke%_root", true, null, null, null);

        BusinessCalendar calendar = BusinessCalendar.of(
                java.time.ZoneId.of("Africa/Nairobi"), 1_700_000_000_000L);
        AnalyticsPlanner.Planned planned = new AnalyticsPlanner(new AnalyticsCatalog())
                .plan(query, scope, calendar);

        assertTrue(planned.sql.contains("tenant_id LIKE ?"), planned.sql);
        assertEquals("ke\\%\\_root%", planned.params.get(planned.params.size() - 1));
        assertEquals("ke\\\\root", AnalyticsPlanner.escapeLikeLiteral("ke\\root"));
    }
}
