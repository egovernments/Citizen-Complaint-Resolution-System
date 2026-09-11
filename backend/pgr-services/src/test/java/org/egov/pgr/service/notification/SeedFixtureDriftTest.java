package org.egov.pgr.service.notification;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;

import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Golden-fixture drift guard (PGR-2, gap G5). {@link NotificationGoldenOutputTest} treats its
 * {@code notification/seed-routing.json} / {@code notification/seed-templates.json} fixtures as
 * "copied verbatim from the authoritative seed" — this test makes that claim self-verifying:
 *
 *  - {@code seed-routing.json}   MUST be JSON-equal to the whole authoritative
 *    {@code RAINMAKER-PGR.NotificationRouting.json} (33 rows, verified 2026-07-02).
 *  - {@code seed-templates.json} MUST be JSON-equal to the {@code channel == "SMS"} subset (in file
 *    order) of {@code RAINMAKER-PGR.NotificationTemplate.json} (11 of 33 rows, verified 2026-07-02).
 *
 * If the authoritative seed is edited (a channel/body reworded) without re-copying the fixture, the
 * legacy-parity gate would silently drift; these assertions fail loudly instead.
 *
 * The authoritative seed lives in the sibling {@code utilities/default-data-handler} module and is read
 * via a relative path from the surefire working directory (the module dir {@code backend/pgr-services}).
 * In a packaged build outside the monorepo that path is absent, so the tests SKIP (via {@link Assumptions})
 * rather than fail.
 */
public class SeedFixtureDriftTest {

    private final ObjectMapper mapper = new ObjectMapper();

    private static final Path ROUTING_SEED = Paths.get("..", "..", "utilities",
            "default-data-handler", "src", "main", "resources", "mdmsData-dev", "RAINMAKER-PGR",
            "RAINMAKER-PGR.NotificationRouting.json");
    private static final Path TEMPLATE_SEED = Paths.get("..", "..", "utilities",
            "default-data-handler", "src", "main", "resources", "mdmsData-dev", "RAINMAKER-PGR",
            "RAINMAKER-PGR.NotificationTemplate.json");

    private JsonNode readClasspath(String resource) throws Exception {
        try (InputStream in = SeedFixtureDriftTest.class.getClassLoader().getResourceAsStream(resource)) {
            assertNotNull(in, "Missing test fixture on classpath: " + resource);
            return mapper.readTree(in);
        }
    }

    @Test
    void routingFixture_equalsAuthoritativeSeed() throws Exception {
        Assumptions.assumeTrue(Files.exists(ROUTING_SEED),
                "monorepo layout not present — skipping routing drift guard");
        JsonNode fixture = readClasspath("notification/seed-routing.json");
        JsonNode seed = mapper.readTree(ROUTING_SEED.toFile());
        // Jackson JsonNode.equals is order-sensitive for arrays — exactly what we want here.
        assertEquals(seed, fixture,
                "seed-routing.json has drifted from the authoritative NotificationRouting seed — re-copy it");
    }

    @Test
    void templateFixture_equalsSmsSubsetOfAuthoritativeSeed() throws Exception {
        Assumptions.assumeTrue(Files.exists(TEMPLATE_SEED),
                "monorepo layout not present — skipping template drift guard");
        JsonNode fixture = readClasspath("notification/seed-templates.json");
        JsonNode seed = mapper.readTree(TEMPLATE_SEED.toFile());
        assertTrue(seed.isArray(), "authoritative NotificationTemplate seed must be a JSON array");
        // Keep SMS rows in their original file order — this is what NotificationGoldenOutputTest asserts against.
        ArrayNode smsSubset = mapper.createArrayNode();
        for (JsonNode row : seed) {
            if ("SMS".equalsIgnoreCase(row.path("channel").asText())) smsSubset.add(row);
        }
        assertEquals(smsSubset, fixture,
                "seed-templates.json has drifted from the SMS subset of the authoritative NotificationTemplate seed — re-copy it");
    }
}
