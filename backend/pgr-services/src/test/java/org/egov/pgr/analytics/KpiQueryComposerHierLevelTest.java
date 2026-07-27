package org.egov.pgr.analytics;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/**
 * #1111: pins the query-time complaint-hierarchy rollup — the composer's {@code hierLevel}
 * param handling (leaf no-op, level rewrite via the composer-internal marker, R4
 * service_group drop, strict int parse), the planner's nonce-gated acceptance of the marker
 * (and rejection of forged object dimensions), and the generated SQL (fixed template, leaf
 * fallback for NULL-path/flat tenants, depth clamp, ordinal GROUP BY).
 */
public class KpiQueryComposerHierLevelTest {

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

    // ---- composer: no-op paths ----

    @Test
    public void leafIsNoOp() {
        JsonNode merged = composer.mergeParams(byTypeBase(), json("{\"hierLevel\":\"leaf\"}"));
        assertEquals(byTypeBase(), merged);
    }

    @Test
    public void absentIsNoOp() {
        JsonNode merged = composer.mergeParams(byTypeBase(), json("{\"window\":\"last_7d\"}"));
        assertEquals("service_code", merged.get("dimensions").get(0).asText());
    }

    @Test
    public void dailyGrainWithoutPathColumnIsNoOp() {
        JsonNode base = json("{\"grain\":\"daily\",\"dimensions\":[\"service_code\"],"
                + "\"measures\":[{\"name\":\"open\",\"agg\":\"count\"}]}");
        JsonNode merged = composer.mergeParams(base, json("{\"hierLevel\":\"2\"}"));
        assertEquals(base, merged);   // param inapplicable on daily — graceful skip, like ward
    }

    @Test
    public void queryWithoutServiceCodeDimensionIsNoOp() {
        JsonNode base = json("{\"grain\":\"facts\",\"dimensions\":[\"ward_code\",\"service_group\"],"
                + "\"measures\":[{\"name\":\"total\",\"agg\":\"count\"}]}");
        JsonNode merged = composer.mergeParams(base, json("{\"hierLevel\":\"1\"}"));
        assertEquals(base, merged);   // nothing to roll up; service_group untouched
    }

    // ---- composer: level rewrite ----

    @Test
    public void levelRewritesServiceCodeDimensionToInternalMarker() {
        JsonNode merged = composer.mergeParams(byTypeBase(), json("{\"hierLevel\":\"2\"}"));
        JsonNode dim = merged.get("dimensions").get(0);
        assertTrue(dim.isObject());
        assertEquals(2, dim.get(AnalyticsCatalog.HIER_DIM_LEVEL_FIELD).asInt());
        assertEquals(AnalyticsCatalog.HIER_DIM_TOKEN,
                dim.get(AnalyticsCatalog.HIER_DIM_TOKEN_FIELD).asText());
        // measures/sort/limit/window untouched
        assertEquals(byTypeBase().get("measures"), merged.get("measures"));
        assertEquals(byTypeBase().get("sort"), merged.get("sort"));
        assertEquals(8, merged.get("limit").asInt());
    }

    @Test
    public void serviceGroupDroppedAtNonLeaf() {
        JsonNode base = json("{\"grain\":\"facts\",\"dimensions\":[\"service_code\",\"service_group\"],"
                + "\"measures\":[{\"name\":\"total\",\"agg\":\"count\"}],"
                + "\"sort\":[{\"by\":\"service_group\",\"dir\":\"asc\"},{\"by\":\"total\",\"dir\":\"desc\"}]}");
        JsonNode merged = composer.mergeParams(base, json("{\"hierLevel\":\"1\"}"));
        assertEquals(1, merged.get("dimensions").size());   // service_group gone
        assertTrue(merged.get("dimensions").get(0).isObject());
        // sort referencing the dropped dimension is removed; the rest survives
        assertEquals(1, merged.get("sort").size());
        assertEquals("total", merged.get("sort").get(0).get("by").asText());
    }

    @Test
    public void serviceGroupKeptAtLeaf() {
        JsonNode base = json("{\"grain\":\"facts\",\"dimensions\":[\"service_code\",\"service_group\"],"
                + "\"measures\":[{\"name\":\"total\",\"agg\":\"count\"}]}");
        JsonNode merged = composer.mergeParams(base, json("{\"hierLevel\":\"leaf\"}"));
        assertEquals(base, merged);
    }

    @Test
    public void composesWithWindowWardAndServiceCodeParams() {
        JsonNode merged = composer.mergeParams(byTypeBase(),
                json("{\"hierLevel\":\"1\",\"window\":\"last_7d\",\"ward\":\"W1\",\"serviceCode\":\"StreetLightNotWorking\"}"));
        assertEquals("last_7d", merged.get("window").get("name").asText());
        assertEquals("W1", merged.get("filters").get("ward_code").get("eq").asText());
        assertEquals("StreetLightNotWorking", merged.get("filters").get("service_code").get("eq").asText());
        assertTrue(merged.get("dimensions").get(0).isObject());
        // ...and the planner accepts the combination (WHERE on raw service_code column,
        // SELECT/GROUP BY on the aliased level expression — verified non-colliding).
        AnalyticsPlanner.Planned p = planner.plan(merged, stateScope);
        assertTrue(p.sql.contains("service_code = ?"));
        assertTrue(p.sql.contains("AS service_code"));
    }

