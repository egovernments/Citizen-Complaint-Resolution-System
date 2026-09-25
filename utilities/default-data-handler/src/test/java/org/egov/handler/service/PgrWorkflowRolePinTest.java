package org.egov.handler.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;

import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

/**
 * Pins the authorized roles on the PENDINGATLME transitions, across every seed that ships one.
 *
 * <p>This role set has now drifted twice through review-response commits inside larger PRs:
 * `GRO` was added to RESOLVE/REASSIGN in faee86496 (#2049) and reverted in #2146, and
 * `PGR_VIEWER` arrived in abe387c7c with no PR and no recorded rationale. Neither change was
 * the headline of its PR, so neither got looked at. `check-seed-dump-sync.sh` cannot catch
 * this: it only byte-diffs the canonical dump against its gzipped copy, so a role added to
 * all sources at once passes cleanly.</p>
 *
 * <p>PENDINGATLME is the state where the distinction matters. GRO routes a complaint and can
 * reject it from the queue states; once it is assigned it belongs to the resolver. A change
 * here should be deliberate, so this test exists to make someone edit an expectation rather
 * than widen a permission in passing.</p>
 *
 * <p>The three template sources must also agree with each other — they are separately
 * maintained copies of the same BusinessService, and a fix applied to only one of them is its
 * own recurring bug.</p>
 */
class PgrWorkflowRolePinTest {

    /** Repo-relative paths of every seed carrying the PGR BusinessService as JSON. */
    private static final List<String> WORKFLOW_SOURCES = List.of(
            "utilities/default-data-handler/src/main/resources/PgrWorkflowConfig.json",
            "utilities/crs_dataloader/templates/PgrWorkflowConfig.json",
            "local-setup/dataloader/templates/PgrWorkflowConfig.json");

    private static final String STATE = "PENDINGATLME";

    /** The canonical authorization for each action on PENDINGATLME. Change deliberately. */
    private static final Map<String, List<String>> EXPECTED_ROLES = Map.of(
            "RESOLVE", List.of("PGR_LME", "PGR_VIEWER"),
            "REASSIGN", List.of("PGR_LME", "PGR_VIEWER"),
            "ESCALATE", List.of("PGR_LME", "PGR_VIEWER", "SYSTEM"),
            "COMMENT", List.of("CITIZEN"));

    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void everyWorkflowSeedPinsThePendingAtLmeRoles() throws Exception {
        Path repoRoot = repoRoot();
        // A module-only build (or a container mounting just this module) cannot see the
        // sibling templates. Skip rather than fail: theShippedResourceMatchesTheCanonical
        // RoleSet still pins the copy that actually ships.
        Assumptions.assumeTrue(repoRoot != null, "repository root not reachable from this build");
        int checked = 0;

        for (String source : WORKFLOW_SOURCES) {
            Path path = repoRoot.resolve(source);
            if (!Files.exists(path)) {
                // The DDH resource is always present; the two dataloader templates are only
                // on disk in a full checkout. Skip rather than fail so the module's tests
                // still run from a partial one.
                continue;
            }
            assertEquals(EXPECTED_ROLES, rolesOnState(mapper.readTree(path.toFile())),
                    source + " drifted from the canonical " + STATE + " role set");
            checked++;
        }

        Assumptions.assumeTrue(checked > 0, "no PGR workflow seed was found on disk");
    }

    @Test
    void theShippedResourceMatchesTheCanonicalRoleSet() throws Exception {
        // Guards the one source that is always on the classpath, so the pin holds even when
        // the test above finds no templates on disk.
        try (InputStream in = getClass().getResourceAsStream("/PgrWorkflowConfig.json")) {
            assertNotNull(in, "PgrWorkflowConfig.json must ship on the classpath");
            assertEquals(EXPECTED_ROLES, rolesOnState(mapper.readTree(in)));
        }
    }

    /** action -> sorted roles, for every action defined on PENDINGATLME. */
    private Map<String, List<String>> rolesOnState(JsonNode root) {
        Map<String, List<String>> actual = new LinkedHashMap<>();
        for (JsonNode service : root.path("BusinessServices")) {
            for (JsonNode state : service.path("states")) {
                if (!STATE.equals(state.path("state").asText())) {
                    continue;
                }
                for (JsonNode action : state.path("actions")) {
                    List<String> roles = new ArrayList<>();
                    action.path("roles").forEach(role -> roles.add(role.asText()));
                    roles.sort(String::compareTo);
                    actual.put(action.path("action").asText(), roles);
                }
            }
        }
        return actual;
    }

    /** Walks up from the module directory to the repository root, or null if it is not there. */
    private Path repoRoot() {
        Path path = Path.of("").toAbsolutePath();
        while (path != null && !Files.exists(path.resolve("local-setup"))) {
            path = path.getParent();
        }
        return path;
    }
}
