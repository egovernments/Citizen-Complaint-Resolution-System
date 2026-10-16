package org.egov.handler.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;

import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

/**
 * Pins the `common-masters.GenderType` seed to MALE and FEMALE (#2397), across every seed that
 * ships one: this module's MDMS data, the onboarding platform baseline, the canonical SQL dump
 * and the Nairobi MDMS set. They are separately maintained copies, so a value added back to one
 * of them should fail here rather than reach a fresh install unnoticed.
 */
class GenderTypeSeedPinTest {

    private static final Set<String> EXPECTED = Set.of("MALE", "FEMALE");

    private static final String BASELINE = "backend/pgr-services/src/main/resources/onboarding/platform-baseline-v1.json";
    private static final String DUMP = "local-setup/db/full-dump.sql";
    private static final String NAIROBI = "ansible/nairobi-mdms/mdms/common-masters/GenderType.json";

    /** A GenderType row of the eg_mdms_data COPY block: `...\tcommon-masters.GenderType\t{json}\t...`. */
    private static final Pattern DUMP_ROW = Pattern.compile("\\tcommon-masters\\.GenderType\\t(\\{[^\\t]*\\})\\t");

    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void theShippedResourceSeedsOnlyMaleAndFemale() throws Exception {
        try (InputStream in = getClass().getResourceAsStream("/mdmsData/common-masters/common-masters.GenderType.json")) {
            assertNotNull(in, "common-masters.GenderType.json must ship on the classpath");
            Set<String> codes = new TreeSet<>();
            mapper.readTree(in).forEach(record -> codes.add(record.path("code").asText()));
            assertEquals(EXPECTED, codes);
        }
    }

    @Test
    void everyOtherGenderSeedSeedsOnlyMaleAndFemale() throws Exception {
        Path repoRoot = repoRoot();
        // A module-only build cannot see the other seeds; skip rather than fail there.
        Assumptions.assumeTrue(repoRoot != null, "repository root not reachable from this build");
        int checked = 0;

        Path baseline = repoRoot.resolve(BASELINE);
        if (Files.exists(baseline)) {
            Set<String> codes = new TreeSet<>();
            for (JsonNode record : mapper.readTree(baseline.toFile()).path("records")) {
                if ("common-masters.GenderType".equals(record.path("schemaCode").asText())) {
                    codes.add(record.path("data").path("code").asText());
                }
            }
            assertEquals(EXPECTED, codes, BASELINE + " seeds a gender other than MALE/FEMALE");
            checked++;
        }

        Path dump = repoRoot.resolve(DUMP);
        if (Files.exists(dump)) {
            Set<String> codes = new TreeSet<>();
            for (String line : Files.readAllLines(dump)) {
                Matcher row = DUMP_ROW.matcher(line);
                if (row.find()) codes.add(mapper.readTree(row.group(1)).path("code").asText());
            }
            assertEquals(EXPECTED, codes, DUMP + " seeds a gender other than MALE/FEMALE");
            checked++;
        }

        Path nairobi = repoRoot.resolve(NAIROBI);
        if (Files.exists(nairobi)) {
            Map<String, Set<String>> byTenant = new TreeMap<>();
            for (JsonNode record : mapper.readTree(nairobi.toFile())) {
                byTenant.computeIfAbsent(record.path("tenantId").asText(), t -> new TreeSet<>())
                        .add(record.path("data").path("code").asText());
            }
            byTenant.forEach((tenant, codes) ->
                    assertEquals(EXPECTED, codes, NAIROBI + " seeds a gender other than MALE/FEMALE for " + tenant));
            checked++;
        }

        Assumptions.assumeTrue(checked > 0, "no gender seed was found on disk");
    }

    private Path repoRoot() {
        Path path = Path.of("").toAbsolutePath();
        while (path != null && !Files.exists(path.resolve("local-setup"))) {
            path = path.getParent();
        }
        return path;
    }
}
