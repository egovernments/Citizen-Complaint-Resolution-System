package org.egov.handler;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.io.InputStream;
import java.util.HashSet;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class MapConfigSeedContractTest {

    private static final String SCHEMA_CODE = "RAINMAKER-PGR.MapConfig";
    private static final String SEED_PATH =
            "/mdmsData/RAINMAKER-PGR/RAINMAKER-PGR.MapConfig.json";
    private static final String SCHEMA_PATH = "/schema/RAINMAKER-PGR.json";

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    void defaultSeedIsASingleMinimalRecordThatMatchesTheSchemaIdentity() throws Exception {
        JsonNode seedArray = readResource(SEED_PATH);
        assertTrue(seedArray.isArray(), "MapConfig seed must be a JSON array");
        assertEquals(1, seedArray.size(), "MapConfig is a singleton per tenant");

        JsonNode seed = seedArray.get(0);
        assertEquals("DEFAULT", seed.path("code").asText());
        assertEquals("voyager", seed.path("baseMapTheme").asText());
        assertEquals("#FFA74F", seed.path("wardHighlightColor").asText());
        assertEquals(
                Set.of("code", "baseMapTheme", "wardHighlightColor"),
                fieldNames(seed),
                "The default row must remain geography-neutral; Phase 2 supplies tenant geometry"
        );

        JsonNode schema = findSchema(readResource(SCHEMA_PATH), SCHEMA_CODE);
        assertNotNull(schema, "MapConfig schema must be registered in RAINMAKER-PGR.json");
        assertEquals("{tenantid}", schema.path("tenantId").asText());
        assertEquals("code", schema.path("definition").path("required").get(0).asText());
        assertEquals("code", schema.path("definition").path("x-unique").get(0).asText());

        JsonNode properties = schema.path("definition").path("properties");
        seed.fieldNames().forEachRemaining(field ->
                assertTrue(properties.has(field), "Seed field is absent from MapConfig schema: " + field));
    }

    private JsonNode readResource(String path) throws Exception {
        try (InputStream stream = getClass().getResourceAsStream(path)) {
            assertNotNull(stream, "Missing classpath resource: " + path);
            return objectMapper.readTree(stream);
        }
    }

    private JsonNode findSchema(JsonNode schemas, String code) {
        for (JsonNode schema : schemas) {
            if (code.equals(schema.path("code").asText())) {
                return schema;
            }
        }
        return null;
    }

    private Set<String> fieldNames(JsonNode node) {
        Set<String> fields = new HashSet<>();
        node.fieldNames().forEachRemaining(fields::add);
        return fields;
    }
}
