package org.egov.novubridge.contract;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.networknt.schema.JsonSchema;
import com.networknt.schema.JsonSchemaFactory;
import com.networknt.schema.SpecVersion;
import com.networknt.schema.ValidationMessage;
import org.egov.novubridge.service.EnvelopeValidator;
import org.egov.novubridge.web.models.NotificationEvent;
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
 * The published inbound contract and the code that enforces it, held against each other.
 *
 * <p>A JSON Schema nobody checks is a wish. These tests make
 * {@code contract/envelope-v1.schema.json} a statement the build can falsify:
 *
 * <ol>
 *   <li>the schema parses as JSON Schema 2020-12 and every published example validates;</li>
 *   <li>the schema's {@code required} set is EXACTLY what {@link EnvelopeValidator} enforces —
 *       proved in both directions, by removing every field in turn rather than by repeating a
 *       list here that could drift alongside the other two;</li>
 *   <li>every JSON field of {@link NotificationEvent} is described by the schema, so a field
 *       added to the model cannot go unpublished;</li>
 *   <li>the two places where schema and validator deliberately DISAGREE are stated as tests,
 *       so the asymmetry is a decision on record rather than an oversight.</li>
 * </ol>
 */
class EnvelopeContractSchemaTest {

    /**
     * The mapper the SERVICE actually runs with. Spring Boot's builder disables
     * FAIL_ON_UNKNOWN_PROPERTIES, which is precisely what {@code additionalProperties: true} in
     * the schema claims; a bare {@code new ObjectMapper()} would be stricter than production
     * and would make this suite agree with itself rather than with the running bridge.
     */
    private static final ObjectMapper MAPPER =
            org.springframework.http.converter.json.Jackson2ObjectMapperBuilder.json().build();

    /**
     * The probe payload for the field-by-field work below. Deliberately the richest example
     * whose {@code eventType} the DEFAULT validator accepts, so a removal that trips the
     * validator can only be the removal and never the allowlist.
     */
    private static final String PROBE_EXAMPLE = "01-complaint-sms.json";

    private final JsonSchema schema = JsonSchemaFactory
            .getInstance(SpecVersion.VersionFlag.V202012)
            .getSchema(ContractResources.packaged(ContractResources.SCHEMA));

    private final EnvelopeValidator validator = new EnvelopeValidator();

    // ---- the schema itself -------------------------------------------------

    @Test
    @DisplayName("the packaged schema declares 2020-12 and describes an object")
    void schemaIsWellFormed() throws Exception {
        JsonNode raw = MAPPER.readTree(ContractResources.packaged(ContractResources.SCHEMA));
        assertEquals("https://json-schema.org/draft/2020-12/schema", raw.get("$schema").asText());
        assertEquals("object", raw.get("type").asText());
        assertTrue(raw.get("properties").size() >= 15, "the envelope has more fields than this");
    }

    // ---- the examples ------------------------------------------------------

    @Test
    @DisplayName("every published example validates against the schema")
    void examplesValidate() throws Exception {
        List<String> names = ContractResources.exampleNames();
        assertTrue(names.size() >= 4, "the contract promises 3-4 examples; found " + names.size());
        for (String name : names) {
            JsonNode node = MAPPER.readTree(
                    ContractResources.packaged(ContractResources.EXAMPLES_DIR + "/" + name));
            assertEquals(Set.of(), schema.validate(node), name + " does not validate");
        }
    }

    @Test
    @DisplayName("every published example is a real wire payload: it deserializes and the validator takes it")
    void examplesAreAcceptedByTheValidator() throws Exception {
        // The XYZ example names an eventType no deployment accepts by default — that IS the
        // onboarding step a new producer goes through — so the validator is given the allowlist
        // such a deployment would carry.
        EnvelopeValidator permissive = validatorAccepting(
                "COMPLAINTS_WORKFLOW_TRANSITIONED", "CORE_SMS", "XYZ_LICENCE_RENEWED");
        for (String name : ContractResources.exampleNames()) {
            NotificationEvent event = MAPPER.readValue(
                    ContractResources.packaged(ContractResources.EXAMPLES_DIR + "/" + name),
                    NotificationEvent.class);
            permissive.validate(event);   // throws on refusal
        }
    }

    @Test
    @DisplayName("each example covers the shape it is published for")
    void examplesCoverTheDocumentedShapes() throws Exception {
        assertEquals("SMS", probe("01-complaint-sms.json").get("channel").asText());
        assertTrue(probe("02-complaint-email.json").get("subject").asText().length() > 0,
                "the email example must carry a subject");
        JsonNode whatsapp = probe("03-complaint-whatsapp-template.json");
        assertEquals("WHATSAPP", whatsapp.get("channel").asText());
        assertTrue(whatsapp.hasNonNull("templateId") && whatsapp.hasNonNull("contentVariables"),
                "the WhatsApp example must carry templateId + contentVariables");
        assertEquals("CORE_SMS", probe("04-core-sms-otp.json").get("eventType").asText());
        assertEquals("XYZ", probe("05-module-neutral-sms.json").get("module").asText());
    }

    // ---- required-set parity, both directions ------------------------------

