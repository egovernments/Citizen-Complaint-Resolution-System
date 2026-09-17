package org.egov.pgr.analytics;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;

import java.time.ZoneId;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/** Contract tests for #1455 dashboard multi-select and department narrowing params. */
public class KpiQueryComposerMultiValueFilterTest {

    private final ObjectMapper om = new ObjectMapper();
    private final AnalyticsCatalog catalog = new AnalyticsCatalog();
    private final KpiQueryComposer composer = new KpiQueryComposer(catalog);
    private final AnalyticsPlanner planner = new AnalyticsPlanner(catalog);
    private final BusinessCalendar calendar =
            BusinessCalendar.of(ZoneId.of("Africa/Nairobi"), 1_700_000_000_000L);

    private JsonNode json(String source) {
        try { return om.readTree(source); } catch (Exception e) { throw new RuntimeException(e); }
    }

    private JsonNode factsBase() {
        return json("{\"grain\":\"facts\",\"dimensions\":[\"service_code\"],"
                + "\"measures\":[{\"name\":\"n\",\"agg\":\"count\"}]}");
    }

    @Test
    public void pluralParamsBecomeInFiltersAndBoundSqlValues() {
        JsonNode merged = composer.mergeParams(factsBase(), json("{"
                + "\"wards\":[\"WARD_A\",\"WARD_B\"],"
                + "\"serviceCodes\":[\"TYPE_A\",\"TYPE_B\"],"
                + "\"departments\":[\"DEPT_A\",\"DEPT_B\"]}"), calendar);

        assertEquals(json("[\"WARD_A\",\"WARD_B\"]"),
                merged.path("filters").path("ward_code").path("in"));
        assertEquals(json("[\"TYPE_A\",\"TYPE_B\"]"),
                merged.path("filters").path("service_code").path("in"));
        assertEquals(json("[\"DEPT_A\",\"DEPT_B\"]"),
                merged.path("filters").path("department_code").path("in"));

        AnalyticsPlanner.Planned planned = planner.plan(merged,
                new AnalyticsScope("ke", true, null, null, null), calendar);
        assertTrue(planned.sql.contains("ward_code IN (?,?)"), planned.sql);
        assertTrue(planned.sql.contains("service_code IN (?,?)"), planned.sql);
        assertTrue(planned.sql.contains("department_code IN (?,?)"), planned.sql);
        assertTrue(planned.params.containsAll(List.of(
                "WARD_A", "WARD_B", "TYPE_A", "TYPE_B", "DEPT_A", "DEPT_B")));
    }

    @Test
    public void pluralFiltersApplyOnDailyGrain() {
        JsonNode daily = json("{\"grain\":\"daily\",\"dimensions\":[\"snapshot_date\"],"
                + "\"measures\":[{\"name\":\"n\",\"agg\":\"count\"}]}");
        JsonNode merged = composer.mergeParams(daily,
                json("{\"wards\":[\"W1\"],\"serviceCodes\":[\"S1\"],\"departments\":[\"D1\"]}"),
                calendar);
        AnalyticsPlanner.Planned planned = planner.plan(merged,
                new AnalyticsScope("ke", true, null, null, null), calendar);
        assertTrue(planned.sql.contains("ward_code IN (?)"), planned.sql);
        assertTrue(planned.sql.contains("service_code IN (?)"), planned.sql);
        assertTrue(planned.sql.contains("department_code IN (?)"), planned.sql);
    }

    @Test
    public void duplicatesAreRemovedWithoutChangingSelectionOrder() {
        JsonNode merged = composer.mergeParams(factsBase(),
                json("{\"wards\":[\" W2 \",\"W1\",\"W2\"]}"), calendar);
        assertEquals(json("[\"W2\",\"W1\"]"),
                merged.path("filters").path("ward_code").path("in"));
    }

    @Test
    public void explicitDepartmentSelectionIntersectsServerResolvedAbacScope() {
        JsonNode merged = composer.mergeParams(factsBase(),
                json("{\"departments\":[\"DEPT_A\",\"DEPT_OUTSIDE\"]}"), calendar);
        AnalyticsScope constrained = new AnalyticsScope(
                "ke", true, null, null, List.of("DEPT_A"));
        AnalyticsPlanner.Planned planned = planner.plan(merged, constrained, calendar);

        assertTrue(planned.sql.contains("department_code IN (?,?)"), planned.sql);
        assertTrue(planned.sql.contains("department_code IN (?)"), planned.sql);
        assertEquals(2, planned.params.stream().filter("DEPT_A"::equals).count(), planned.params.toString());
        assertTrue(planned.params.contains("DEPT_OUTSIDE"));
    }

    @Test
    public void legacyScalarParamsRemainExactEqualityFilters() {
        JsonNode merged = composer.mergeParams(factsBase(),
                json("{\"ward\":\"W1\",\"serviceCode\":\"S1\"}"), calendar);
        assertEquals("W1", merged.path("filters").path("ward_code").path("eq").asText());
        assertEquals("S1", merged.path("filters").path("service_code").path("eq").asText());
    }

    @Test
    public void scalarAndPluralAliasesCannotBeMixed() {
        IllegalArgumentException ward = assertThrows(IllegalArgumentException.class,
                () -> composer.mergeParams(factsBase(),
                        json("{\"ward\":\"W1\",\"wards\":[\"W2\"]}"), calendar));
        assertTrue(ward.getMessage().contains("either ward or wards"), ward.getMessage());

        IllegalArgumentException service = assertThrows(IllegalArgumentException.class,
                () -> composer.mergeParams(factsBase(),
                        json("{\"serviceCode\":\"S1\",\"serviceCodes\":[\"S2\"]}"), calendar));
        assertTrue(service.getMessage().contains("either serviceCode or serviceCodes"), service.getMessage());
    }

    @Test
    public void malformedOrEmptyPluralParamsAreRejectedRatherThanUnfiltered() {
        for (JsonNode params : List.of(
                json("{\"wards\":[]}"),
                json("{\"wards\":\"W1\"}"),
                json("{\"wards\":[1]}"),
                json("{\"wards\":[\"\"]}"),
                json("{\"wards\":[\"   \"]}"),
                json("{\"wards\":[\"all\"]}"))) {
            IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
                    () -> composer.mergeParams(factsBase(), params, calendar));
            assertTrue(ex.getMessage().startsWith("invalid_param"), ex.getMessage());
        }
    }

    @Test
    public void pluralParamCardinalityAndValueLengthAreBounded() {
        ObjectNode tooMany = om.createObjectNode();
        ArrayNode many = tooMany.putArray("serviceCodes");
        for (int i = 0; i <= KpiQueryComposer.MAX_MULTI_FILTER_VALUES; i++) many.add("S" + i);
        assertThrows(IllegalArgumentException.class,
                () -> composer.mergeParams(factsBase(), tooMany, calendar));

        ObjectNode tooLong = om.createObjectNode();
        tooLong.putArray("departments").add("D".repeat(KpiQueryComposer.MAX_MULTI_FILTER_VALUE_LENGTH + 1));
        assertThrows(IllegalArgumentException.class,
                () -> composer.mergeParams(factsBase(), tooLong, calendar));
    }
}
