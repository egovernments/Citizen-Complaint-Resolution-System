package org.egov.pgr.service.notification.golden;

import com.fasterxml.jackson.core.JsonGenerator;
import com.fasterxml.jackson.core.util.DefaultIndenter;
import com.fasterxml.jackson.core.util.DefaultPrettyPrinter;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.DisplayName;
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
 * GOLDEN MASTER for the THIN-EVENT PRODUCER (design §8.1, task T8).
 *
 * <p>Two assertions, and the pair is the point:
 *
 * <ol>
 *   <li>the real {@code NotificationService}, driven over the whole input matrix in
 *       {@code golden/inputs/scenarios.json}, publishes exactly what {@code golden-thin-events.json}
 *       records — the fixture pins the producer;</li>
 *   <li>{@code golden-thin-events.json} is exactly what {@link BridgeThinEventSpec} — a line-by-line
 *       mirror of novu-bridge's {@code ScenarioThinEventBuilder} — says the producer must emit, so
 *       the fixture is the bridge's expectation and not merely a recording of current behaviour.</li>
 * </ol>
 *
 * <p>Generated once from (1) and held to (2) forever after. A fixture regenerated to make (1) green
 * would immediately go red on (2) unless the bridge's spec really did change, which is the property
 * that makes regeneration safe to allow at all.
 *
 * <p><b>The other half of the contract lives next door.</b> {@code golden-envelopes.json} — the 57
 * pre-rendered envelopes this service published BEFORE the cutover — is deliberately unchanged and
 * still committed. It is now novu-bridge's acceptance criterion: its {@code ThinEventParityTest}
 * feeds these same scenarios through the resolution stage and must mint those envelopes. pgr-services
 * no longer produces them and no longer tests against them.
 *
 * <pre>
 *   docker run --rm -v "$PWD/backend/pgr-services":/w -v "$HOME/.m2-docker":/root/.m2 \
 *     -w /w maven:3.9-eclipse-temurin-17 \
 *     mvn -B -Dtest=GoldenThinEventCharacterisationTest -Dgolden.regenerate=true test
 * </pre>
 */
class GoldenThinEventCharacterisationTest {

    private static final String REGENERATE_PROPERTY = "golden.regenerate";

    private final ObjectMapper mapper = GoldenThinEventFixtureGenerator.newMapper();

    @Test
    @DisplayName("the real NotificationService emits exactly the committed thin events")
    void emittedThinEventsMatchTheCommittedFixture() throws Exception {
        ObjectNode actual = GoldenThinEventFixtureGenerator.generate();

        if (Boolean.getBoolean(REGENERATE_PROPERTY)) {
            Path target = Paths.get(GoldenThinEventFixtureGenerator.GOLDEN_SOURCE_PATH);
            Files.createDirectories(target.getParent());
            Files.write(target, (serialize(actual) + "\n").getBytes(StandardCharsets.UTF_8));
            System.out.println("[golden] REGENERATED " + target.toAbsolutePath()
                    + " (" + countEvents(actual) + " thin events across "
                    + actual.path("scenarios").size() + " scenarios)");
            return;
        }

        JsonNode expected = GoldenThinEventFixtureGenerator.readJson(
                mapper, GoldenThinEventFixtureGenerator.GOLDEN_RESOURCE);
        if (!expected.equals(actual)) {
            fail("The thin events published by NotificationService no longer match the committed "
                    + "golden master.\n"
                    + "If this change is NOT intended, fix the code — do NOT regenerate the fixture.\n\n"
                    + describeDifferences(expected, actual));
        }
    }

