package org.egov.novubridge.service.resolution.golden;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.egov.novubridge.service.EnvelopeValidator;
import org.egov.novubridge.service.thin.ThinEventValidator;
import org.egov.novubridge.web.models.ThinEvent;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * <b>The cross-module link nothing else sees.</b>
 *
 * <p>Three tests hold the cutover together, and until this one existed the chain had a gap in the
 * middle that no build could notice:
 *
 * <ol>
 *   <li>{@code pgr-services}' {@code GoldenThinEventCharacterisationTest}: the REAL producer emits
 *       exactly {@code golden-thin-events.json}.</li>
 *   <li>the same test, second assertion: that file equals {@code BridgeThinEventSpec} — a
 *       <b>hand-written mirror</b> of this module's {@link ScenarioThinEventBuilder}, copied at
 *       commit {@code 350f4c38}.</li>
 *   <li>this module's {@link ThinEventParityTest}: the events {@link ScenarioThinEventBuilder}
 *       builds resolve into exactly {@code golden-envelopes.json}.</li>
 * </ol>
 *
 * <p>Step (2) is a COPY, in the other module, of a class in this one. Nothing compiles both, so
 * editing {@link ScenarioThinEventBuilder} here leaves the mirror stale and every test stays green
 * while the two halves of the contract have quietly parted. This closes it: when
 * {@code backend/pgr-services} is in the build context, the REAL builder is run over every scenario
 * and its output compared with what the real producer actually emitted.
 *
 * <p>The chain then reads end to end — <i>pgr producer == fixture == bridge spec, and bridge spec
 * -> envelopes == golden envelopes</i> — with no hand-maintained link in it that a build cannot
 * check.
 *
 * <p>In the normal single-module run {@code ../pgr-services} does not exist, so both tests
 * <b>SKIP</b> loudly, exactly as {@link GoldenFixtureSyncTest} does.
 */
class PgrThinEventFixtureParityTest {

    /** The fixture pgr-services generates from its real producer. Same relative path convention as
     *  {@link GoldenFixtureSyncTest}: surefire's working directory is the module dir. */
    private static final Path PGR_THIN_EVENTS = Paths.get("..", "pgr-services", "src", "test",
            "resources", "golden", "golden-thin-events.json");

    private static final int SCENARIOS = 26;

    /**
     * Nulls are OMITTED, not written. The fixture's README states it as a rule: the bridge binds
     * the wire form to {@link ThinEvent}, where absent and null are the same thing, and omitting
     * keeps contact detail the producer does not hold off the broker entirely.
     */
    private static final ObjectMapper WIRE = new ObjectMapper()
            .setSerializationInclusion(JsonInclude.Include.NON_NULL);

    /** Strict: an unknown field in the fixture means the wire form and the model have parted. */
    private static final ObjectMapper STRICT = new ObjectMapper();

    /**
     * The two fields the fixture normalises, because main code generates them from non-injectable
     * sources ({@code UUID.randomUUID()} and {@code Instant.now()}, inline). Asserted rather than
     * assumed, so the set of un-compared fields cannot grow without this test noticing.
     */
    private static final Map<String, String> NORMALISED = Map.of(
            "event.eventId", "<uuid>",
            "event.eventTime", "<timestamp>");

    @Test
    @DisplayName("the REAL ScenarioThinEventBuilder reproduces every event pgr-services emits")
    void theBridgeSpecMatchesWhatPgrActuallyEmits() throws Exception {
        JsonNode fixture = readFixture();
        JsonNode scenarios = ThinEventParityTest.read("golden/inputs/scenarios.json");

        assertEquals(NORMALISED, normalisedFields(fixture),
                "golden-thin-events.json normalises a different set of fields than this test "
                        + "excludes from the comparison — a field may have stopped being compared");

        Map<String, JsonNode> expectedById = new LinkedHashMap<>();
        fixture.path("scenarios").forEach(s -> expectedById.put(s.path("id").asText(), s));
        assertEquals(SCENARIOS, scenarios.path("scenarios").size(), "the matrix is 26 scenarios");
        assertEquals(SCENARIOS, expectedById.size(),
                "the fixture must record one entry per scenario");

        List<String> failures = new ArrayList<>();
        int eventsCompared = 0;
        for (JsonNode scenario : scenarios.path("scenarios")) {
            String id = scenario.path("id").asText();
            JsonNode expectedScenario = expectedById.get(id);
            assertNotNull(expectedScenario, id + " has no recorded thin event");

            JsonNode expectedEvents = expectedScenario.path("events");
            assertEquals(expectedScenario.path("eventCount").asInt(-1), expectedEvents.size(),
                    id + ": the fixture's own eventCount disagrees with its events[]");
            // A transition publishes exactly one event; that is the whole shape of the thin path.
            assertEquals(1, expectedEvents.size(), id + ": a transition publishes exactly one event");

            JsonNode recorded = expectedEvents.get(0);
            JsonNode expected = recorded.path("event");
            assertEquals(expected.path("tenantId").asText(), recorded.path("producerTenantId").asText(),
                    id + ": the tenant handed to Producer.push must be the event's own tenant");
            assertFalse(recorded.path("topic").asText("").isBlank(), id + ": the topic is on the wire too");

            ScenarioWorld world = new ScenarioWorld(
                    merge(scenarios.path("defaults").path("world"), scenario.path("world")));
            ThinEvent built = ScenarioThinEventBuilder.build(scenario.path("request"), world);

            ObjectNode actual = (ObjectNode) WIRE.valueToTree(built);
            normalise(actual, id);

            eventsCompared++;
            // Jackson: object equality ignores field order, array equality does not — which is
            // exactly the rule the fixture's own ordering note asks for.
            if (!expected.equals(actual)) {
                failures.add(id + ":\n  expected " + expected.toPrettyString()
                        + "\n  actual   " + actual.toPrettyString());
            }
        }
        assertTrue(failures.isEmpty(), "backend/pgr-services/src/test/resources/golden/"
                + "golden-thin-events.json is what the REAL producer emits; this module's "
                + "ScenarioThinEventBuilder no longer agrees with it.\n\nIf ScenarioThinEventBuilder "
                + "changed on purpose, update pgr-services' BridgeThinEventSpec mirror with it and "
                + "regenerate the fixture — never the other way round.\n\n"
                + String.join("\n\n", failures));
        assertEquals(SCENARIOS, eventsCompared, "all 26 recorded events must be compared");
    }

