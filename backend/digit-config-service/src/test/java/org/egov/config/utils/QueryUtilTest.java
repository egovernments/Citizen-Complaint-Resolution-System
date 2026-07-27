package org.egov.config.utils;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class QueryUtilTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    @Test
    void emptyOrNullMapReturnsEmptyObject() {
        assertEquals("{}", QueryUtil.preparePartialJsonStringFromFilterMap(null));
        assertEquals("{}", QueryUtil.preparePartialJsonStringFromFilterMap(new LinkedHashMap<>()));
    }

    @Test
    void scalarValuesProduceValidJson() throws Exception {
        Map<String, Object> filter = new LinkedHashMap<>();
        filter.put("tenantId", "pg");
        filter.put("count", 3);
        filter.put("enabled", true);

        String json = QueryUtil.preparePartialJsonStringFromFilterMap(filter);
        JsonNode node = MAPPER.readTree(json); // parses => valid JSON
        assertEquals("pg", node.get("tenantId").asText());
        assertEquals(3, node.get("count").asInt());
        assertTrue(node.get("enabled").asBoolean());
    }

    @Test
    void stringValueWithQuotesIsEscaped() throws Exception {
        Map<String, Object> filter = new LinkedHashMap<>();
        filter.put("name", "a\"b");
        JsonNode node = MAPPER.readTree(QueryUtil.preparePartialJsonStringFromFilterMap(filter));
        assertEquals("a\"b", node.get("name").asText());
    }

    @Test
    void nestedObjectAndArrayProduceValidJson() throws Exception {
        // Regression: criteria was widened to Map<String,Object>. A nested Map/List value
        // previously fell through to Object.toString() (e.g. "{nested=1}"), producing invalid
        // JSON and failing the `data @> CAST(? AS jsonb)` cast at query time.
        Map<String, Object> nested = new LinkedHashMap<>();
        nested.put("nested", 1);

        Map<String, Object> filter = new LinkedHashMap<>();
        filter.put("tenantId", "pg");
        filter.put("config", nested);
        filter.put("tags", List.of("a", "b"));

        String json = assertDoesNotThrow(() -> QueryUtil.preparePartialJsonStringFromFilterMap(filter));
        JsonNode node = MAPPER.readTree(json); // must be parseable as valid JSON
        assertEquals(1, node.get("config").get("nested").asInt());
        assertEquals("a", node.get("tags").get(0).asText());
        assertEquals("b", node.get("tags").get(1).asText());
        // Explicitly assert the old broken rendering is gone.
        assertTrue(!json.contains("nested=1"));
    }
}
