package org.egov.pgr.analytics;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Pins the {@code complaintPath} subtree-filter param — the composer's delimiter-guarded
 * {@code complaint_node_path} {@code subtree} predicate for INTERIOR-node selections, the
 * path-alphabet sanitizer (hard {@code invalid_param}, never silently unfiltered), the
 * daily-grain reported skip ({@code paramsIgnored} collector, unlike {@code ward}'s silent
 * no-op), composition with {@code hierLevel} (WHERE vs GROUP BY — orthogonal), the unchanged
 * exact-eq {@code serviceCode} leaf semantics, and that the server-injected ABAC row-scope is
 * still layered on top (params only narrow).
 */
public class KpiQueryComposerComplaintPathTest {

    private final ObjectMapper om = new ObjectMapper();
    private final AnalyticsCatalog catalog = new AnalyticsCatalog();
    private final KpiQueryComposer composer = new KpiQueryComposer(catalog);
    private final AnalyticsPlanner planner = new AnalyticsPlanner(catalog);
    private final AnalyticsScope stateScope = new AnalyticsScope("ke", true, null, null, null);

    private JsonNode json(String s) {
        try { return om.readTree(s); } catch (Exception e) { throw new RuntimeException(e); }
    }

    /** The seeded complaints-by-type base query (facts, service_code dimension). */
    private JsonNode byTypeBase() {
        return json("{\"grain\":\"facts\",\"window\":{\"name\":\"last_30d\",\"timeRole\":\"filed_at\"},"
                + "\"dimensions\":[\"service_code\"],"
                + "\"measures\":[{\"name\":\"total\",\"agg\":\"count\"}],"
                + "\"sort\":[{\"by\":\"total\",\"dir\":\"desc\"}],\"limit\":8}");
    }

    private JsonNode dailyBase() {
        return json("{\"grain\":\"daily\",\"dimensions\":[\"service_code\"],"
                + "\"measures\":[{\"name\":\"open\",\"agg\":\"count\"}]}");
    }

    // ---- SQL: the delimiter-guarded subtree predicate ----

    @Test
    public void sqlSnapshotForSubtreePredicate() {
        JsonNode merged = composer.mergeParams(byTypeBase(), json("{\"complaintPath\":\"SANITATION\"}"));
        AnalyticsPlanner.Planned p = planner.plan(merged, stateScope);
        assertEquals("SELECT service_code AS service_code, count(*) AS total"
                + " FROM complaint_facts"
                + " WHERE (complaint_node_path = ? OR complaint_node_path LIKE ? || '.%')"
                + " AND created_at >= ? AND created_at < ? AND tenant_id LIKE ?"
                + " GROUP BY 1 ORDER BY total DESC NULLS LAST LIMIT 8", p.sql);
        // eq arm binds the raw path, the LIKE arm the LIKE-escaped path — '.' guard is in the SQL,
        // so 'SANITATION' can never match a 'SANITATIONX.…' sibling.
        assertEquals("SANITATION", p.params.get(0));
        assertEquals("SANITATION", p.params.get(1));
    }

    @Test
    public void eventsGrainAppliesSubtree() {
        JsonNode base = json("{\"grain\":\"events\",\"dimensions\":[\"service_code\"],"
                + "\"measures\":[{\"name\":\"n\",\"agg\":\"count\"}]}");
        JsonNode merged = composer.mergeParams(base, json("{\"complaintPath\":\"SANITATION.SEWAGE\"}"));
        AnalyticsPlanner.Planned p = planner.plan(merged, stateScope);
        assertTrue(p.sql.contains("FROM complaint_events"));
        assertTrue(p.sql.contains("(complaint_node_path = ? OR complaint_node_path LIKE ? || '.%')"));
    }

    @Test
    public void likeMetacharactersInPathAreEscapedInTheLikeArm() {
        // '_' is a legal path character (UPPER_SNAKE codes) but a LIKE metachar — the LIKE arm
        // must receive the escaped literal while the eq arm gets the raw path.
        JsonNode merged = composer.mergeParams(byTypeBase(), json("{\"complaintPath\":\"ROAD_WORKS\"}"));
        AnalyticsPlanner.Planned p = planner.plan(merged, stateScope);
        assertEquals("ROAD_WORKS", p.params.get(0));
        assertEquals("ROAD\\_WORKS", p.params.get(1));
    }