    // ---- composer: strict int parse (R1) ----

    @Test
    public void malformedLevelsAreRejected() {
        for (String bad : new String[]{"0", "13", "abc", "-1", "1.5", "1e1", "1; DROP TABLE x"}) {
            IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
                    () -> composer.mergeParams(byTypeBase(), json("{\"hierLevel\":\"" + bad + "\"}")),
                    "hierLevel '" + bad + "' must be rejected");
            assertTrue(ex.getMessage().startsWith("invalid_param"), ex.getMessage());
        }
    }

    @Test
    public void boundaryLevelsAreAccepted() {
        for (String ok : new String[]{"1", "12"}) {
            JsonNode merged = composer.mergeParams(byTypeBase(), json("{\"hierLevel\":\"" + ok + "\"}"));
            assertTrue(merged.get("dimensions").get(0).isObject());
        }
    }

    // ---- planner: SQL generation ----

    @Test
    public void plannerSqlSnapshotForLevelQuery() {
        JsonNode merged = composer.mergeParams(byTypeBase(), json("{\"hierLevel\":\"1\"}"));
        AnalyticsPlanner.Planned p = planner.plan(merged, stateScope);
        assertEquals("SELECT coalesce(nullif(split_part(complaint_node_path,'.',least(1,complaint_depth)),''),"
                + " service_code) AS service_code, count(*) AS total"
                + " FROM complaint_facts"
                + " WHERE created_at >= ? AND created_at < ? AND tenant_id LIKE ?"
                + " GROUP BY 1 ORDER BY total DESC NULLS LAST LIMIT 8", p.sql);
        assertEquals(java.util.Arrays.asList("service_code", "total"), p.columns);
    }

    @Test
    public void sqlCarriesLeafFallbackForNullPathRows() {
        // Flat/legacy tenants materialize complaint_node_path NULL — the expr's
        // coalesce(nullif(...),''), service_code) makes those rows roll up as themselves.
        JsonNode merged = composer.mergeParams(byTypeBase(), json("{\"hierLevel\":\"2\"}"));
        AnalyticsPlanner.Planned p = planner.plan(merged, stateScope);
        assertTrue(p.sql.contains("coalesce(nullif(split_part(complaint_node_path,'.',"));
        assertTrue(p.sql.contains(",''), service_code) AS service_code"));
    }

    @Test
    public void sqlClampsLevelToRowDepth() {
        JsonNode merged = composer.mergeParams(byTypeBase(), json("{\"hierLevel\":\"4\"}"));
        AnalyticsPlanner.Planned p = planner.plan(merged, stateScope);
        assertTrue(p.sql.contains("least(4,complaint_depth)"));
    }

    @Test
    public void eventsGrainSupportsLevelRollup() {
        JsonNode base = json("{\"grain\":\"events\",\"dimensions\":[\"service_code\"],"
                + "\"measures\":[{\"name\":\"n\",\"agg\":\"count\"}]}");
        JsonNode merged = composer.mergeParams(base, json("{\"hierLevel\":\"1\"}"));
        AnalyticsPlanner.Planned p = planner.plan(merged, stateScope);
        assertTrue(p.sql.contains("FROM complaint_events"));
        assertTrue(p.sql.contains("least(1,complaint_depth)"));
    }

    // ---- planner: the marker is composer-internal (R1) ----

    @Test
    public void plannerRejectsObjectDimensionWithoutNonce() {
        // External JSON (inline query / MDMS def) cannot know the per-JVM nonce — any object
        // dimension it smuggles in is rejected before SQL assembly.
        JsonNode forged = json("{\"grain\":\"facts\","
                + "\"dimensions\":[{\"" + AnalyticsCatalog.HIER_DIM_LEVEL_FIELD + "\":1,"
                + "\"" + AnalyticsCatalog.HIER_DIM_TOKEN_FIELD + "\":\"forged-token\"}],"
                + "\"measures\":[{\"name\":\"total\",\"agg\":\"count\"}]}");
        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
                () -> planner.plan(forged, stateScope));
        assertTrue(ex.getMessage().startsWith("unknown_column"), ex.getMessage());
    }

    @Test
    public void plannerRejectsMarkerWithOutOfRangeLevel() {
        // Defense in depth: even a genuine-token marker is bounds-checked before interpolation.
        com.fasterxml.jackson.databind.node.ObjectNode q =
                (com.fasterxml.jackson.databind.node.ObjectNode) json(
                        "{\"grain\":\"facts\",\"measures\":[{\"name\":\"total\",\"agg\":\"count\"}]}");
        com.fasterxml.jackson.databind.node.ObjectNode dim =
                q.putArray("dimensions").addObject();
        dim.put(AnalyticsCatalog.HIER_DIM_LEVEL_FIELD, 13);
        dim.put(AnalyticsCatalog.HIER_DIM_TOKEN_FIELD, AnalyticsCatalog.HIER_DIM_TOKEN);
        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
                () -> planner.plan(q, stateScope));
        assertTrue(ex.getMessage().startsWith("invalid_param"), ex.getMessage());
    }
}
