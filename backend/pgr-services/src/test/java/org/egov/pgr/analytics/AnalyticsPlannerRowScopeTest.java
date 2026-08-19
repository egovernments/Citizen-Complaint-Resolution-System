package org.egov.pgr.analytics;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.egov.pgr.accesscontrol.PgrRowScope;
import org.junit.jupiter.api.Test;

import java.time.ZoneId;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * How the PDP's row scope reaches SQL. Each axis is a predicate the caller cannot influence, and
 * each one that cannot be expressed on the target grain stops the query instead of being dropped.
 */
class AnalyticsPlannerRowScopeTest {

    private final AnalyticsPlanner planner = new AnalyticsPlanner(new AnalyticsCatalog());
    private final BusinessCalendar calendar =
            BusinessCalendar.of(ZoneId.of("Africa/Nairobi"), 1_700_000_000_000L);

    private AnalyticsPlanner.Planned plan(PgrRowScope scope, String grain) {
        return planner.plan(json("{\"grain\":\"" + grain + "\","
                + "\"measures\":[{\"name\":\"total\",\"agg\":\"count\"}]}"), scope, calendar);
    }

    @Test
    void departmentAndJurisdictionRestrictTogetherNotEitherOr() {
        // Both axes narrow: an employee scoped to one department AND one ward sees the rows in the
        // intersection, never the union of the two.
        AnalyticsPlanner.Planned p = plan(new PgrRowScope("ke.bomet", false, List.of(),
                List.of("DEPT_A"), List.of("WARD_5")), "facts");

        assertThat(p.sql).contains("department_code IN (?)");
        assertThat(p.sql).contains("unnest(string_to_array(boundary_path, '|'))");
        assertThat(p.sql).doesNotContain(" OR department_code");
        assertThat(p.params).contains("DEPT_A", "WARD_5");
    }

    @Test
    void jurisdictionMatchesWholePathSegmentsSoOneWardCannotSwallowAnother() {
        // boundary_path is '|'-joined, so WARD_1 must not reach WARD_10. Segment equality, never a
        // prefix LIKE and never a substring test.
        AnalyticsPlanner.Planned p = plan(new PgrRowScope("ke", true, List.of(), null,
                List.of("WARD_1")), "facts");

        assertThat(p.sql).contains("EXISTS (SELECT 1 FROM unnest(string_to_array(boundary_path, '|')) AS seg WHERE seg IN (?))");
        assertThat(p.sql).doesNotContain("boundary_path LIKE");
        assertThat(p.params).contains("WARD_1");
    }

    @Test
    void aSubtreeTenantMatchesItselfAndWhatIsBeneathItButNotASibling() {
        AnalyticsPlanner.Planned p = plan(new PgrRowScope("ke", true, List.of(), null, null), "facts");

        assertThat(p.sql).contains("(tenant_id = ? OR tenant_id LIKE ?)");
        assertThat(p.params).contains("ke", "ke.%");
        assertThat(p.params).doesNotContain("ke%");
    }

    @Test
    void anExactTenantMatchIsPlainEquality() {
        AnalyticsPlanner.Planned p = plan(new PgrRowScope("ke.bomet", false, List.of(), null, null), "facts");

        assertThat(p.sql).contains("tenant_id = ?");
        assertThat(p.sql).doesNotContain("LIKE");
    }

    @Test
    void aCitizenSeesOnlyTheirOwnRecords() {
        AnalyticsPlanner.Planned p = plan(new PgrRowScope("ke.bomet", false, List.of("citizen-1"),
                null, null), "facts");

        assertThat(p.sql).contains("account_id IN (?)");
        assertThat(p.params).contains("citizen-1");
    }

    @Test
    void anAxisRestrictedToNothingSelectsNothingRatherThanEverything() {
        // An empty VALUES list is "you may see none of them". Dropping the predicate because the
        // list is empty would turn the most restrictive scope there is into no scope at all.
        assertThat(plan(new PgrRowScope("ke.bomet", false, List.of(), List.of(), null), "facts").sql)
                .contains("1 = 0");
        assertThat(plan(new PgrRowScope("ke.bomet", false, List.of(), null, List.of()), "facts").sql)
                .contains("1 = 0");
    }

    @Test
    void everyScopeValueIsBoundNeverConcatenatedIntoTheSql() {
        AnalyticsPlanner.Planned p = plan(new PgrRowScope("ke.bomet", false, List.of("citizen-1"),
                List.of("DEPT_A"), List.of("WARD_5")), "facts");

        assertThat(p.sql).doesNotContain("citizen-1").doesNotContain("DEPT_A").doesNotContain("WARD_5");
        assertThat(p.params).contains("citizen-1", "DEPT_A", "WARD_5");
    }

    @Test
    void everyGrainCanEnforceEveryAxis() {
        // A grain missing one of these columns would have its predicate silently dropped if
        // applyScope did not refuse — which is how a department-scoped caller once read every
        // department's rows off the events grain. Asserted per grain so a NEW grain that forgets a
        // column fails here rather than in production.
        PgrRowScope everyAxis = new PgrRowScope("ke.bomet", false, List.of("citizen-1"),
                List.of("DEPT_A"), List.of("WARD_5"));

        for (String grain : List.of("facts", "events", "daily")) {
            AnalyticsPlanner.Planned p = plan(everyAxis, grain);
            assertThat(p.params).as(grain).contains("citizen-1", "DEPT_A", "WARD_5");
        }
    }

    private static JsonNode json(String raw) {
        try {
            return new ObjectMapper().readTree(raw);
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }
}
