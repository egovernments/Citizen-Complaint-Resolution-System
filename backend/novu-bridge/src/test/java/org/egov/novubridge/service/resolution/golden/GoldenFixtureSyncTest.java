package org.egov.novubridge.service.resolution.golden;

import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

/**
 * The golden fixture exists twice, and the two copies must be the same bytes.
 *
 * <p>The original lives in {@code backend/pgr-services/src/test/resources/golden/}, where it is
 * GENERATED — a run of the real producer captures what it publishes. The copy under this module's
 * test resources exists because the Docker test runner mounts one module at a time, so a
 * bridge-side test cannot reach the other module's tree at all.
 *
 * <p>A copy that silently drifts is worse than no copy: the parity test would keep passing against
 * an expectation nobody regenerated, which is exactly the failure a characterisation fixture is
 * supposed to make impossible. So this compares them byte for byte when both are on disk, and
 * <b>SKIPS</b> — loudly, with a reason — when only one is, because "the other module is not in
 * this build context" is not a fault.
 *
 * <p>The same rule applies to the committed {@code NOTIFICATIONS.*} default data, which
 * {@link LegacyMasterAdapterConversionTest} compares the Java read-adapter against: if those files
 * change, this module's copy has to change with them or the adapter is being held to a stale
 * answer.
 */
class GoldenFixtureSyncTest {

    private static final Path PGR_GOLDEN =
            Paths.get("..", "pgr-services", "src", "test", "resources", "golden");
    private static final Path NOTIFICATIONS_DEFAULTS = Paths.get("..", "..", "utilities",
            "default-data-handler", "src", "main", "resources", "mdmsData-dev", "NOTIFICATIONS");

    @Test
    @DisplayName("the copied golden inputs and envelopes are byte-identical to pgr-services'")
    void theGoldenCopyHasNotDrifted() {
        Assumptions.assumeTrue(Files.isDirectory(PGR_GOLDEN),
                "backend/pgr-services is not in this build context — the copy is all this module has, "
                        + "and it is what the parity test runs against");

        List<String> files = List.of(
                "golden-envelopes.json",
                "inputs/scenarios.json",
                "inputs/masters/RAINMAKER-PGR.NotificationRouting.json",
                "inputs/masters/RAINMAKER-PGR.NotificationTemplate.json",
                "inputs/masters/RAINMAKER-PGR.NotificationProviderTemplate.json",
                "inputs/masters/RAINMAKER-PGR.NotificationChannel.json");
        for (String file : files) {
            assertEquals(read(PGR_GOLDEN.resolve(file)), classpath("golden/" + file),
                    file + " has drifted from backend/pgr-services/src/test/resources/golden/.\n"
                            + "The pgr-services copy is the GENERATED original: re-copy it, and never "
                            + "edit either one to make a red test green — a difference here means the "
                            + "observable notification contract changed.");
        }
    }

    @Test
    @DisplayName("the copied NOTIFICATIONS.* defaults are byte-identical to the seeded originals")
    void theSeedCopyHasNotDrifted() {
        Assumptions.assumeTrue(Files.isDirectory(NOTIFICATIONS_DEFAULTS),
                "utilities/default-data-handler is not in this build context");

        for (String file : List.of("NOTIFICATIONS.Routing.json", "NOTIFICATIONS.Template.json",
                "NOTIFICATIONS.ProviderTemplate.json", "NOTIFICATIONS.Channel.json",
                "NOTIFICATIONS.EventCatalogue.json")) {
            assertEquals(read(NOTIFICATIONS_DEFAULTS.resolve(file)), classpath("golden/expected/" + file),
                    file + " has drifted from the seeded default data. The Java read-adapter is "
                            + "asserted to produce exactly these rows from the legacy seed; holding it "
                            + "to a stale copy proves nothing.");
        }
    }

    private static String read(Path path) {
        try {
            return Files.readString(path, StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    private static String classpath(String resource) {
        try (InputStream in = GoldenFixtureSyncTest.class.getClassLoader().getResourceAsStream(resource)) {
            assertNotNull(in, resource + " is not on the test classpath");
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }
}
