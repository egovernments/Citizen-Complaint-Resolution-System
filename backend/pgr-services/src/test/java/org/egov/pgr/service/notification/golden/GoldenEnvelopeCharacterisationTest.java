package org.egov.pgr.service.notification.golden;

import com.fasterxml.jackson.core.JsonGenerator;
import com.fasterxml.jackson.core.util.DefaultIndenter;
import com.fasterxml.jackson.core.util.DefaultPrettyPrinter;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

/**
 * GOLDEN MASTER / CHARACTERISATION GATE (task T9, design §8.1).
 *
 * <p>Pins what {@code NotificationService} publishes TODAY, for the whole input matrix in
 * {@code golden/inputs/scenarios.json}, to the committed
 * {@code golden/golden-envelopes.json}. When the routing/recipient/rendering/envelope-minting code
 * moves into novu-bridge, the bridge-side parity test replays the SAME inputs and must produce the
 * SAME envelopes (modulo the four intended differences in design §8.3).
 *
 * <p><b>This test is not allowed to be "fixed" by regenerating the fixture.</b> A red here means the
 * observable notification contract changed. Regenerate only when that change is intended, reviewed
 * and described in the commit message:
 *
 * <pre>
 *   docker run --rm -v "$PWD/backend/pgr-services":/w -v "$HOME/.m2-docker":/root/.m2 \
 *     -w /w maven:3.9-eclipse-temurin-17 \
 *     mvn -B -Dtest=GoldenEnvelopeCharacterisationTest -Dgolden.regenerate=true test
 * </pre>
 */
class GoldenEnvelopeCharacterisationTest {

    private static final String REGENERATE_PROPERTY = "golden.regenerate";

    private final ObjectMapper mapper = GoldenEnvelopeFixtureGenerator.newMapper();

    @Test
    void capturedEnvelopesMatchTheCommittedGoldenMaster() throws Exception {
        ObjectNode actual = GoldenEnvelopeFixtureGenerator.generate();

        if (Boolean.getBoolean(REGENERATE_PROPERTY)) {
            Path target = Paths.get(GoldenEnvelopeFixtureGenerator.GOLDEN_SOURCE_PATH);
            Files.createDirectories(target.getParent());
            Files.write(target, (serialize(actual) + "\n").getBytes(StandardCharsets.UTF_8));
            System.out.println("[golden] REGENERATED " + target.toAbsolutePath()
                    + " (" + countEnvelopes(actual) + " envelopes across "
                    + actual.path("scenarios").size() + " scenarios)");
            return;
        }

        JsonNode expected = GoldenEnvelopeFixtureGenerator.readJson(
                mapper, GoldenEnvelopeFixtureGenerator.GOLDEN_RESOURCE);
        if (!expected.equals(actual)) {
            fail("The notification envelopes published by NotificationService no longer match the "
                    + "committed golden master.\n"
                    + "If this change is NOT intended, fix the code — do NOT regenerate the fixture.\n\n"
                    + describeDifferences(expected, actual));
        }
    }

    /**
     * Determinism proof: three independent generator runs must be byte-identical. Anything that
     * leaks wall-clock, a random id, a hash-ordered collection or cross-scenario cache state into
     * the output shows up here rather than as a flaky gate months later.
     */
    @Test
    void generatorIsDeterministicAcrossThreeRuns() throws Exception {
        String first = serialize(GoldenEnvelopeFixtureGenerator.generate());
        String second = serialize(GoldenEnvelopeFixtureGenerator.generate());
        String third = serialize(GoldenEnvelopeFixtureGenerator.generate());
        assertEquals(first, second, "golden generator run #2 differed from run #1");
        assertEquals(first, third, "golden generator run #3 differed from run #1");
    }

