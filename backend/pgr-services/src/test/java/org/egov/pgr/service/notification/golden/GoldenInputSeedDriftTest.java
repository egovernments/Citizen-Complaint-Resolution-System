package org.egov.pgr.service.notification.golden;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * The golden matrix claims its four notification masters are the SHIPPED default seeds. This makes
 * the claim self-verifying: {@code golden/inputs/masters/*.json} must stay JSON-equal (including
 * array order) to {@code utilities/default-data-handler/.../mdmsData-dev/RAINMAKER-PGR/}.
 *
 * <p>The copies exist because the Docker test runner mounts only {@code backend/pgr-services}; the
 * authoritative files are reachable only in a monorepo checkout, so outside one these tests SKIP
 * rather than fail.
 *
 * <p>pgr-services stopped READING these masters at the thin-event cutover — routing, templates and
 * provider templates are novu-bridge's now. The copies stay because they are still the input matrix:
 * novu-bridge holds byte-identical copies of this whole folder ({@code GoldenFixtureSyncTest}) and
 * runs its legacy read-adapter over them, so a seed edited here without the golden master being
 * regenerated would quietly change what the bridge is held to.
 */
class GoldenInputSeedDriftTest {

    private static final Path SEED_DIR = Paths.get("..", "..", "utilities", "default-data-handler",
            "src", "main", "resources", "mdmsData-dev", "RAINMAKER-PGR");

    private final ObjectMapper mapper = GoldenThinEventFixtureGenerator.newMapper();

    @Test
    void goldenInputMastersAreTheShippedSeeds() throws Exception {
        Assumptions.assumeTrue(Files.isDirectory(SEED_DIR),
                "monorepo layout not present — skipping golden input drift guard");
        for (String file : List.of(
                "RAINMAKER-PGR.NotificationRouting.json",
                "RAINMAKER-PGR.NotificationTemplate.json",
                "RAINMAKER-PGR.NotificationProviderTemplate.json",
                "RAINMAKER-PGR.NotificationChannel.json")) {
            JsonNode copy = GoldenThinEventFixtureGenerator.readJson(
                    mapper, GoldenThinEventFixtureGenerator.MASTERS_PREFIX + file);
            JsonNode seed = mapper.readTree(SEED_DIR.resolve(file).toFile());
            assertEquals(seed, copy, "golden/inputs/masters/" + file + " has drifted from the "
                    + "authoritative default-data-handler seed — re-copy it, then decide whether the "
                    + "golden master must be regenerated");
        }
    }
}