    /**
     * The independent check. {@link BridgeThinEventSpec} derives the expected event from the same
     * scenario inputs the way novu-bridge's {@code ScenarioThinEventBuilder} does, touching none of
     * this module's main code — so a bug in {@code ThinEventBuilder} cannot be laundered into the
     * fixture by a regeneration.
     */
    @Test
    @DisplayName("the committed thin events are what novu-bridge's executable spec expects")
    void theCommittedFixtureIsWhatTheBridgeSpecExpects() {
        JsonNode scenarios = GoldenThinEventFixtureGenerator.readJson(
                mapper, GoldenThinEventFixtureGenerator.SCENARIOS_RESOURCE);
        JsonNode defaults = scenarios.path("defaults");
        Map<String, JsonNode> committed = byId(GoldenThinEventFixtureGenerator.readJson(
                mapper, GoldenThinEventFixtureGenerator.GOLDEN_RESOURCE).path("scenarios"), "id");

        StringBuilder out = new StringBuilder();
        for (JsonNode scenario : scenarios.path("scenarios")) {
            String id = scenario.path("id").asText();
            ObjectNode world = GoldenThinEventFixtureGenerator.merge(
                    mapper, defaults.path("world"), scenario.path("world"));
            JsonNode expected = BridgeThinEventSpec.build(mapper, scenario.path("request"), world);

            JsonNode recorded = committed.get(id);
            if (recorded == null) {
                out.append("scenario ").append(id).append(": missing from golden-thin-events.json\n");
                continue;
            }
            if (recorded.path("events").size() != 1) {
                out.append("scenario ").append(id).append(": the spec builds ONE thin event, the "
                        + "fixture records ").append(recorded.path("events").size()).append('\n');
                continue;
            }
            JsonNode recordedEvent = recorded.path("events").get(0).path("event");
            if (!expected.equals(recordedEvent)) {
                out.append("scenario ").append(id).append(":\n");
                describeFields(out, "    ", "", expected, recordedEvent);
            }
        }
        if (out.length() > 0) {
            fail("golden-thin-events.json disagrees with novu-bridge's ScenarioThinEventBuilder "
                    + "(mirrored in BridgeThinEventSpec). Either the producer is wrong or the mirror "
                    + "is stale — check the bridge file first, then regenerate.\n\n" + out);
        }
    }

    /**
     * The fan-out is gone, and this is where that is visible: one transition in, exactly one message
     * on Kafka out. The same matrix used to publish 57 pre-rendered envelopes (and, for three
     * scenarios, none at all). Routing now happens inside the bridge, so a transition nobody is
     * routed for still produces an event — and a visible {@code SKIPPED / NB_NO_ROUTING} ledger row
     * instead of silence.
     */
    @Test
    @DisplayName("every scenario publishes exactly one thin event, on the complaints topic")
    void everyScenarioPublishesExactlyOneEventOnTheComplaintsTopic() {
        JsonNode document = GoldenThinEventFixtureGenerator.generate();
        for (JsonNode scenario : document.path("scenarios")) {
            String id = scenario.path("id").asText();
            assertEquals(1, scenario.path("events").size(),
                    "scenario " + id + " did not publish exactly one thin event");
            JsonNode row = scenario.path("events").get(0);
            assertEquals("complaints.domain.events", row.path("topic").asText(),
                    "scenario " + id + " published to an unexpected topic — the bridge consumes "
                            + "complaints.domain.events and dispatches on `kind`");
            assertEquals(row.path("event").path("tenantId").asText(), row.path("producerTenantId").asText(),
                    "scenario " + id + ": the Kafka key must stay the tenant id");
            assertEquals("THIN", row.path("event").path("kind").asText(),
                    "scenario " + id + ": the discriminator novu-bridge binds on");
        }
    }

    /**
     * Determinism proof: three independent generator runs must be byte-identical. Anything that
     * leaks wall-clock, a random id, a hash-ordered collection or cross-scenario cache state into
     * the output shows up here rather than as a flaky gate months later.
     */
    @Test
    void generatorIsDeterministicAcrossThreeRuns() throws Exception {
        String first = serialize(GoldenThinEventFixtureGenerator.generate());
        String second = serialize(GoldenThinEventFixtureGenerator.generate());
        String third = serialize(GoldenThinEventFixtureGenerator.generate());
        assertEquals(first, second, "golden generator run #2 differed from run #1");
        assertEquals(first, third, "golden generator run #3 differed from run #1");
    }