    /**
     * Coverage guard: every {@code (action, toState)} that has an ACTIVE routing row in the shipped
     * seed must appear in the matrix, so a new seeded transition cannot land uncharacterised.
     */
    @Test
    void everySeededActiveTransitionIsInTheMatrix() {
        JsonNode scenarios = GoldenEnvelopeFixtureGenerator.readJson(
                mapper, GoldenEnvelopeFixtureGenerator.SCENARIOS_RESOURCE).path("scenarios");
        Set<String> covered = new TreeSet<>();
        for (JsonNode scenario : scenarios) {
            covered.add(scenario.path("request").path("workflow").path("action").asText()
                    + "->" + scenario.path("request").path("service").path("applicationStatus").asText());
        }
        JsonNode seed = GoldenEnvelopeFixtureGenerator.readJson(mapper,
                GoldenEnvelopeFixtureGenerator.MASTERS_PREFIX + "RAINMAKER-PGR.NotificationRouting.json");
        Set<String> seeded = new TreeSet<>();
        for (JsonNode row : seed) {
            if (row.path("active").asBoolean(true)) {
                seeded.add(row.path("action").asText() + "->" + row.path("toState").asText());
            }
        }
        assertTrue(covered.containsAll(seeded),
                "transitions with an active seeded routing row but no golden scenario: "
                        + minus(seeded, covered) + " — add a scenario to golden/inputs/scenarios.json");
    }

    // ------------------------------------------------------------------------------------------
    // reporting
    // ------------------------------------------------------------------------------------------

    /** A readable, per-envelope report of the first differences found. */
    private String describeDifferences(JsonNode expected, JsonNode actual) {
        StringBuilder out = new StringBuilder();
        Map<String, JsonNode> expectedScenarios = byId(expected.path("scenarios"), "id");
        Map<String, JsonNode> actualScenarios = byId(actual.path("scenarios"), "id");

        for (String header : List.of("$comment", "generator", "inputs", "envelopeOrdering")) {
            compareScalar(out, "document." + header, expected.path(header), actual.path(header));
        }
        if (!expected.path("normalisedFields").equals(actual.path("normalisedFields"))) {
            out.append("document.normalisedFields: expected ").append(expected.path("normalisedFields"))
                    .append(" but was ").append(actual.path("normalisedFields")).append('\n');
        }
        for (String id : minus(expectedScenarios.keySet(), actualScenarios.keySet())) {
            out.append("scenario ").append(id).append(": MISSING from the generated output\n");
        }
        for (String id : minus(actualScenarios.keySet(), expectedScenarios.keySet())) {
            out.append("scenario ").append(id).append(": NEW in the generated output (")
                    .append(actualScenarios.get(id).path("envelopeCount").asInt()).append(" envelopes)\n");
        }
        for (Map.Entry<String, JsonNode> entry : expectedScenarios.entrySet()) {
            JsonNode actualScenario = actualScenarios.get(entry.getKey());
            if (actualScenario == null) continue;
            describeScenario(out, entry.getKey(), entry.getValue(), actualScenario);
        }
        return out.length() == 0 ? "(no field-level differences found — compare the files directly)"
                : out.toString();
    }

    private void describeScenario(StringBuilder out, String id, JsonNode expected, JsonNode actual) {
        if (expected.path("envelopeCount").asInt() != actual.path("envelopeCount").asInt()) {
            out.append("scenario ").append(id).append(": envelopeCount expected ")
                    .append(expected.path("envelopeCount").asInt()).append(" but was ")
                    .append(actual.path("envelopeCount").asInt()).append('\n');
        }
        if (!expected.path("emissionOrder").equals(actual.path("emissionOrder"))) {
            out.append("scenario ").append(id).append(": emissionOrder expected ")
                    .append(expected.path("emissionOrder")).append("\n    but was ")
                    .append(actual.path("emissionOrder")).append('\n');
        }
        Map<String, JsonNode> expectedEnvelopes = byTransaction(expected.path("envelopes"));
        Map<String, JsonNode> actualEnvelopes = byTransaction(actual.path("envelopes"));
        for (String txn : minus(expectedEnvelopes.keySet(), actualEnvelopes.keySet())) {
            out.append("scenario ").append(id).append(": envelope NO LONGER PUBLISHED: ").append(txn).append('\n');
        }
        for (String txn : minus(actualEnvelopes.keySet(), expectedEnvelopes.keySet())) {
            out.append("scenario ").append(id).append(": UNEXPECTED new envelope: ").append(txn).append('\n');
        }
        for (Map.Entry<String, JsonNode> entry : expectedEnvelopes.entrySet()) {
            JsonNode actualEnvelope = actualEnvelopes.get(entry.getKey());
            if (actualEnvelope == null || actualEnvelope.equals(entry.getValue())) continue;
            out.append("scenario ").append(id).append(": envelope ").append(entry.getKey()).append('\n');
            describeFields(out, "    ", "", entry.getValue(), actualEnvelope);
        }
    }