    // ---- sanitizer: path alphabet + length cap ----

    @Test
    public void sqlMeaningfulValuesAreRejected() {
        for (String bad : new String[]{
                "SAN' OR '1'='1", "a b", "x%y", "a;b", "x)--", "a\\b", "path*", "a,b",
                "x||'y", "a\"b", "café", "a\tb"}) {
            IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
                    () -> composer.mergeParams(byTypeBase(), json(om.createObjectNode()
                            .put("complaintPath", bad).toString())),
                    "complaintPath '" + bad + "' must be rejected");
            assertTrue(ex.getMessage().startsWith("invalid_param"), ex.getMessage());
        }
    }

    @Test
    public void overlongPathIsRejected() {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < 60; i++) sb.append("NODE.");
        String tooLong = sb.append("LEAFNODE").toString();   // > 256 chars, alphabet-legal
        assertTrue(tooLong.length() > KpiQueryComposer.MAX_COMPLAINT_PATH_LENGTH);
        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
                () -> composer.mergeParams(byTypeBase(), json("{\"complaintPath\":\"" + tooLong + "\"}")));
        assertTrue(ex.getMessage().startsWith("invalid_param"), ex.getMessage());
    }

    @Test
    public void livePathShapesAreAccepted() {
        for (String ok : new String[]{"SANITATION", "SANITATION.SEWAGE",
                "ROADS-AND-TRANSPORT.POTHOLES_1", "infra/roads.SUB"}) {
            JsonNode merged = composer.mergeParams(byTypeBase(),
                    json("{\"complaintPath\":\"" + ok + "\"}"));
            assertEquals(ok, merged.get("filters").get("complaint_node_path").get("subtree").asText());
        }
    }

    @Test
    public void emptyAndAbsentAreNoOps() {
        assertEquals(byTypeBase(), composer.mergeParams(byTypeBase(), json("{\"complaintPath\":\"\"}")));
        JsonNode merged = composer.mergeParams(byTypeBase(), json("{\"window\":\"last_7d\"}"));
        assertFalse(merged.has("filters"));
    }

    // ---- daily grain: reported skip (NOT ward's silent no-op) ----

    @Test
    public void dailyGrainSkipsFilterAndReportsParamsIgnored() {
        List<String> ignored = new ArrayList<>();
        JsonNode merged = composer.mergeParams(dailyBase(), json("{\"complaintPath\":\"SANITATION\"}"), ignored);
        assertEquals(dailyBase(), merged);                       // no filter injected — daily has no path column
        assertEquals(List.of("complaintPath"), ignored);         // …but the skip is reported to the caller
    }

    @Test
    public void dailyGrainSkipIsIdempotentInTheCollector() {
        // The compose path reuses one collector across several source KPIs — no duplicates.
        List<String> ignored = new ArrayList<>();
        composer.mergeParams(dailyBase(), json("{\"complaintPath\":\"SANITATION\"}"), ignored);
        composer.mergeParams(dailyBase(), json("{\"complaintPath\":\"SANITATION\"}"), ignored);
        assertEquals(List.of("complaintPath"), ignored);
    }

    @Test
    public void wardStaysASilentNoOpAndSanitizerStillRunsOnDaily() {
        // ward has no reporting (unchanged behaviour); only complaintPath lands in the collector.
        List<String> ignored = new ArrayList<>();
        JsonNode eventsBase = json("{\"grain\":\"daily\",\"dimensions\":[\"service_code\"],"
                + "\"measures\":[{\"name\":\"open\",\"agg\":\"count\"}]}");
        composer.mergeParams(eventsBase, json("{\"ward\":\"W1\",\"complaintPath\":\"SANITATION\"}"), ignored);
        assertEquals(List.of("complaintPath"), ignored);
        // a malformed path is invalid_param even on the grain that would skip the filter —
        // garbage is rejected, never half-applied.
        assertThrows(IllegalArgumentException.class,
                () -> composer.mergeParams(dailyBase(), json("{\"complaintPath\":\"x; DROP TABLE y\"}"), new ArrayList<>()));
    }

    @Test
    public void legacyTwoArgOverloadStaysSafeWithoutACollector() {
        JsonNode merged = composer.mergeParams(dailyBase(), json("{\"complaintPath\":\"SANITATION\"}"));
        assertEquals(dailyBase(), merged);   // no NPE, same skip — reporting is opt-in
    }

    // ---- composition: hierLevel (GROUP BY) ⊥ complaintPath (WHERE) ----

    @Test
    public void composesWithHierLevelFilterPlusRollup() {
        // "Filter the Sanitation subtree, grouped at level 2" — WHERE prefix + GROUP BY level expr.
        JsonNode merged = composer.mergeParams(byTypeBase(),
                json("{\"hierLevel\":\"2\",\"complaintPath\":\"SANITATION\"}"));
        AnalyticsPlanner.Planned p = planner.plan(merged, stateScope);
        assertTrue(p.sql.contains("split_part(complaint_node_path,'.',least(2,complaint_depth))"),
                p.sql);   // the rollup dimension survived
        assertTrue(p.sql.contains("(complaint_node_path = ? OR complaint_node_path LIKE ? || '.%')"),
                p.sql);   // …and the subtree WHERE narrows it
        assertEquals(java.util.Arrays.asList("service_code", "total"), p.columns);
    }

    @Test
    public void leafServiceCodeParamStaysAnExactEq() {
        // Leaf selections keep sending serviceCode (exact match) — complaintPath is additive for
        // interior nodes, not a replacement.
        JsonNode merged = composer.mergeParams(byTypeBase(),
                json("{\"serviceCode\":\"GarbageNeedsTobeCleared\",\"complaintPath\":\"SANITATION\"}"));
        assertEquals("GarbageNeedsTobeCleared",
                merged.get("filters").get("service_code").get("eq").asText());
        assertEquals("SANITATION",
                merged.get("filters").get("complaint_node_path").get("subtree").asText());
        AnalyticsPlanner.Planned p = planner.plan(merged, stateScope);
        assertTrue(p.sql.contains("service_code = ?"));
    }

    // ---- ABAC: params only narrow; row-scope is injected on top ----

    @Test
    public void abacRowScopeIsStillAppliedOnTopOfTheSubtreeFilter() {
        AnalyticsScope constrained = new AnalyticsScope("ke.nairobi", false, null,
                "KENYA.NAIROBI", java.util.List.of("DEPT_SANITATION"));
        JsonNode merged = composer.mergeParams(byTypeBase(), json("{\"complaintPath\":\"SANITATION\"}"));
        AnalyticsPlanner.Planned p = planner.plan(merged, constrained);
        assertTrue(p.sql.contains("(complaint_node_path = ? OR complaint_node_path LIKE ? || '.%')"), p.sql);
        assertTrue(p.sql.contains("tenant_id = ?"), p.sql);                 // city tenant scope
        assertTrue(p.sql.contains("boundary_path LIKE ?"), p.sql);          // jurisdiction subtree scope
        assertTrue(p.sql.contains("department_code IN (?)"), p.sql);        // department scope
        // scope literals ride AFTER the param filter literals — injected on top, never replaced
        assertTrue(p.params.containsAll(java.util.List.of(
                "SANITATION", "ke.nairobi", "KENYA.NAIROBI%", "DEPT_SANITATION")), p.params.toString());
    }

    // ---- planner: subtree op is gated to prefix-filterable path columns ----

    @Test
    public void plannerRejectsSubtreeOnNonPathColumns() {
        JsonNode inline = json("{\"grain\":\"facts\","
                + "\"measures\":[{\"name\":\"total\",\"agg\":\"count\"}],"
                + "\"filters\":{\"service_code\":{\"subtree\":\"SANITATION\"}}}");
        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
                () -> planner.plan(inline, stateScope));
        assertTrue(ex.getMessage().startsWith("op_not_allowed"), ex.getMessage());
    }

    @Test
    public void plannerRejectsSubtreeOnDailyGrainInlinePath() {
        // daily's prefix allowlist is boundary_path only; complaint_node_path doesn't exist there.
        JsonNode inline = json("{\"grain\":\"daily\","
                + "\"measures\":[{\"name\":\"open\",\"agg\":\"count\"}],"
                + "\"filters\":{\"complaint_node_path\":{\"subtree\":\"SANITATION\"}}}");
        assertThrows(IllegalArgumentException.class, () -> planner.plan(inline, stateScope));
    }
}
