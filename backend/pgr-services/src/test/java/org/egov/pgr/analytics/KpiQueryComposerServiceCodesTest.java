package org.egov.pgr.analytics;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.egov.pgr.policy.PgrSearchScope;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Pins the {@code serviceCodes} param (#637): an interior complaint-type selection sent as its leaf codes, for
 * categories whose {@code complaint_node_path} is NULL (a dotted code such as
 * {@code complaints.categories.NoStreetlight} in the chain) so {@code complaintPath} would empty every tile.
 * {@code service_code IN (...)} on every grain (daily too), validated, size-capped, intersected with a def's own
 * IN list and ANDed with its eq, and accepted on the public floor as the one list param.
 */
public class KpiQueryComposerServiceCodesTest {

    private final ObjectMapper om = new ObjectMapper();
    private final AnalyticsCatalog catalog = new AnalyticsCatalog();
    private final KpiQueryComposer composer = new KpiQueryComposer(catalog);
    private final AnalyticsPlanner planner = new AnalyticsPlanner(catalog);
    private final PgrSearchScope stateScope = new PgrSearchScope("ke", true, null, null, null);
    private final BusinessCalendar calendar =
            BusinessCalendar.of(java.time.ZoneId.of("Africa/Nairobi"), 1_700_000_000_000L);

    private JsonNode json(String s) {
        try { return om.readTree(s); } catch (Exception e) { throw new RuntimeException(e); }
    }

    private JsonNode factsBase(String filters) {
        return json("{\"grain\":\"facts\",\"window\":{\"name\":\"last_30d\",\"timeRole\":\"filed_at\"},"
                + "\"dimensions\":[\"service_code\"],\"measures\":[{\"name\":\"total\",\"agg\":\"count\"}]"
                + (filters == null ? "" : ",\"filters\":" + filters) + "}");
    }

    @Test
    public void factsGrainNarrowsToTheLeafCodes() {
        JsonNode merged = composer.mergeParams(factsBase(null),
                json("{\"serviceCodes\":[\"StreetLightNotWorking\",\"complaints.categories.NoStreetlight\"]}"), calendar);
        AnalyticsPlanner.Planned p = planner.plan(merged, stateScope, calendar);
        assertTrue(p.sql.contains("service_code IN (?,?)"), p.sql);
        assertFalse(p.sql.contains("complaint_node_path"), p.sql);
        assertEquals("StreetLightNotWorking", p.params.get(0));
        assertEquals("complaints.categories.NoStreetlight", p.params.get(1));
    }

    @Test
    public void dailyGrainAppliesItTooAndReportsNothing() {
        JsonNode base = json("{\"grain\":\"daily\",\"dimensions\":[\"service_code\"],"
                + "\"measures\":[{\"name\":\"open\",\"agg\":\"count\"}]}");
        List<String> ignored = new ArrayList<>();
        JsonNode merged = composer.mergeParams(base, json("{\"serviceCodes\":[\"A\",\"B\"]}"), ignored, calendar);
        AnalyticsPlanner.Planned p = planner.plan(merged, stateScope, calendar);
        assertTrue(p.sql.contains("service_code IN (?,?)"), p.sql);
        assertTrue(ignored.isEmpty(), ignored.toString());
    }

    @Test
    public void malformedValuesAreInvalidParam() {
        for (String bad : new String[]{"\"A\"", "[]", "[1]", "[\"A B\"]", "[\"x'; drop\"]", "{\"a\":1}"}) {
            IllegalArgumentException e = assertThrows(IllegalArgumentException.class,
                    () -> composer.mergeParams(factsBase(null), json("{\"serviceCodes\":" + bad + "}"), calendar), bad);
            assertTrue(e.getMessage().startsWith("invalid_param: serviceCodes"), e.getMessage());
        }
        StringBuilder many = new StringBuilder("[");
        for (int i = 0; i <= KpiQueryComposer.MAX_SERVICE_CODES; i++) many.append(i == 0 ? "" : ",").append("\"C").append(i).append('"');
        assertThrows(IllegalArgumentException.class,
                () -> composer.mergeParams(factsBase(null), json("{\"serviceCodes\":" + many + "]}"), calendar));
    }

    @Test
    public void aBakedInListIsIntersectedNeverReplaced() {
        JsonNode merged = composer.mergeParams(factsBase("{\"service_code\":{\"in\":[\"A\",\"B\"]}}"),
                json("{\"serviceCodes\":[\"B\",\"C\"]}"), calendar);
        assertEquals(json("[\"B\"]"), merged.get("filters").get("service_code").get("in"));

        JsonNode disjoint = composer.mergeParams(factsBase("{\"service_code\":{\"in\":[\"A\"]}}"),
                json("{\"serviceCodes\":[\"C\"]}"), calendar);
        assertEquals(json("[\"\"]"), disjoint.get("filters").get("service_code").get("in"));
    }

    @Test
    public void aBakedEqStaysAndIsAnded() {
        JsonNode merged = composer.mergeParams(factsBase("{\"service_code\":{\"eq\":\"A\"}}"),
                json("{\"serviceCodes\":[\"A\",\"C\"]}"), calendar);
        AnalyticsPlanner.Planned p = planner.plan(merged, stateScope, calendar);
        assertTrue(p.sql.contains("service_code = ?") && p.sql.contains("service_code IN (?,?)"), p.sql);
    }

    @Test
    public void publicFloorAcceptsItAsTheOneListParam() {
        JsonNode clean = AnalyticsService.sanitizePublicParams(json("{\"serviceCodes\":[\" A \",\"B\"],\"ward\":\"W1\"}"));
        assertEquals(json("{\"serviceCodes\":[\"A\",\"B\"],\"ward\":\"W1\"}"), clean);
        for (String bad : new String[]{"\"A\"", "[]", "[\"\"]", "[{\"x\":1}]"})
            assertThrows(IllegalArgumentException.class,
                    () -> AnalyticsService.sanitizePublicParams(json("{\"serviceCodes\":" + bad + "}")), bad);
        // every other public param stays scalar-only
        assertThrows(IllegalArgumentException.class,
                () -> AnalyticsService.sanitizePublicParams(json("{\"serviceCode\":[\"A\"]}")));
    }
}
