package org.egov.novubridge.contract;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.networknt.schema.JsonSchema;
import com.networknt.schema.JsonSchemaFactory;
import com.networknt.schema.SpecVersion;
import com.networknt.schema.ValidationMessage;
import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.service.EnvelopeValidator;
import org.egov.novubridge.service.thin.ThinEventValidator;
import org.egov.novubridge.web.models.ActorRef;
import org.egov.novubridge.web.models.ThinEvent;
import org.egov.tracer.model.CustomException;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * The published thin-event contract and the code that enforces it, held against each other.
 * Deliberately the same four properties {@code EnvelopeContractSchemaTest} proves for the
 * envelope, because the thin event is a public interface on exactly the same terms:
 *
 * <ol>
 *   <li>the schema parses as JSON Schema 2020-12 and every published example validates;</li>
 *   <li>the schema's {@code required} set is EXACTLY what {@link ThinEventValidator} enforces —
 *       proved in both directions, by removing every field in turn rather than by repeating a
 *       list that could drift alongside the other two;</li>
 *   <li>every JSON field of {@link ThinEvent} and {@link ActorRef} is described by the schema, so
 *       a field added to a model cannot go unpublished;</li>
 *   <li>the tolerances and divergences are stated as tests rather than left as folklore.</li>
 * </ol>
 */
class ThinEventContractSchemaTest {

    /**
     * The mapper the SERVICE actually runs with. Spring Boot's builder disables
     * FAIL_ON_UNKNOWN_PROPERTIES, which is what {@code additionalProperties: true} claims; a bare
     * {@code new ObjectMapper()} would be stricter than production and would make this suite
     * agree with itself rather than with the running bridge.
     */
    private static final ObjectMapper MAPPER =
            org.springframework.http.converter.json.Jackson2ObjectMapperBuilder.json().build();

    /**
     * The probe payload for the field-by-field work below: the richest example whose
     * {@code eventType} the DEFAULT allowlist accepts, so a removal that trips the validator can
     * only be the removal and never the allowlist.
     */
    private static final String PROBE_EXAMPLE = "02-pgr-assign.json";

    private final JsonSchema schema = JsonSchemaFactory
            .getInstance(SpecVersion.VersionFlag.V202012)
            .getSchema(ContractResources.packaged(ContractResources.THIN_SCHEMA));

    private final ThinEventValidator validator = new ThinEventValidator(new EnvelopeValidator());

    // ---- the schema itself -------------------------------------------------

    @Test
    @DisplayName("the packaged thin-event schema declares 2020-12 and describes an object")
    void schemaIsWellFormed() throws Exception {
        JsonNode raw = MAPPER.readTree(ContractResources.packaged(ContractResources.THIN_SCHEMA));
        assertEquals("https://json-schema.org/draft/2020-12/schema", raw.get("$schema").asText());
        assertEquals("object", raw.get("type").asText());
        assertTrue(raw.get("properties").size() >= 15, "the thin event has more fields than this");
        assertTrue(raw.has("$defs") && raw.get("$defs").has("actorRef"),
                "the actor reference must be a named definition — actors and recipients share it");
    }

    // ---- the examples ------------------------------------------------------

    @Test
    @DisplayName("every published thin example validates against the schema")
    void examplesValidate() throws Exception {
        List<String> names = ContractResources.thinExampleNames();
        assertEquals(4, names.size(), "the contract publishes four thin examples; found " + names);
        for (String name : names) {
            JsonNode node = MAPPER.readTree(
                    ContractResources.packaged(ContractResources.THIN_EXAMPLES_DIR + "/" + name));
            assertEquals(Set.of(), schema.validate(node), name + " does not validate");
        }
    }

    @Test
    @DisplayName("every published thin example is a real wire payload: it deserializes and the validator takes it")
    void examplesAreAcceptedByTheValidator() throws Exception {
        // The XYZ example names an eventType no deployment accepts by default — that IS the
        // onboarding step a new producer goes through — so the validator is given the allowlist
        // such a deployment would carry.
        ThinEventValidator permissive = validatorAccepting(
                "COMPLAINTS_WORKFLOW_TRANSITIONED", "CORE_SMS", "XYZ_LICENCE_EVENT");
        for (String name : ContractResources.thinExampleNames()) {
            ThinEvent event = MAPPER.readValue(
                    ContractResources.packaged(ContractResources.THIN_EXAMPLES_DIR + "/" + name),
                    ThinEvent.class);
            permissive.validate(event);   // throws on refusal
        }
    }

