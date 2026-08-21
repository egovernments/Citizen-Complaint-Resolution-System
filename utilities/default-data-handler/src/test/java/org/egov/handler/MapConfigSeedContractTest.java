package org.egov.handler;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.networknt.schema.JsonSchema;
import com.networknt.schema.JsonSchemaFactory;
import com.networknt.schema.SpecVersion;
import com.networknt.schema.ValidationMessage;
import org.junit.jupiter.api.Test;

import java.io.InputStream;
import java.util.HashSet;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class MapConfigSeedContractTest {

    private static final String SCHEMA_CODE = "RAINMAKER-PGR.MapConfig";

    /**
     * Root-only seed path: {@code StartupSchemaAndMasterDataInitializer} loads it
     * for {@code default.tenant.id} alone. It must stay out of {@code mdmsData/},
     * which {@code DataHandlerService.loadNewTenantProductionData} replays for
     * every new tenant — a copy there would give each city its own row and cut it
     * off from state-root map styling.
     */
    private static final String SEED_PATH =
            "/stateMdmsData/RAINMAKER-PGR/RAINMAKER-PGR.MapConfig.json";
    private static final String SHARED_BUNDLE_PATH =
            "/mdmsData/RAINMAKER-PGR/RAINMAKER-PGR.MapConfig.json";
    private static final String SCHEMA_PATH = "/schema/RAINMAKER-PGR.json";

    /** Fields that make a record tenant-specific; Phase 2 supplies these, not the seed. */
    private static final Set<String> GEOGRAPHY_FIELDS = Set.of(
            "center", "boundaryTenantId", "geocodeCountryCodes", "searchViewbox",
            "defaultZoom", "minZoom", "maxZoom");

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    void seedIsRootOnlyAndAbsentFromThePerTenantBundle() throws Exception {
        assertNotNull(readResource(SEED_PATH), "Root-only MapConfig seed is missing");
        assertNull(getClass().getResourceAsStream(SHARED_BUNDLE_PATH),
                "MapConfig must not live in mdmsData/: that bundle is replayed for every new "
                        + "tenant, so a city would get its own row instead of inheriting the root's");
    }

    @Test
    void seedIsASingleGeographyNeutralDefaultRecord() throws Exception {
        JsonNode seedArray = readResource(SEED_PATH);
        assertTrue(seedArray.isArray(), "MapConfig seed must be a JSON array");
        assertEquals(1, seedArray.size(), "MapConfig is a singleton per tenant");

        JsonNode seed = seedArray.get(0);
        assertEquals("DEFAULT", seed.path("code").asText(),
                "The singleton is read by uniqueIdentifier DEFAULT");
        for (String geographyField : GEOGRAPHY_FIELDS) {
            assertFalse(seed.has(geographyField),
                    "Seed must carry no tenant geometry, found: " + geographyField);
        }
    }

    @Test
    void seedValidatesAgainstTheCheckedInMapConfigSchema() throws Exception {
        JsonSchema schema = mapConfigSchema();
        for (JsonNode seed : readResource(SEED_PATH)) {
            Set<ValidationMessage> errors = schema.validate(seed);
            assertTrue(errors.isEmpty(), "Seed record violates the MapConfig schema: " + errors);
        }
    }

    /**
     * Guards the test above: a validator wired to the wrong node (or one that
     * silently ignores the schema's enum/pattern/bounds) would pass everything.
     */
    @Test
    void schemaValidationRejectsValuesTheSeedCouldDriftInto() throws Exception {
        JsonSchema schema = mapConfigSchema();
        JsonNode validSeed = readResource(SEED_PATH).get(0);

        assertFalse(schema.validate(mutate(validSeed, "baseMapTheme", "Voyager")).isEmpty(),
                "baseMapTheme enum is not being enforced");
        assertFalse(schema.validate(mutate(validSeed, "wardHighlightColor", "orange")).isEmpty(),
                "wardHighlightColor hex pattern is not being enforced");
        assertFalse(schema.validate(mutateInt(validSeed, "defaultZoom", 99)).isEmpty(),
                "defaultZoom bounds are not being enforced");
        assertFalse(schema.validate(mutate(validSeed, "notAField", "x")).isEmpty(),
                "additionalProperties is not being enforced");
    }

    @Test
    void schemaKeysTheRecordByCode() throws Exception {
        JsonNode definition = mapConfigSchemaNode().path("definition");
        assertTrue(contains(definition.path("required"), "code"),
                "code must be required on MapConfig");
        assertTrue(contains(definition.path("x-unique"), "code"),
                "code must be the uniqueness key — a colour-keyed schema squats the same code");
        assertEquals("{tenantid}", mapConfigSchemaNode().path("tenantId").asText(),
                "Schema is registered per tenant via the {tenantid} placeholder");
    }

    private JsonSchema mapConfigSchema() throws Exception {
        JsonNode definition = mapConfigSchemaNode().path("definition");
        return JsonSchemaFactory.getInstance(SpecVersion.VersionFlag.V7).getSchema(definition);
    }

    private JsonNode mapConfigSchemaNode() throws Exception {
        for (JsonNode schema : readResource(SCHEMA_PATH)) {
            if (SCHEMA_CODE.equals(schema.path("code").asText())) {
                return schema;
            }
        }
        throw new AssertionError("MapConfig schema must be registered in RAINMAKER-PGR.json");
    }

    private JsonNode mutate(JsonNode base, String field, String value) {
        return ((ObjectNode) base.deepCopy()).put(field, value);
    }

    private JsonNode mutateInt(JsonNode base, String field, int value) {
        return ((ObjectNode) base.deepCopy()).put(field, value);
    }

    private boolean contains(JsonNode array, String value) {
        Set<String> values = new HashSet<>();
        array.forEach(node -> values.add(node.asText()));
        return values.contains(value);
    }

    private JsonNode readResource(String path) throws Exception {
        try (InputStream stream = getClass().getResourceAsStream(path)) {
            assertNotNull(stream, "Missing classpath resource: " + path);
            return objectMapper.readTree(stream);
        }
    }
}
