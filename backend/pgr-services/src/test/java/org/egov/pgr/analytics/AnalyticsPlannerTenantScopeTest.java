package org.egov.pgr.analytics;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.egov.pgr.policy.PgrSearchScope;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/** The subtree tenant predicate must not reach a sibling tenant, whatever the id contains. */
public class AnalyticsPlannerTenantScopeTest {

    @Test
    public void stateTenantLikePrefixEscapesMetacharacters() throws Exception {
        JsonNode query = new ObjectMapper().readTree(
                "{\"grain\":\"facts\",\"measures\":[{\"name\":\"total\",\"agg\":\"count\"}]}");
        PgrSearchScope scope = new PgrSearchScope("ke%_root", true, null, null, null);

        BusinessCalendar calendar = BusinessCalendar.of(
                java.time.ZoneId.of("Africa/Nairobi"), 1_700_000_000_000L);
        AnalyticsPlanner.Planned planned = new AnalyticsPlanner(new AnalyticsCatalog())
                .plan(query, scope, calendar);

        // The tenant itself OR something strictly beneath it — `ke%_root2` must not match.
        assertTrue(planned.sql.contains("(tenant_id = ? OR tenant_id LIKE ?)"), planned.sql);
        assertEquals("ke\\%\\_root.%", planned.params.get(planned.params.size() - 1));
        assertEquals("ke%_root", planned.params.get(planned.params.size() - 2));
        assertEquals("ke\\\\root", AnalyticsPlanner.escapeLikeLiteral("ke\\root"));
    }
}