    @Test
    @DisplayName("each thin example covers the shape it is published for")
    void examplesCoverTheDocumentedShapes() throws Exception {
        JsonNode apply = probe("01-pgr-apply.json");
        assertEquals("COMPLAINTS.WORKFLOW.APPLY.PENDINGFORASSIGNMENT", apply.get("eventName").asText());
        assertTrue(apply.get("actors").has("citizen"), "the APPLY example names the citizen actor");

        JsonNode assign = probe("02-pgr-assign.json");
        assertTrue(assign.get("actors").has("assignee"),
                "the ASSIGN example must name the assignee — the one recipient the box cannot reconstruct");

        JsonNode other = probe("03-module-neutral.json");
        assertEquals("XYZ", other.get("module").asText());
        assertTrue(other.get("localized").get("licence_status").isTextual(),
                "one example must carry the bare-string form of a localized token");
        assertTrue(other.has("dataByLocale"), "one example must exercise the per-locale override");

        JsonNode accountless = probe("04-contact-override.json");
        assertFalse(accountless.has("actors"),
                "the account-less example has nobody to name: its recipient has no user record");
        assertTrue(accountless.get("recipients").get(0).hasNonNull("phone"),
                "the account-less example must carry the contact inline");
    }

    // ---- required-set parity, both directions ------------------------------

    @Test
    @DisplayName("removing any schema-required field fails BOTH the schema and ThinEventValidator")
    void requiredFieldsAreRequiredByBoth() throws Exception {
        for (String field : schemaRequired()) {
            ObjectNode without = probe(PROBE_EXAMPLE);
            without.remove(field);

            Set<ValidationMessage> errors = schema.validate(without);
            assertFalse(errors.isEmpty(), "schema still accepts a thin event with no " + field);

            CustomException thrown = assertThrows(CustomException.class,
                    () -> validator.validate(MAPPER.treeToValue(without, ThinEvent.class)),
                    "ThinEventValidator still accepts a thin event with no " + field);
            assertEquals("NB_INVALID_THIN_EVENT", thrown.getCode(),
                    "a missing " + field + " must be reported as a malformed thin event");
        }
    }

    @Test
    @DisplayName("removing any field the schema does NOT require leaves both happy")
    void optionalFieldsAreOptionalForBoth() throws Exception {
        Set<String> required = schemaRequired();
        List<String> optionalsExercised = new ArrayList<>();
        JsonNode full = probe(PROBE_EXAMPLE);
        for (var it = full.fieldNames(); it.hasNext(); ) {
            String field = it.next();
            if (required.contains(field)) {
                continue;
            }
            optionalsExercised.add(field);
            ObjectNode without = probe(PROBE_EXAMPLE);
            without.remove(field);

            assertEquals(Set.of(), schema.validate(without),
                    "the schema requires " + field + " but ThinEventValidator does not");
            // Throws if the validator disagrees.
            validator.validate(MAPPER.treeToValue(without, ThinEvent.class));
        }
        assertFalse(optionalsExercised.isEmpty(), "the probe example carries no optional fields to remove");
    }

    @Test
    @DisplayName("the schema's required set is the six fields the validator names, and no others")
    void requiredSetIsTheDocumentedSix() {
        // Stated once, in the one place a reader looks. The two tests above are what prove it
        // matches the code; this one is what makes a silent widening visible in the diff.
        assertEquals(
                new TreeSet<>(Set.of("kind", "eventId", "eventType", "module", "eventName", "tenantId")),
                new TreeSet<>(schemaRequired()));
    }

    // ---- model coverage ----------------------------------------------------

