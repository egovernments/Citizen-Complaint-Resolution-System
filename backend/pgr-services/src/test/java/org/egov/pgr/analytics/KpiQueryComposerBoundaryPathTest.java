package org.egov.pgr.analytics;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Pins the {@code boundaryPath} subtree-filter param (CCSD-2171: the dashboard geography
 * drill-down's interior-node selections — province/district). Mirrors
 * {@link KpiQueryComposerComplaintPathTest} on the {@code boundary_path} column with the
 * boundary-specific deltas: the subtree guard is the PIPE delimiter (boundary paths are
 * {@code ancestralmaterializedpath || '|' || code}), the alphabet admits {@code |}, and —
 * unlike {@code complaint_node_path} — ALL THREE grains carry the column prefix-filterable,
 * so the filter applies on daily instead of landing in {@code paramsIgnored}.
 */
public class KpiQueryComposerBoundaryPathTest {

    private final ObjectMapper om = new ObjectMapper();
    private final AnalyticsCatalog catalog = new AnalyticsCatalog();
    private final KpiQueryComposer composer = new KpiQueryComposer(catalog);
    private final AnalyticsPlanner planner = new AnalyticsPlanner(catalog);
    private final AnalyticsScope stateScope = new AnalyticsScope("ke", true, null, null, null);
    private final BusinessCalendar calendar =
            BusinessCalendar.of(java.time.ZoneId.of("Africa/Nairobi"), 1_700_000_000_000L);

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

    // ---- SQL: the PIPE-guarded subtree predicate ----

    @Test
    public void sqlSnapshotForSubtreePredicate() {
        JsonNode merged = composer.mergeParams(byTypeBase(),
                json("{\"boundaryPath\":\"mz|maputo_cidade\"}"), calendar);
        AnalyticsPlanner.Planned p = planner.plan(merged, stateScope, calendar);
        assertEquals("SELECT service_code AS service_code, count(*) AS total"
                + " FROM complaint_facts"
                + " WHERE (boundary_path = ? OR boundary_path LIKE ? || '|%')"
                + " AND created_at >= ? AND created_at < ? AND tenant_id LIKE ?", p.sql.substring(0, p.sql.indexOf(" GROUP BY")));
        // eq arm binds the raw path, the LIKE arm the LIKE-escaped path ('_' is a legal boundary
        // code character but a LIKE metachar) — the '|' guard is in the SQL, so
        // 'mz|maputo_cidade' can never match a 'mz|maputo_cidade2|…' sibling.
        assertEquals("mz|maputo_cidade", p.params.get(0));
        assertEquals("mz|maputo\\_cidade", p.params.get(1));
    }

    @Test
    public void eventsGrainAppliesSubtree() {
        JsonNode base = json("{\"grain\":\"events\",\"dimensions\":[\"service_code\"],"
                + "\"measures\":[{\"name\":\"n\",\"agg\":\"count\"}]}");
        JsonNode merged = composer.mergeParams(base,
                json("{\"boundaryPath\":\"mz|maputo_cidade|distrito_kampfumo\"}"), calendar);
        AnalyticsPlanner.Planned p = planner.plan(merged, stateScope, calendar);
        assertTrue(p.sql.contains("FROM complaint_events"));
        assertTrue(p.sql.contains("(boundary_path = ? OR boundary_path LIKE ? || '|%')"));
    }

    // ---- daily grain: boundary_path EXISTS there — filter applies, nothing ignored ----

    @Test
    public void dailyGrainAppliesSubtreeAndReportsNothing() {
        List<String> ignored = new ArrayList<>();
        JsonNode merged = composer.mergeParams(dailyBase(),
                json("{\"boundaryPath\":\"mz|maputo_cidade\"}"), ignored, calendar);
        assertEquals("mz|maputo_cidade",
                merged.get("filters").get("boundary_path").get("subtree").asText());
        assertTrue(ignored.isEmpty(), "boundary_path is prefix-filterable on daily — no skip to report");
        AnalyticsPlanner.Planned p = planner.plan(merged, stateScope, calendar);
        assertTrue(p.sql.contains("(boundary_path = ? OR boundary_path LIKE ? || '|%')"), p.sql);
    }

    // ---- sanitizer: path alphabet + length cap ----

    @Test
    public void sqlMeaningfulValuesAreRejected() {
        for (String bad : new String[]{
                "mz' OR '1'='1", "a b", "x%y", "a;b", "x)--", "a\\b", "path*", "a,b",
                "x||'y", "a\"b", "café", "a\tb"}) {
            IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
                    () -> composer.mergeParams(byTypeBase(), json(om.createObjectNode()
                            .put("boundaryPath", bad).toString()), calendar),
                    "boundaryPath '" + bad + "' must be rejected");
            assertTrue(ex.getMessage().startsWith("invalid_param"), ex.getMessage());
        }
    }

    @Test
    public void overlongPathIsRejected() {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < 40; i++) sb.append("boundary_node|");
        String tooLong = sb.append("leaf_node").toString();   // > 512 chars, alphabet-legal
        assertTrue(tooLong.length() > KpiQueryComposer.MAX_BOUNDARY_PATH_LENGTH);
        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
                () -> composer.mergeParams(byTypeBase(), json("{\"boundaryPath\":\"" + tooLong + "\"}"), calendar));
        assertTrue(ex.getMessage().startsWith("invalid_param"), ex.getMessage());
    }

    @Test
    public void livePathShapesAreAccepted() {
        // Real mz shapes: pipe-joined lowercase codes, segments underscore-joined; a bare root
        // and a full Provincia|Distrito|Municipio path both pass.
        for (String ok : new String[]{"mz", "mz|maputo_cidade",
                "mz|maputo_cidade|distrito_kampfumo",
                "mz|maputo_cidade|distrito_kampfumo|municipio_maputo_katembe"}) {
            JsonNode merged = composer.mergeParams(byTypeBase(),
                    json("{\"boundaryPath\":\"" + ok + "\"}"), calendar);
            assertEquals(ok, merged.get("filters").get("boundary_path").get("subtree").asText());
        }
    }

    @Test
    public void emptyAndAbsentAreNoOps() {
        assertEquals(byTypeBase(), composer.mergeParams(byTypeBase(), json("{\"boundaryPath\":\"\"}"), calendar));
        JsonNode merged = composer.mergeParams(byTypeBase(), json("{\"window\":\"last_7d\"}"), calendar);
        assertFalse(merged.has("filters"));
    }

    // ---- composition: leaf ward eq ⊥ interior boundaryPath; complaintPath orthogonal ----

    @Test
    public void leafWardParamStaysAnExactEq() {
        // Leaf (ward) selections keep sending ward (exact ward_code match) — boundaryPath is
        // additive for interior nodes, not a replacement.
        JsonNode merged = composer.mergeParams(byTypeBase(),
                json("{\"ward\":\"municipio_maputo_katembe\",\"boundaryPath\":\"mz|maputo_cidade\"}"), calendar);
        assertEquals("municipio_maputo_katembe",
                merged.get("filters").get("ward_code").get("eq").asText());
        assertEquals("mz|maputo_cidade",
                merged.get("filters").get("boundary_path").get("subtree").asText());
        AnalyticsPlanner.Planned p = planner.plan(merged, stateScope, calendar);
        assertTrue(p.sql.contains("ward_code = ?"));
    }

    @Test
    public void composesWithComplaintPathOnItsOwnColumn() {
        JsonNode merged = composer.mergeParams(byTypeBase(),
                json("{\"complaintPath\":\"SANITATION\",\"boundaryPath\":\"mz|maputo_cidade\"}"), calendar);
        AnalyticsPlanner.Planned p = planner.plan(merged, stateScope, calendar);
        assertTrue(p.sql.contains("(complaint_node_path = ? OR complaint_node_path LIKE ? || '.%')"), p.sql);
        assertTrue(p.sql.contains("(boundary_path = ? OR boundary_path LIKE ? || '|%')"), p.sql);
    }

    // ---- ABAC: params only narrow; row-scope is injected on top ----

    @Test
    public void abacRowScopeIsStillAppliedOnTopOfTheSubtreeFilter() {
        AnalyticsScope constrained = new AnalyticsScope("ke.nairobi", false, null,
                "KENYA.NAIROBI", java.util.List.of("DEPT_SANITATION"));
        JsonNode merged = composer.mergeParams(byTypeBase(),
                json("{\"boundaryPath\":\"mz|maputo_cidade\"}"), calendar);
        AnalyticsPlanner.Planned p = planner.plan(merged, constrained, calendar);
        assertTrue(p.sql.contains("(boundary_path = ? OR boundary_path LIKE ? || '|%')"), p.sql);
        assertTrue(p.sql.contains("tenant_id = ?"), p.sql);                 // city tenant scope
        assertTrue(p.sql.contains("boundary_path LIKE ?"), p.sql);          // jurisdiction subtree scope
        assertTrue(p.sql.contains("department_code IN (?)"), p.sql);        // department scope
        assertTrue(p.params.containsAll(java.util.List.of(
                "mz|maputo_cidade", "ke.nairobi", "KENYA.NAIROBI%", "DEPT_SANITATION")), p.params.toString());
    }
}
