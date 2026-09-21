package org.egov.novubridge.contract;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.networknt.schema.JsonSchema;
import com.networknt.schema.JsonSchemaFactory;
import com.networknt.schema.SpecVersion;
import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.service.EnvelopeValidator;
import org.egov.novubridge.web.models.NotificationEvent;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * <b>The pre-rendered envelope v1 is a public interface forever.</b> CORE-SMS, OTP and any
 * external producer speak it; the thin domain event is <i>additional</i>, never a replacement.
 * This test is that promise, mechanised — two ways, because the two failure modes are different.
 *
 * <p><b>The hash</b> catches an edit to the file. Any edit: a widened enum, a field quietly made
 * optional, a description that changes what a producer believes. Changing the v1 contract becomes
 * a deliberate two-file act — the schema and the constant below — with the reason in the commit
 * message, rather than a line in a diff nobody reads twice.
 *
 * <p><b>The acceptance tests</b> catch the rest. A hash freezes the document, not the behaviour:
 * a change in {@code EnvelopeValidator}, or in {@code NotificationEvent}, could break every v1
 * producer without touching the schema at all. So the shapes that must keep working are asserted
 * directly — most importantly the <b>legacy no-{@code kind} shape</b>, which is what every
 * producer written before the thin event existed actually sends, and which must stay valid with
 * nobody having to do anything about it.
 */
class EnvelopeV1FrozenTest {

    /**
     * SHA-256 of {@code contract/envelope-v1.schema.json}.
     *
     * <p><b>If this test fails, do not update the constant to make it pass.</b> Read the diff
     * first. An intentional change to the v1 envelope needs: a reason, a schemaVersion decision
     * (adding an optional field is not a version change; renaming, removing or redefining one
     * is), both copies of the file edited, and only then this constant.
     *
     * <p>Last set when the optional {@code kind} discriminator was added — an optional field,
     * accepting exactly what v1 accepted before it, which is why that change was allowed at all.
     */
    private static final String ENVELOPE_V1_SHA256 =
            "71f7758405b4fed79659941d9cbff785afeca2195e93efdbd0257b708a8c54bc";

    private static final ObjectMapper MAPPER =
            org.springframework.http.converter.json.Jackson2ObjectMapperBuilder.json().build();

    private final JsonSchema schema = JsonSchemaFactory
            .getInstance(SpecVersion.VersionFlag.V202012)
            .getSchema(ContractResources.packaged(ContractResources.SCHEMA));

    // ---- the document ------------------------------------------------------

    @Test
    @DisplayName("envelope-v1.schema.json is byte-for-byte what it was — changing it is a deliberate act")
    void theEnvelopeSchemaIsFrozen() {
        assertEquals(ENVELOPE_V1_SHA256, sha256(ContractResources.packaged(ContractResources.SCHEMA)),
                "envelope-v1.schema.json changed. v1 is a public interface with producers nobody "
                        + "here controls. If the change is intentional, read this test's javadoc; "
                        + "if it is not, revert the schema rather than the constant.");
    }

    // ---- the field set -----------------------------------------------------

    @Test
    @DisplayName("the v1 field set is unchanged — nothing removed, and nothing added but the discriminator")
    void theV1FieldSetIsUnchanged() throws Exception {
        // Spelled out rather than derived, because deriving it from the file the previous test
        // freezes would prove nothing. A removal here breaks a producer; an addition here is a
        // claim about the contract that someone must have decided to make.
        Set<String> expected = new TreeSet<>(Set.of(
                "kind", "schemaVersion", "eventId", "eventType", "eventTime", "producer", "module",
                "eventName", "entityType", "entityId", "tenantId", "channel", "subscriberId",
                "contact", "renderedBody", "subject", "transactionId", "templateKey", "templateId",
                "contentVariables", "data"));
        assertEquals(expected, new TreeSet<>(fieldNames("properties")));
    }

    @Test
    @DisplayName("the v1 required set is still the same seven fields")
    void theV1RequiredSetIsUnchanged() throws Exception {
        assertEquals(
                new TreeSet<>(Set.of("eventId", "eventType", "eventName", "tenantId",
                        "channel", "subscriberId", "renderedBody")),
                new TreeSet<>(fieldNames("required")));
    }

