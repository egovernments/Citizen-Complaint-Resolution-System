package org.egov.novubridge.service.resolution.golden;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Every fixture {@link LegacySmsBodyParityTest} reads is a COPY of something authoritative that
 * lives in another module. A copy that silently drifts turns a parity gate into a gate against
 * itself: the test keeps passing while the thing it claims to pin has moved.
 *
 * <p>So each copy is compared with its original here — and, in the same convention as
 * {@link GoldenFixtureSyncTest}, this <b>SKIPS</b> when the rest of the repo is not on disk,
 * because the Docker test runner mounts one module at a time and "the sibling module is not in this
 * build context" is not a fault.
 *
 * <table>
 *   <caption>what is copied from where</caption>
 *   <tr><th>copy (test classpath)</th><th>original</th></tr>
 *   <tr><td>{@code golden/inputs/masters/RAINMAKER-PGR.Notification{Routing,Template}.json}</td>
 *       <td>{@code utilities/default-data-handler/.../mdmsData-dev/RAINMAKER-PGR/}</td></tr>
 *   <tr><td>{@code golden/expected/NOTIFICATIONS.{Routing,Template}.json}</td>
 *       <td>{@code utilities/default-data-handler/.../mdmsData-dev/NOTIFICATIONS/}</td></tr>
 *   <tr><td>{@code notification/legacy-localization.json}</td>
 *       <td>{@code utilities/default-data-handler/.../localisations/en_IN/rainmaker-pgr.json}</td></tr>
 * </table>
 *
 * <p>The first two rows overlap with {@link GoldenFixtureSyncTest}, which compares the same copies
 * against {@code backend/pgr-services}' golden folder. That is deliberate: this class states the
 * dependencies of the SMS-body gate in one place, and compares them against the SEED rather than
 * against another copy of the seed, so the chain has no link that is only ever checked sideways.
 */
class LegacySmsBodyFixtureSyncTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private static final Path DEFAULT_DATA = Paths.get("..", "..", "utilities",
            "default-data-handler", "src", "main", "resources");
    private static final Path RAINMAKER_SEED = DEFAULT_DATA.resolve(Paths.get("mdmsData-dev", "RAINMAKER-PGR"));
    private static final Path NOTIFICATIONS_SEED = DEFAULT_DATA.resolve(Paths.get("mdmsData-dev", "NOTIFICATIONS"));
    private static final Path LOCALISATION_SEED =
            DEFAULT_DATA.resolve(Paths.get("localisations", "en_IN", "rainmaker-pgr.json"));

    @Test
    @DisplayName("the copied legacy RAINMAKER-PGR masters are the shipped seeds")
    void theLegacyMasterCopiesHaveNotDrifted() throws Exception {
        Assumptions.assumeTrue(Files.isDirectory(RAINMAKER_SEED),
                "utilities/default-data-handler is not in this build context — the copy is all this "
                        + "module has, and it is what the SMS-body parity gate runs against");

        assertJsonEquals(RAINMAKER_SEED.resolve("RAINMAKER-PGR.NotificationRouting.json"),
                LegacySmsBodyParityTest.LEGACY_ROUTING);
        assertJsonEquals(RAINMAKER_SEED.resolve("RAINMAKER-PGR.NotificationTemplate.json"),
                LegacySmsBodyParityTest.LEGACY_TEMPLATES);
    }

    @Test
    @DisplayName("the copied NOTIFICATIONS.* masters are the shipped seeds")
    void theNewNamespaceCopiesHaveNotDrifted() throws Exception {
        Assumptions.assumeTrue(Files.isDirectory(NOTIFICATIONS_SEED),
                "utilities/default-data-handler is not in this build context");

        assertJsonEquals(NOTIFICATIONS_SEED.resolve("NOTIFICATIONS.Routing.json"),
                LegacySmsBodyParityTest.NEW_ROUTING);
        assertJsonEquals(NOTIFICATIONS_SEED.resolve("NOTIFICATIONS.Template.json"),
                LegacySmsBodyParityTest.NEW_TEMPLATES);
    }

    /**
     * The localization fixture is a SUBSET — eleven {@code PGR_*_SMS_MESSAGE} rows out of the
     * shipped file's thousand-odd — so it is compared row by row rather than whole-file. Every
     * copied row must exist in the original and be identical in EVERY field, and the count is
     * asserted so the subset cannot quietly shrink to nothing.
     */
    @Test
    @DisplayName("every copied legacy SMS message is identical to the shipped en_IN localisation")
    void theLegacyLocalizationCopyHasNotDrifted() throws Exception {
        Assumptions.assumeTrue(Files.isRegularFile(LOCALISATION_SEED),
                "utilities/default-data-handler is not in this build context");

        JsonNode seed = MAPPER.readTree(LOCALISATION_SEED.toFile());
        JsonNode seedMessages = seed.isArray() ? seed : seed.path("messages");
        assertTrue(seedMessages.isArray() && seedMessages.size() > 0,
                "the shipped rainmaker-pgr localisation must be a non-empty message list");
        Map<String, JsonNode> byCode = new LinkedHashMap<>();
        for (JsonNode message : seedMessages) {
            byCode.putIfAbsent(message.path("code").asText(), message);
        }

        JsonNode copyMessages = LegacySmsBodyParityTest.read(LegacySmsBodyParityTest.LEGACY_LOCALIZATION)
                .path("messages");
        assertTrue(copyMessages.isArray(), "the fixture must carry a messages array");
        int compared = 0;
        for (JsonNode copy : copyMessages) {
            String code = copy.path("code").asText();
            JsonNode original = byCode.get(code);
            assertNotNull(original, code + " is in notification/legacy-localization.json but NOT in "
                    + "the shipped en_IN rainmaker-pgr localisation — the parity gate is holding the "
                    + "seeded templates to a message nobody ships any more");
            assertEquals(original, copy, code + " has drifted from the shipped en_IN localisation. "
                    + "The shipped file is the original: re-copy it, and never edit the fixture to "
                    + "make a red test green — a difference here means a citizen's SMS changed.");
            compared++;
        }
        assertEquals(11, compared, "the fixture pins 11 legacy SMS messages; comparing a different "
                + "number means the copy was trimmed");
    }

    /** Which files this gate depends on, stated so removing one is a visible edit, not a silence. */
    @Test
    @DisplayName("the gate's fixture list is stated, and every entry is on the classpath")
    void everyFixtureTheGateNeedsIsPresent() throws Exception {
        List<String> fixtures = List.of(
                LegacySmsBodyParityTest.LEGACY_ROUTING,
                LegacySmsBodyParityTest.LEGACY_TEMPLATES,
                LegacySmsBodyParityTest.NEW_ROUTING,
                LegacySmsBodyParityTest.NEW_TEMPLATES,
                LegacySmsBodyParityTest.LEGACY_LOCALIZATION);
        assertEquals(5, fixtures.size());
        for (String fixture : fixtures) {
            try (InputStream in = LegacySmsBodyFixtureSyncTest.class.getClassLoader()
                    .getResourceAsStream(fixture)) {
                assertNotNull(in, fixture + " is not on the test classpath");
            }
        }
    }

    /** Jackson's {@code JsonNode.equals} is order-sensitive for arrays — exactly what is wanted. */
    private static void assertJsonEquals(Path original, String copyResource) throws Exception {
        JsonNode seed = MAPPER.readTree(original.toFile());
        JsonNode copy = LegacySmsBodyParityTest.read(copyResource);
        assertEquals(seed, copy, copyResource + " has drifted from " + original.getFileName()
                + " in utilities/default-data-handler. Re-copy it, then decide whether the legacy "
                + "SMS-body parity gate is telling you the shipped message changed.");
    }
}