    @Test
    @DisplayName("every JSON field of ThinEvent is described by the schema")
    void everyModelFieldIsPublished() throws Exception {
        JsonNode properties = MAPPER.readTree(ContractResources.packaged(ContractResources.THIN_SCHEMA))
                .get("properties");
        for (Field field : ThinEvent.class.getDeclaredFields()) {
            if (field.isSynthetic() || Modifier.isStatic(field.getModifiers())) {
                continue;
            }
            assertTrue(properties.has(field.getName()),
                    "ThinEvent." + field.getName() + " is not in thin-event-v1.schema.json — "
                            + "a field added to the model must be published or it is not part of the contract");
        }
    }

    @Test
    @DisplayName("every JSON field of ActorRef is described by the schema's actorRef definition")
    void everyActorFieldIsPublished() throws Exception {
        JsonNode actorRef = MAPPER.readTree(ContractResources.packaged(ContractResources.THIN_SCHEMA))
                .get("$defs").get("actorRef").get("properties");
        for (Field field : ActorRef.class.getDeclaredFields()) {
            if (field.isSynthetic() || Modifier.isStatic(field.getModifiers())) {
                continue;
            }
            assertTrue(actorRef.has(field.getName()),
                    "ActorRef." + field.getName() + " is not in thin-event-v1.schema.json");
        }
    }

    @Test
    @DisplayName("actors and recipients are the same published shape — one definition, two uses")
    void actorsAndRecipientsShareOneDefinition() throws Exception {
        JsonNode properties = MAPPER.readTree(ContractResources.packaged(ContractResources.THIN_SCHEMA))
                .get("properties");
        assertEquals("#/$defs/actorRef",
                properties.get("actors").get("additionalProperties").get("$ref").asText());
        assertEquals("#/$defs/actorRef",
                properties.get("recipients").get("items").get("$ref").asText());
    }

    // ---- what the models actually do with the wire -------------------------

    @Test
    @DisplayName("a published example binds to ThinEvent with its nested actors and data intact")
    void examplesBindWithTheirNestedStructures() throws Exception {
        ThinEvent event = MAPPER.readValue(
                ContractResources.packaged(ContractResources.THIN_EXAMPLES_DIR + "/" + PROBE_EXAMPLE),
                ThinEvent.class);

        assertEquals("THIN", event.getKind());
        assertEquals("Complaints", event.getModule());
        assertEquals("3c2b1a09-7f6e-4d5c-8b2a-1e0f9d8c7b6a", event.getActors().get("assignee").getUserId());
        assertEquals("EMPLOYEE", event.getActors().get("assignee").getType());
        assertEquals("Peter Kirui", event.getData().get("emp_name"));
        assertEquals(List.of("CS_COMMON_PENDINGATLME"), event.localizationCodes("status"));
        assertEquals(List.of("rainmaker-pgr", "rainmaker-common"), event.getLocalizationModules());
    }

    @Test
    @DisplayName("localized takes a bare string as well as an array — both wire forms, one list")
    void localizedAcceptsBothWireForms() throws Exception {
        ThinEvent bare = MAPPER.readValue(
                ContractResources.packaged(ContractResources.THIN_EXAMPLES_DIR + "/03-module-neutral.json"),
                ThinEvent.class);
        assertEquals(List.of("XYZ_LICENCE_ACTIVE"), bare.localizationCodes("licence_status"));
        assertEquals(List.of(), bare.localizationCodes("no_such_token"),
                "a token with no codes is an empty list, never null");
    }

    @Test
    @DisplayName("the account-less example carries its recipient inline and names no actor")
    void accountLessExampleBindsItsRecipients() throws Exception {
        ThinEvent otp = MAPPER.readValue(
                ContractResources.packaged(ContractResources.THIN_EXAMPLES_DIR + "/04-contact-override.json"),
                ThinEvent.class);
        assertEquals(1, otp.getRecipients().size());
        assertEquals("+254712345678", otp.getRecipients().get(0).getPhone());
        assertEquals("sw_KE", otp.getRecipients().get(0).getLocale());
        assertEquals(null, otp.getRecipients().get(0).getUserId(),
                "an account-less recipient has no uuid — that is the whole reason this form exists");
    }

    // ---- documented tolerance ---------------------------------------------

