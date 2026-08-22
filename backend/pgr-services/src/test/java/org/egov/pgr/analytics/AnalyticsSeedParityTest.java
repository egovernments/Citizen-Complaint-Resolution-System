package org.egov.pgr.analytics;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * The seeded capability actions, checked where they would otherwise rot silently.
 *
 * <p>A deployment reads its policy from one of three places — default-data, the Nairobi tenant
 * masters, or the local full dump. If they disagree about what action 2641 is, two deployments
 * enforce two different rules under one id, and nothing at runtime says so.
 */
class AnalyticsSeedParityTest {

    private static final Path REPO = Paths.get("../..").toAbsolutePath().normalize();
    private static final Path DEFAULT_ACTIONS = REPO.resolve(
            "utilities/default-data-handler/src/main/resources/mdmsData/ACCESSCONTROL-ACTIONS-TEST/ACCESSCONTROL-ACTIONS-TEST.actions-test.json");
    private static final Path DEFAULT_ROLEACTIONS = REPO.resolve(
            "utilities/default-data-handler/src/main/resources/mdmsData/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json");
    private static final Path NAIROBI_ACTIONS = REPO.resolve(
            "ansible/nairobi-mdms/mdms/ACCESSCONTROL-ACTIONS-TEST/actions-test.json");
    private static final Path FULL_DUMP = REPO.resolve("local-setup/db/full-dump.sql");

    private static final ObjectMapper MAPPER = new ObjectMapper();

    @Test
    void everyCapabilityActionIsSeededInDefaultData() throws IOException {
        Map<Long, JsonNode> seeded = capabilityActions(read(DEFAULT_ACTIONS));

        assertEquals(AnalyticsCapabilities.ALL.size(), seeded.size(),
                "one action per capability, ids 2640-2648");
        Set<String> urls = new LinkedHashSet<>();
        for (JsonNode action : seeded.values()) {
            urls.add(action.get("url").asText());
            assertEquals("POST", action.path("method").asText(), "capability actions are POST");
            assertFalse(action.path("enabled").asBoolean(true),
                    "disabled, like every other action row — enabled is legacy gateway metadata");
        }
        assertEquals(new LinkedHashSet<>(AnalyticsCapabilities.ALL), urls);
    }

    @Test
    void theCapabilityActionsCarryNoPolicyOfTheirOwn() throws IOException {
        // They are endpoint grants. Row scope lives on action 2008 and is evaluated separately —
        // an action that both grants an endpoint AND carries a row policy is the conflation #1050
        // was told not to introduce.
        for (JsonNode action : capabilityActions(read(DEFAULT_ACTIONS)).values()) {
            assertTrue(action.path("resource").isMissingNode(), action.get("url").asText() + " has a resource block");
            assertTrue(action.path("condition").isMissingNode(), action.get("url").asText() + " has a condition");
        }
    }

    @Test
    void noSeedInventsAScopeRefConstruct() throws IOException {
        // scopeRef is not part of #1441's policy language. It was proposed, rejected, and must not
        // reappear in data where nothing would reject it.
        for (Path seed : List.of(DEFAULT_ACTIONS, DEFAULT_ROLEACTIONS, NAIROBI_ACTIONS, FULL_DUMP))
            assertFalse(Files.readString(seed).contains("scopeRef"), seed.getFileName() + " mentions scopeRef");
    }

    @Test
    void action2008IsUntouchedByThisEffort() throws IOException {
        // The complaint policy is #1441's. This ticket adds capability grants beside it and changes
        // nothing about it — including not introducing a second, shadowing definition.
        List<JsonNode> defaults = new ArrayList<>();
        for (JsonNode row : read(DEFAULT_ACTIONS))
            if (row.path("id").asLong() == 2008L) defaults.add(row);

        assertEquals(1, defaults.size(), "exactly one action 2008 in default-data");
        assertEquals("/pgr-services/v2/request/_search", defaults.get(0).get("url").asText());
    }

