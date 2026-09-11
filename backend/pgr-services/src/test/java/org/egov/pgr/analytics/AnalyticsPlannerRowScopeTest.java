package org.egov.pgr.analytics;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.egov.pgr.policy.PgrSearchScope;
import org.junit.jupiter.api.Test;

import java.time.ZoneId;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * How the policy-resolved scope reaches SQL. Each axis is a predicate the caller cannot influence,
 * and every value is bound rather than concatenated.
 */
class AnalyticsPlannerRowScopeTest {

    private final AnalyticsPlanner planner = new AnalyticsPlanner(new AnalyticsCatalog());
    private final BusinessCalendar calendar =
            BusinessCalendar.of(ZoneId.of("Africa/Nairobi"), 1_700_000_000_000L);

    private AnalyticsPlanner.Planned plan(PgrSearchScope scope, String grain) {
        return planner.plan(json("{\"grain\":\"" + grain + "\","
                + "\"measures\":[{\"name\":\"total\",\"agg\":\"count\"}]}"), scope, calendar);
    }

    @Test
    void departmentAndJurisdictionRestrictTogetherNotEitherOr() {
        AnalyticsPlanner.Planned p = plan(new PgrSearchScope("ke.bomet", false, null,
                List.of("DEPT_A"), List.of("WARD_5")), "facts");

        assertTrue(p.sql.contains("department_code IN (?)"), p.sql);
        assertTrue(p.sql.contains("unnest(string_to_array(boundary_path, '|'))"), p.sql);
        assertFalse(p.sql.contains(" OR department_code"), p.sql);
        assertTrue(p.params.containsAll(List.of("DEPT_A", "WARD_5")), p.params.toString());
    }

    @Test
    void jurisdictionMatchesWholePathSegmentsSoOneWardCannotSwallowAnother() {
        // boundary_path is '|'-joined, so WARD_1 must not reach WARD_10. Segment equality, never a
        // prefix LIKE and never a substring test — this is the analytics-side equivalent of the
        // exact locality match PGR search applies.
        AnalyticsPlanner.Planned p = plan(new PgrSearchScope("ke", true, null, null,
                List.of("WARD_1")), "facts");

        assertTrue(p.sql.contains(
                "EXISTS (SELECT 1 FROM unnest(string_to_array(boundary_path, '|')) AS seg WHERE seg IN (?))"), p.sql);
        assertFalse(p.sql.contains("boundary_path LIKE"), p.sql);
        assertTrue(p.params.contains("WARD_1"));
    }

    @Test
    void aSubtreeTenantMatchesItselfAndWhatIsBeneathItButNotASibling() {
        AnalyticsPlanner.Planned p = plan(new PgrSearchScope("ke", true, null, null, null), "facts");

        assertTrue(p.sql.contains("(tenant_id = ? OR tenant_id LIKE ?)"), p.sql);
        assertTrue(p.params.containsAll(List.of("ke", "ke.%")), p.params.toString());
        assertFalse(p.params.contains("ke%"), "a bare prefix would also match the tenant `kenya`");
    }

    @Test
    void aCitizenSeesOnlyTheirOwnRecords() {
        AnalyticsPlanner.Planned p = plan(new PgrSearchScope("ke.bomet", false, "citizen-1", null, null), "facts");

        assertTrue(p.sql.contains("account_id = ?"), p.sql);
        assertTrue(p.params.contains("citizen-1"));
    }

    @Test
    void anAxisRestrictedToNothingSelectsNothingRatherThanEverything() {
        // The engine's deny-all sentinel arrives as a non-empty list, but an empty one must not be
        // read as "unrestricted" if that ever changes upstream.
        assertTrue(plan(new PgrSearchScope("ke.bomet", false, null, List.of(), null), "facts").sql
                .contains("1 = 0"));
        assertTrue(plan(new PgrSearchScope("ke.bomet", false, null, null, List.of()), "facts").sql
                .contains("1 = 0"));
    }

    @Test
    void everyScopeValueIsBoundNeverConcatenatedIntoTheSql() {
        AnalyticsPlanner.Planned p = plan(new PgrSearchScope("ke.bomet", false, "citizen-1",
                List.of("DEPT_A"), List.of("WARD_5")), "facts");

        assertFalse(p.sql.contains("citizen-1"), p.sql);
        assertFalse(p.sql.contains("DEPT_A"), p.sql);
        assertFalse(p.sql.contains("WARD_5"), p.sql);
        assertTrue(p.params.containsAll(List.of("citizen-1", "DEPT_A", "WARD_5")));
    }

    @Test
    void everyGrainCanEnforceEveryAxis() {
        // A grain missing one of these columns has its predicate refused rather than dropped — the
        // events grain once returned other departments' rows exactly that way. Asserted per grain
        // so a NEW grain that forgets a column fails here instead of in production.
        PgrSearchScope everyAxis = new PgrSearchScope("ke.bomet", false, "citizen-1",
                List.of("DEPT_A"), List.of("WARD_5"));

        for (String grain : List.of("facts", "events", "daily")) {
            AnalyticsPlanner.Planned p = plan(everyAxis, grain);
            assertTrue(p.params.containsAll(List.of("citizen-1", "DEPT_A", "WARD_5")), grain + ": " + p.params);
        }
    }

    @Test
    void anUnrestrictedScopeAddsOnlyTheTenantPredicate() {
        AnalyticsPlanner.Planned p = plan(new PgrSearchScope("ke.bomet", false, null, null, null), "facts");

        assertTrue(p.sql.contains("tenant_id = ?"), p.sql);
        assertFalse(p.sql.contains("department_code IN"), p.sql);
        assertFalse(p.sql.contains("boundary_path"), p.sql);
        assertFalse(p.sql.contains("account_id"), p.sql);
    }

    private static JsonNode json(String raw) {
        try {
            return new ObjectMapper().readTree(raw);
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
    }
}