    // ---- acceptance --------------------------------------------------------

    @Test
    @DisplayName("every published envelope example still validates and is still accepted")
    void everyPublishedExampleStillPasses() throws Exception {
        EnvelopeValidator permissive = validatorAccepting(
                "COMPLAINTS_WORKFLOW_TRANSITIONED", "CORE_SMS", "XYZ_LICENCE_RENEWED");
        List<String> names = ContractResources.exampleNames();
        assertEquals(5, names.size(), "the contract publishes five envelope examples; found " + names);
        for (String name : names) {
            JsonNode node = MAPPER.readTree(
                    ContractResources.packaged(ContractResources.EXAMPLES_DIR + "/" + name));
            assertEquals(Set.of(), schema.validate(node), name + " no longer validates against v1");
            permissive.validate(MAPPER.treeToValue(node, NotificationEvent.class));
        }
    }

    @Test
    @DisplayName("the legacy shape — no `kind` at all — is still a valid, accepted envelope")
    void theLegacyNoKindShapeStillPasses() throws Exception {
        // This is what every v1 producer in the world sends, and what they will keep sending.
        // The discriminator was added as an OPTIONAL field precisely so this line stays true.
        for (String name : ContractResources.exampleNames()) {
            ObjectNode node = (ObjectNode) MAPPER.readTree(
                    ContractResources.packaged(ContractResources.EXAMPLES_DIR + "/" + name));
            assertFalse(node.has("kind"),
                    name + " declares a kind — the published envelope examples must stay in the "
                            + "legacy shape, because that is the shape being frozen");
        }

        ObjectNode legacy = (ObjectNode) MAPPER.readTree(
                ContractResources.packaged(ContractResources.EXAMPLES_DIR + "/01-complaint-sms.json"));
        assertEquals(Set.of(), schema.validate(legacy));
        new EnvelopeValidator().validate(MAPPER.treeToValue(legacy, NotificationEvent.class));
    }

    @Test
    @DisplayName("an explicit kind=RENDERED is accepted too, and changes nothing")
    void anExplicitRenderedKindIsAccepted() throws Exception {
        ObjectNode explicit = (ObjectNode) MAPPER.readTree(
                ContractResources.packaged(ContractResources.EXAMPLES_DIR + "/01-complaint-sms.json"));
        explicit.put("kind", "RENDERED");

        assertEquals(Set.of(), schema.validate(explicit));
        // The model does not carry `kind`; the consumer reads it off the raw map. So an envelope
        // that states it binds and behaves exactly like one that does not.
        new EnvelopeValidator().validate(MAPPER.treeToValue(explicit, NotificationEvent.class));
    }

    @Test
    @DisplayName("kind=THIN is NOT an envelope — the schema says so, which is what makes the split real")
    void aThinKindIsNotAnEnvelope() throws Exception {
        ObjectNode thin = (ObjectNode) MAPPER.readTree(
                ContractResources.packaged(ContractResources.EXAMPLES_DIR + "/01-complaint-sms.json"));
        thin.put("kind", "THIN");

        assertFalse(schema.validate(thin).isEmpty(),
                "envelope-v1 must refuse kind=THIN, or the discriminator is decoration");
    }

    // ---- helpers -----------------------------------------------------------

    private static Set<String> fieldNames(String key) throws Exception {
        JsonNode node = MAPPER.readTree(ContractResources.packaged(ContractResources.SCHEMA)).get(key);
        Set<String> names = new LinkedHashSet<>();
        if (node.isArray()) {
            node.forEach(n -> names.add(n.asText()));
        } else {
            node.fieldNames().forEachRemaining(names::add);
        }
        assertTrue(names.size() > 1, key + " could not be read from the schema");
        return names;
    }

    private static String sha256(String content) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(content.getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder(digest.length * 2);
            for (byte b : digest) {
                hex.append(Character.forDigit((b >> 4) & 0xF, 16)).append(Character.forDigit(b & 0xF, 16));
            }
            return hex.toString();
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private static EnvelopeValidator validatorAccepting(String... types) {
        NovuBridgeConfiguration config = new NovuBridgeConfiguration();
        config.setEventTypes(List.of(types));
        return new EnvelopeValidator(config);
    }
}