    /**
     * Coverage guard: every {@code (action, toState)} that has an ACTIVE routing row in the shipped
     * legacy seed must appear in the matrix. The seed is no longer read by this service, but it is
     * still the deployed routing data the bridge's legacy adapter converts, and the matrix is shared
     * with the bridge's parity test — so a newly seeded transition must not land uncharacterised.
     */
    @Test
    void everySeededActiveTransitionIsInTheMatrix() {
        JsonNode scenarios = GoldenThinEventFixtureGenerator.readJson(
                mapper, GoldenThinEventFixtureGenerator.SCENARIOS_RESOURCE).path("scenarios");
        Set<String> covered = new TreeSet<>();
        for (JsonNode scenario : scenarios) {
            covered.add(scenario.path("request").path("workflow").path("action").asText()
                    + "->" + scenario.path("request").path("service").path("applicationStatus").asText());
        }
        JsonNode seed = GoldenThinEventFixtureGenerator.readJson(mapper,
                GoldenThinEventFixtureGenerator.MASTERS_PREFIX + "RAINMAKER-PGR.NotificationRouting.json");
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

    /** A readable, per-scenario report of the first differences found. */
    private String describeDifferences(JsonNode expected, JsonNode actual) {
        StringBuilder out = new StringBuilder();
        Map<String, JsonNode> expectedScenarios = byId(expected.path("scenarios"), "id");
        Map<String, JsonNode> actualScenarios = byId(actual.path("scenarios"), "id");

        for (String header : List.of("$comment", "generator", "inputs", "contract")) {
            if (!expected.path(header).equals(actual.path(header))) {
                out.append("document.").append(header).append(": expected ").append(render(expected.path(header)))
                        .append(" but was ").append(render(actual.path(header))).append('\n');
            }
        }
        for (String id : minus(expectedScenarios.keySet(), actualScenarios.keySet())) {
            out.append("scenario ").append(id).append(": MISSING from the generated output\n");
        }
        for (String id : minus(actualScenarios.keySet(), expectedScenarios.keySet())) {
            out.append("scenario ").append(id).append(": NEW in the generated output\n");
        }
        for (Map.Entry<String, JsonNode> entry : expectedScenarios.entrySet()) {
            JsonNode actualScenario = actualScenarios.get(entry.getKey());
            if (actualScenario == null || actualScenario.equals(entry.getValue())) continue;
            out.append("scenario ").append(entry.getKey()).append(":\n");
            if (entry.getValue().path("eventCount").asInt() != actualScenario.path("eventCount").asInt()) {
                out.append("    eventCount: expected ").append(entry.getValue().path("eventCount").asInt())
                        .append(" but was ").append(actualScenario.path("eventCount").asInt()).append('\n');
            }
            describeFields(out, "    ", "", entry.getValue().path("events").path(0),
                    actualScenario.path("events").path(0));
        }
        return out.length() == 0 ? "(no field-level differences found — compare the files directly)"
                : out.toString();
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
        return node.isMissingNode() ? "(absent)" : node.toString();
    }

    private static Map<String, JsonNode> byId(JsonNode array, String field) {
        Map<String, JsonNode> out = new LinkedHashMap<>();
        for (JsonNode node : array) out.put(node.path(field).asText(), node);
        return out;
    }

    private static List<String> minus(Set<String> left, Set<String> right) {
        List<String> out = new ArrayList<>(left);
        out.removeAll(right);
        return out;
    }

    private static int countEvents(JsonNode document) {
        int total = 0;
        for (JsonNode scenario : document.path("scenarios")) total += scenario.path("eventCount").asInt();
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
