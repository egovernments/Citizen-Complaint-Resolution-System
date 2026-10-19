package org.egov.handler.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;

import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

/**
 * No seed grants CSR action 605, `/user/users/_createnovalidate` (#2239). That endpoint creates a user with whatever
 * roles the caller sends, and every employee now holds CSR, so the grant would let any employee create a SUPERUSER.
 * The seeds are separately maintained copies, so each one is checked.
 */
class CsrCreateUserGrantPinTest {

    private static final String BASELINE = "backend/pgr-services/src/main/resources/onboarding/platform-baseline-v1.json";
    private static final String DUMP = "local-setup/db/full-dump.sql";
    private static final String NAIROBI = "ansible/nairobi-mdms/mdms/ACCESSCONTROL-ROLEACTIONS/roleactions.json";

    private final ObjectMapper mapper = new ObjectMapper();

    private static boolean csrCreateUser(JsonNode grant) {
        return "CSR".equals(grant.path("rolecode").asText()) && grant.path("actionid").asInt() == 605;
    }

    @Test
    void theShippedResourceDoesNotGrantIt() throws Exception {
        try (InputStream in = getClass().getResourceAsStream("/mdmsData/ACCESSCONTROL-ROLEACTIONS/ACCESSCONTROL-ROLEACTIONS.roleactions.json")) {
            assertNotNull(in, "ACCESSCONTROL-ROLEACTIONS.roleactions.json must ship on the classpath");
            List<JsonNode> found = new ArrayList<>();
            mapper.readTree(in).forEach(grant -> { if (csrCreateUser(grant)) found.add(grant); });
            assertEquals(List.of(), found);
        }
    }

    @Test
    void noOtherSeedGrantsIt() throws Exception {
        Path root = Path.of("").toAbsolutePath();
        while (root != null && !Files.exists(root.resolve("local-setup"))) root = root.getParent();
        // A module-only build cannot see the other seeds; skip rather than fail there.
        Assumptions.assumeTrue(root != null, "repository root not reachable from this build");
        List<String> found = new ArrayList<>();

        Path baseline = root.resolve(BASELINE);
        if (Files.exists(baseline))
            for (JsonNode record : mapper.readTree(baseline.toFile()).path("records"))
                if (csrCreateUser(record.path("data"))) found.add(BASELINE + " " + record.path("uniqueIdentifier").asText());

        Path dump = root.resolve(DUMP);
        if (Files.exists(dump))
            for (String line : Files.readAllLines(dump))
                if (line.contains("\tACCESSCONTROL-ROLEACTIONS.roleactions\t")) {
                    String json = line.split("\t")[4];
                    if (csrCreateUser(mapper.readTree(json))) found.add(DUMP + " " + line.split("\t")[1]);
                }

        Path nairobi = root.resolve(NAIROBI);
        if (Files.exists(nairobi))
            for (JsonNode record : mapper.readTree(nairobi.toFile()))
                if (csrCreateUser(record.path("data"))) found.add(NAIROBI + " " + record.path("tenantId").asText());

        assertEquals(List.of(), found);
    }
}