    /**
     * The fixture is also a corpus of real wire forms, so run the real gatekeeper over it: every
     * one of the 26 must bind to {@link ThinEvent} with no unknown fields and be ACCEPTED by
     * {@link ThinEventValidator}. A producer change that dropped a required field, or moved off the
     * {@code novu.bridge.event.types} allowlist, would be rejected at the consumer in production —
     * and would be rejected here first.
     */
    @Test
    @DisplayName("all 26 recorded events deserialize and pass the real ThinEventValidator")
    void everyRecordedEventIsAcceptedByTheRealValidator() throws Exception {
        JsonNode fixture = readFixture();
        ThinEventValidator validator = new ThinEventValidator(new EnvelopeValidator());

        int validated = 0;
        for (JsonNode scenario : fixture.path("scenarios")) {
            for (JsonNode recorded : scenario.path("events")) {
                String id = scenario.path("id").asText();
                ThinEvent event = STRICT.treeToValue(recorded.path("event"), ThinEvent.class);
                assertEquals(ThinEvent.KIND, event.getKind(), id + ": a thin event declares its kind");
                validator.validate(event);   // throws CustomException on rejection
                // The two derived values every ledger row is keyed on. A validated event must have
                // both, and the producer names both explicitly rather than taking the fallback.
                assertNotNull(event.resolvedTransactionSeed(), id + ": no idempotency seed");
                assertNotNull(event.resolvedLedgerEventName(), id + ": no ledger event name");
                validated++;
            }
        }
        assertEquals(SCENARIOS, validated,
                "the fixture records 26 events; all must be run through the validator");
    }

    // ---- plumbing ------------------------------------------------------------------------------

    private static JsonNode readFixture() throws Exception {
        Assumptions.assumeTrue(Files.isRegularFile(PGR_THIN_EVENTS),
                "backend/pgr-services is not in this build context — there is no producer-side "
                        + "fixture to compare against, and that is not a fault");
        return STRICT.readTree(Files.readString(PGR_THIN_EVENTS, StandardCharsets.UTF_8));
    }

    private static Map<String, String> normalisedFields(JsonNode fixture) {
        Map<String, String> out = new LinkedHashMap<>();
        fixture.path("normalisedFields").fields()
                .forEachRemaining(e -> out.put(e.getKey(), e.getValue().asText()));
        return out;
    }

    /**
     * Replace the two non-injectable fields with the fixture's placeholders — after checking the
     * built value still has the right SHAPE, so a change from a generated id to something else, or
     * from an ISO-8601 instant to something else, still fails.
     */
    private static void normalise(ObjectNode event, String scenarioId) {
        String eventId = event.path("eventId").asText("");
        assertFalse(eventId.isBlank(), scenarioId + ": eventId is required and must be generated");
        event.put("eventId", NORMALISED.get("event.eventId"));

        String eventTime = event.path("eventTime").asText("");
        assertTrue(eventTime.endsWith("Z"),
                scenarioId + ": eventTime must still be an ISO-8601 instant in UTC, got " + eventTime);
        event.put("eventTime", NORMALISED.get("event.eventTime"));
    }

    /** Scenario overrides replace a key wholesale, exactly as the fixture's contract says. */
    private static JsonNode merge(JsonNode base, JsonNode override) {
        if (!override.isObject()) {
            return base;
        }
        ObjectNode merged = (ObjectNode) base.deepCopy();
        override.fields().forEachRemaining(e -> merged.set(e.getKey(), e.getValue()));
        return merged;
    }
}