    @Test
    void theNairobiMastersCarryTheSameActionsForTheTenantsThatAlreadyHad2008() throws IOException {
        JsonNode nairobi = MAPPER.readTree(Files.readString(NAIROBI_ACTIONS));
        Set<String> tenantsWith2008 = new LinkedHashSet<>();
        for (JsonNode row : nairobi)
            if (row.path("data").path("id").asLong() == 2008L) tenantsWith2008.add(row.path("tenantId").asText());

        assertFalse(tenantsWith2008.isEmpty());

        Map<Long, JsonNode> defaults = capabilityActions(read(DEFAULT_ACTIONS));
        for (String tenant : tenantsWith2008) {
            Map<Long, JsonNode> seeded = new TreeMap<>();
            for (JsonNode row : nairobi) {
                if (!tenant.equals(row.path("tenantId").asText())) continue;
                long id = row.path("data").path("id").asLong();
                if (id >= 2640 && id <= 2648) seeded.put(id, row.path("data"));
            }
            assertEquals(defaults.keySet(), seeded.keySet(), tenant + " must carry every capability action");
            for (Map.Entry<Long, JsonNode> entry : defaults.entrySet()) {
                JsonNode expected = entry.getValue();
                JsonNode actual = seeded.get(entry.getKey());
                assertEquals(expected.get("url").asText(), actual.get("url").asText(),
                        tenant + " action " + entry.getKey() + " url");
                assertEquals(expected.path("method").asText(), actual.path("method").asText(),
                        tenant + " action " + entry.getKey() + " method");
            }
        }
    }

    @Test
    void theFullDumpAgreesWithDefaultDataOnEveryCapabilityAction() throws IOException {
        Map<Long, JsonNode> defaults = capabilityActions(read(DEFAULT_ACTIONS));
        Map<Long, JsonNode> dump = new TreeMap<>();
        for (String line : Files.readAllLines(FULL_DUMP)) {
            if (!line.startsWith("accesscontrol-action-26")) continue;
            for (String column : line.split("\t")) {
                if (!column.startsWith("{\"id\"")) continue;
                JsonNode action = MAPPER.readTree(column);
                long id = action.path("id").asLong();
                if (id >= 2640 && id <= 2648) dump.put(id, action);
                break;
            }
        }

        assertEquals(defaults.keySet(), dump.keySet());
        for (Map.Entry<Long, JsonNode> entry : defaults.entrySet()) {
            assertEquals(entry.getValue().get("url").asText(), dump.get(entry.getKey()).get("url").asText());
            assertEquals(entry.getValue().path("method").asText(), dump.get(entry.getKey()).path("method").asText());
        }
    }

    @Test
    void theBaseCapabilitiesAreMappedToRolesOrNobodyCanReachThem() throws IOException {
        // An action with no ACCESSCONTROL-ROLEACTIONS mapping is invisible to everyone, and the
        // symptom is an empty dashboard rather than an error — the exact trap #1441's runbook
        // calls out at step 4.
        Set<String> mappedTo = new LinkedHashSet<>();
        for (JsonNode row : read(DEFAULT_ROLEACTIONS))
            if (row.path("actionid").asLong() == 2641L) mappedTo.add(row.path("rolecode").asText());

        assertTrue(mappedTo.contains("SUPERVISOR"), "the base query action must reach supervisors");
        assertTrue(mappedTo.contains("GRO"));
        assertFalse(mappedTo.contains("DGRO"), "DGRO is stale and deliberately not mapped");
    }

    private static Map<Long, JsonNode> capabilityActions(JsonNode rows) {
        Map<Long, JsonNode> found = new TreeMap<>();
        for (JsonNode row : rows) {
            long id = row.path("id").asLong();
            if (id >= 2640 && id <= 2648) found.put(id, row);
        }
        return found;
    }

    private static JsonNode read(Path path) throws IOException {
        return MAPPER.readTree(Files.readString(path));
    }
}