    @Test
    @DisplayName("an unknown top-level field is accepted by both — additionalProperties:true is the truth")
    void unknownFieldsAreTolerated() throws Exception {
        ObjectNode extended = probe(PROBE_EXAMPLE);
        extended.put("somethingTheBridgeNeverHeardOf", "value");

        assertEquals(Set.of(), schema.validate(extended));
        // Jackson is configured to ignore unknown properties; if that ever changed, this throws
        // and the schema's additionalProperties:true would be a lie.
        validator.validate(MAPPER.treeToValue(extended, ThinEvent.class));
    }

    @Test
    @DisplayName("an unknown field inside an actor ref is tolerated too")
    void unknownActorFieldsAreTolerated() throws Exception {
        ObjectNode extended = probe(PROBE_EXAMPLE);
        ((ObjectNode) extended.get("actors").get("assignee")).put("badgeNumber", "7781");

        assertEquals(Set.of(), schema.validate(extended));
        ThinEvent bound = MAPPER.treeToValue(extended, ThinEvent.class);
        assertEquals("3c2b1a09-7f6e-4d5c-8b2a-1e0f9d8c7b6a", bound.getActors().get("assignee").getUserId());
    }

    // ---- documented divergence --------------------------------------------

    @Test
    @DisplayName("schemaVersion 2 is refused by both, with the code error-codes.md names")
    void unsupportedSchemaVersionIsRefusedByBoth() throws Exception {
        ObjectNode v2 = probe(PROBE_EXAMPLE);
        v2.put("schemaVersion", "2");

        assertFalse(schema.validate(v2).isEmpty(), "the schema must pin schemaVersion to 1");
        CustomException thrown = assertThrows(CustomException.class,
                () -> validator.validate(MAPPER.treeToValue(v2, ThinEvent.class)));
        assertEquals("NB_UNSUPPORTED_SCHEMA_VERSION", thrown.getCode());
    }

    @Test
    @DisplayName("kind RENDERED is refused by both — it is an envelope, and this is not that schema")
    void renderedKindIsNotAThinEvent() throws Exception {
        ObjectNode rendered = probe(PROBE_EXAMPLE);
        rendered.put("kind", "RENDERED");

        assertFalse(schema.validate(rendered).isEmpty(), "the thin schema pins kind to THIN");
        CustomException thrown = assertThrows(CustomException.class,
                () -> validator.validate(MAPPER.treeToValue(rendered, ThinEvent.class)));
        assertEquals("NB_INVALID_THIN_EVENT", thrown.getCode());
    }

    @Test
    @DisplayName("an eventType off the allowlist is refused by the validator and NOT by the schema — on purpose")
    void allowlistIsADeploymentFactNotAContractOne() throws Exception {
        // The schema describes the contract, which any producer may speak; the allowlist
        // describes one deployment, which decides whose events it accepts. A schema that pinned
        // the allowlist would have to be re-published for every onboarding.
        ObjectNode stranger = probe(PROBE_EXAMPLE);
        stranger.put("eventType", "SOMEBODY_ELSES_EVENT");

        assertEquals(Set.of(), schema.validate(stranger),
                "the published contract must not encode one deployment's allowlist");
        CustomException thrown = assertThrows(CustomException.class,
                () -> validator.validate(MAPPER.treeToValue(stranger, ThinEvent.class)));
        assertEquals("NB_UNSUPPORTED_EVENT_TYPE", thrown.getCode(),
                "an unallowed thin eventType must fail loud, with the same code the envelope path uses");
    }

    // ---- helpers -----------------------------------------------------------

    private static ObjectNode probe(String exampleName) throws Exception {
        return (ObjectNode) MAPPER.readTree(
                ContractResources.packaged(ContractResources.THIN_EXAMPLES_DIR + "/" + exampleName));
    }

    private Set<String> schemaRequired() {
        try {
            JsonNode required = MAPPER.readTree(ContractResources.packaged(ContractResources.THIN_SCHEMA))
                    .get("required");
            Set<String> names = new LinkedHashSet<>();
            required.forEach(n -> names.add(n.asText()));
            return names;
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private static ThinEventValidator validatorAccepting(String... types) {
        NovuBridgeConfiguration config = new NovuBridgeConfiguration();
        config.setEventTypes(List.of(types));
        return new ThinEventValidator(new EnvelopeValidator(config));
    }
}