    @Test
    @DisplayName("removing any schema-required field fails BOTH the schema and EnvelopeValidator")
    void requiredFieldsAreRequiredByBoth() throws Exception {
        for (String field : schemaRequired()) {
            ObjectNode without = probe(PROBE_EXAMPLE);
            without.remove(field);

            Set<ValidationMessage> errors = schema.validate(without);
            assertFalse(errors.isEmpty(), "schema still accepts an envelope with no " + field);

            CustomException thrown = assertThrows(CustomException.class,
                    () -> validator.validate(MAPPER.treeToValue(without, NotificationEvent.class)),
                    "EnvelopeValidator still accepts an envelope with no " + field);
            assertEquals("NB_INVALID_EVENT", thrown.getCode(),
                    "a missing " + field + " must be reported as a malformed envelope");
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
                    "the schema requires " + field + " but EnvelopeValidator does not");
            // Throws if the validator disagrees.
            validator.validate(MAPPER.treeToValue(without, NotificationEvent.class));
        }
        assertFalse(optionalsExercised.isEmpty(), "the probe example carries no optional fields to remove");
    }

    @Test
    @DisplayName("the schema's required set is the seven fields the validator names, and no others")
    void requiredSetIsTheDocumentedSeven() {
        // Stated once, in the one place a reader looks. The two tests above are what prove it
        // matches the code; this one is what makes a silent widening visible in the diff.
        assertEquals(
                new TreeSet<>(Set.of("eventId", "eventType", "eventName", "tenantId",
                        "channel", "subscriberId", "renderedBody")),
                new TreeSet<>(schemaRequired()));
    }

    // ---- model coverage ----------------------------------------------------

    @Test
    @DisplayName("every JSON field of NotificationEvent is described by the schema")
    void everyModelFieldIsPublished() throws Exception {
        JsonNode properties = MAPPER.readTree(ContractResources.packaged(ContractResources.SCHEMA))
                .get("properties");
        for (Field field : NotificationEvent.class.getDeclaredFields()) {
            if (field.isSynthetic() || Modifier.isStatic(field.getModifiers())) {
                continue;
            }
            assertTrue(properties.has(field.getName()),
                    "NotificationEvent." + field.getName() + " is not in envelope-v1.schema.json — "
                            + "a field added to the model must be published or it is not part of the contract");
        }
    }

    @Test
    @DisplayName("the Contact block is described field by field too")
    void everyContactFieldIsPublished() throws Exception {
        JsonNode contact = MAPPER.readTree(ContractResources.packaged(ContractResources.SCHEMA))
                .get("properties").get("contact").get("properties");
        for (Field field : org.egov.novubridge.web.models.Contact.class.getDeclaredFields()) {
            if (field.isSynthetic() || Modifier.isStatic(field.getModifiers())) {
                continue;
            }
            assertTrue(contact.has(field.getName()),
                    "Contact." + field.getName() + " is not in envelope-v1.schema.json");
        }
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
        validator.validate(MAPPER.treeToValue(extended, NotificationEvent.class));
    }

    // ---- documented divergence --------------------------------------------

    @Test
    @DisplayName("schemaVersion 2 is refused by both, with the code error-codes.md names")
    void unsupportedSchemaVersionIsRefusedByBoth() throws Exception {
        ObjectNode v2 = probe(PROBE_EXAMPLE);
        v2.put("schemaVersion", "2");

        assertFalse(schema.validate(v2).isEmpty(), "the schema must pin schemaVersion to 1");
        CustomException thrown = assertThrows(CustomException.class,
                () -> validator.validate(MAPPER.treeToValue(v2, NotificationEvent.class)));
        assertEquals("NB_UNSUPPORTED_SCHEMA_VERSION", thrown.getCode());
    }

    @Test
    @DisplayName("an unknown channel: the schema refuses it, the validator does NOT — on purpose")
    void unknownChannelIsASchemaViolationButNotAnEnvelopeRejection() throws Exception {
        // The asymmetry is deliberate and documented on `channel` in the schema: a typo'd
        // channel must be VISIBLE in the dispatch log (SKIPPED / NB_UNSUPPORTED_CHANNEL), not
        // dropped into the DLQ where no operator looks. The producer-facing contract is still
        // the enum. NeutralEventPipelineTest proves the SKIPPED half.
        ObjectNode pigeon = probe(PROBE_EXAMPLE);
        pigeon.put("channel", "PIGEON");

        assertFalse(schema.validate(pigeon).isEmpty(),
                "the published contract must name the three deliverable channels");
        validator.validate(MAPPER.treeToValue(pigeon, NotificationEvent.class));
    }

    // ---- helpers -----------------------------------------------------------

    private static ObjectNode probe(String exampleName) throws Exception {
        return (ObjectNode) MAPPER.readTree(
                ContractResources.packaged(ContractResources.EXAMPLES_DIR + "/" + exampleName));
    }

    private Set<String> schemaRequired() {
        try {
            JsonNode required = MAPPER.readTree(ContractResources.packaged(ContractResources.SCHEMA))
                    .get("required");
            Set<String> names = new LinkedHashSet<>();
            required.forEach(n -> names.add(n.asText()));
            return names;
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private static EnvelopeValidator validatorAccepting(String... types) {
        org.egov.novubridge.config.NovuBridgeConfiguration config =
                new org.egov.novubridge.config.NovuBridgeConfiguration();
        config.setEventTypes(List.of(types));
        return new EnvelopeValidator(config);
    }
}