    private void describeFields(StringBuilder out, String indent, String path, JsonNode expected, JsonNode actual) {
        Set<String> fields = new LinkedHashSet<>();
        expected.fieldNames().forEachRemaining(fields::add);
        actual.fieldNames().forEachRemaining(fields::add);
        for (String field : fields) {
            JsonNode e = expected.path(field);
            JsonNode a = actual.path(field);
            if (e.equals(a)) continue;
            String full = path.isEmpty() ? field : path + "." + field;
            if (e.isObject() && a.isObject()) {
                describeFields(out, indent, full, e, a);
            } else {
                out.append(indent).append(full).append(":\n")
                        .append(indent).append("  expected: ").append(render(e)).append('\n')
                        .append(indent).append("  actual:   ").append(render(a)).append('\n');
            }
        }
    }

    private static String render(JsonNode node) {
        if (node.isMissingNode()) return "(absent)";
        return node.toString();
    }

    private void compareScalar(StringBuilder out, String label, JsonNode expected, JsonNode actual) {
        if (!expected.equals(actual)) {
            out.append(label).append(": expected ").append(render(expected))
                    .append(" but was ").append(render(actual)).append('\n');
        }
    }

    private static Map<String, JsonNode> byId(JsonNode array, String field) {
        Map<String, JsonNode> out = new LinkedHashMap<>();
        for (JsonNode node : array) out.put(node.path(field).asText(), node);
        return out;
    }

    private static Map<String, JsonNode> byTransaction(JsonNode envelopes) {
        Map<String, JsonNode> out = new LinkedHashMap<>();
        for (JsonNode node : envelopes) {
            out.put(node.path("event").path("transactionId").asText("(no transactionId)"), node);
        }
        return out;
    }

    private static List<String> minus(Set<String> left, Set<String> right) {
        List<String> out = new ArrayList<>(left);
        out.removeAll(right);
        return out;
    }

    private static int countEnvelopes(JsonNode document) {
        int total = 0;
        for (JsonNode scenario : document.path("scenarios")) total += scenario.path("envelopeCount").asInt();
        return total;
    }

    /** Stable, OS-independent pretty printing so the committed file never churns on line endings. */
    private String serialize(JsonNode document) throws Exception {
        return mapper.writer(new GoldenPrettyPrinter()).writeValueAsString(document);
    }

    /** Two-space indent, "\n" everywhere (never the platform separator), {@code "key": value}. */
    static final class GoldenPrettyPrinter extends DefaultPrettyPrinter {
        GoldenPrettyPrinter() {
            DefaultIndenter indenter = new DefaultIndenter("  ", "\n");
            indentObjectsWith(indenter);
            indentArraysWith(indenter);
        }

        GoldenPrettyPrinter(GoldenPrettyPrinter base) {
            super(base);
        }

        @Override
        public DefaultPrettyPrinter createInstance() {
            return new GoldenPrettyPrinter(this);
        }

        @Override
        public void writeObjectFieldValueSeparator(JsonGenerator generator) throws IOException {
            generator.writeRaw(": ");
        }
    }
}
