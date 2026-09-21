package org.egov.novubridge.service.resolution.digit;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.egov.novubridge.service.resolution.config.NotificationConfigRows.ProviderTemplateRow;
import org.egov.novubridge.service.resolution.config.NotificationConfigRows.RoutingRow;
import org.egov.novubridge.service.resolution.config.NotificationConfigRows.TemplateRow;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.InputStream;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * <b>The Java read-adapter and the Python copy script must be the same mapping.</b>
 *
 * <p>Two things convert legacy notification config, and they run at different moments on the same
 * data. {@code local-setup/scripts/notifications_convert.py} converts a live tenant's rows ONCE,
 * when the seeder runs; this adapter converts them on every read, for a tenant the seeder has not
 * reached yet. If the two ever disagreed, a tenant's messages would change the moment the copy
 * ran — silently, with no deploy to blame — which is the worst property a migration can have.
 *
 * <p>The Python side pins {@code convert(legacy seed) == committed NOTIFICATIONS.* defaults}. This
 * pins the same equation for the Java side, against the same two committed files. Between them,
 * the two mappings are held to one answer.
 */
class LegacyMasterAdapterConversionTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    @Test
    @DisplayName("converting the legacy seed produces exactly the committed NOTIFICATIONS.Routing rows")
    void routingMatchesTheCommittedDefaults() throws Exception {
        List<Map<String, Object>> legacy = rows("golden/inputs/masters/RAINMAKER-PGR.NotificationRouting.json");
        List<Map<String, Object>> expected = rows("golden/expected/NOTIFICATIONS.Routing.json");

        List<Map<String, Object>> actual = new ArrayList<>();
        for (Map<String, Object> row : legacy) {
            RoutingRow converted = LegacyMasterAdapter.convertRouting(row);
            if (converted == null) {
                continue;   // AUTO_ESCALATE / SYSTEM: dropped, exactly as the converter drops them
            }
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("module", converted.module());
            out.put("eventName", converted.eventName());
            out.put("audience", converted.audience());
            out.put("channel", converted.channel());
            out.put("active", converted.active());
            actual.add(out);
        }
        assertEquals(24, expected.size(), "the committed default is 24 routing rows");
        assertEquals(expected, actual, "the Java adapter and notifications_convert.py disagree about "
                + "NOTIFICATIONS.Routing — a tenant's messages would change when the seeder copies its rows");
    }

    @Test
    @DisplayName("converting the legacy seed produces exactly the committed NOTIFICATIONS.Template rows")
    void templatesMatchTheCommittedDefaults() throws Exception {
        List<Map<String, Object>> legacyRouting = rows("golden/inputs/masters/RAINMAKER-PGR.NotificationRouting.json");
        List<Map<String, Object>> legacy = rows("golden/inputs/masters/RAINMAKER-PGR.NotificationTemplate.json");
        List<Map<String, Object>> expected = rows("golden/expected/NOTIFICATIONS.Template.json");

        Map<String, String> index = LegacyMasterAdapter.buildAudienceIndex(legacyRouting);
        List<Map<String, Object>> actual = new ArrayList<>();
        for (Map<String, Object> row : legacy) {
            TemplateRow converted = LegacyMasterAdapter.convertTemplate(row, index);
            if (converted == null) {
                continue;
            }
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("module", converted.module());
            out.put("eventName", converted.eventName());
            out.put("audience", converted.audience());
            out.put("channel", converted.channel());
            out.put("locale", converted.locale());
            out.put("subject", converted.subject());
            out.put("body", converted.body());
            out.put("active", converted.active());
            actual.add(out);
        }
        // The committed file also carries `placeholders`, which the resolution stage never reads
        // (the runtime check is "a token with no value keeps its braces"); it is authoring help
        // for the Configurator. Compare the columns that decide what ships.
        List<Map<String, Object>> wanted = new ArrayList<>();
        for (Map<String, Object> row : expected) {
            Map<String, Object> out = new LinkedHashMap<>();
            for (String key : List.of("module", "eventName", "audience", "channel", "locale",
                    "subject", "body", "active")) {
                out.put(key, row.get(key));
            }
            wanted.add(out);
        }
        assertEquals(42, expected.size(), "the committed default is 42 template rows");
        assertEquals(wanted, actual);
    }

    @Test
    @DisplayName("converting the legacy seed produces exactly the committed NOTIFICATIONS.ProviderTemplate rows")
    void providerTemplatesMatchTheCommittedDefaults() throws Exception {
        List<Map<String, Object>> legacyRouting = rows("golden/inputs/masters/RAINMAKER-PGR.NotificationRouting.json");
        List<Map<String, Object>> legacy =
                rows("golden/inputs/masters/RAINMAKER-PGR.NotificationProviderTemplate.json");
        List<Map<String, Object>> expected = rows("golden/expected/NOTIFICATIONS.ProviderTemplate.json");

        Map<String, String> index = LegacyMasterAdapter.buildAudienceIndex(legacyRouting);
        List<Map<String, Object>> actual = new ArrayList<>();
        for (Map<String, Object> row : legacy) {
            ProviderTemplateRow converted = LegacyMasterAdapter.convertProviderTemplate(row, index);
            if (converted == null) {
                continue;
            }
            Map<String, Object> out = new LinkedHashMap<>();
            out.put("provider", converted.provider());
            out.put("channel", converted.channel());
            out.put("eventName", converted.eventName());
            out.put("audience", converted.audience());
            out.put("locale", converted.locale());
            out.put("templateId", converted.templateId());
            out.put("variables", converted.variables());
            out.put("active", converted.active());
            out.put("approvalStatus", converted.approvalStatus());
            actual.add(out);
        }
        List<Map<String, Object>> wanted = new ArrayList<>();
        for (Map<String, Object> row : expected) {
            Map<String, Object> out = new LinkedHashMap<>();
            for (String key : List.of("provider", "channel", "eventName", "audience", "locale",
                    "templateId", "variables", "active", "approvalStatus")) {
                out.put(key, row.get(key));
            }
            wanted.add(out);
        }
        assertEquals(14, expected.size(), "the committed default is 14 provider-template rows");
        assertEquals(wanted, actual);
    }

    // ---- the mapping rules, one by one --------------------------------------

    @Test
    @DisplayName("the audience table: the five legacy forms and what each becomes")
    void theAudienceTableIsExact() {
        assertEquals("ACTOR:citizen", LegacyMasterAdapter.audienceRef("CITIZEN", null));
        assertEquals("ACTOR:assignee", LegacyMasterAdapter.audienceRef("EMPLOYEE", null));
        assertEquals("ACTOR:citizen", LegacyMasterAdapter.audienceRef("citizen", true),
                "assigneeOnly is meaningless on a named actor and must not change it");
        assertNull(LegacyMasterAdapter.audienceRef("AUTO_ESCALATE", null), "dropped");
        assertNull(LegacyMasterAdapter.audienceRef("SYSTEM", null), "dropped");
        assertEquals("ROLE:GRO", LegacyMasterAdapter.audienceRef("GRO", null));
        assertEquals("ROLE:GRO", LegacyMasterAdapter.audienceRef("GRO", false));
        assertEquals("ACTOR:assignee|ROLE:GRO", LegacyMasterAdapter.audienceRef("GRO", true),
                "'notify the assignee, else the whole pool' IS a pipe chain");
    }

    @Test
    @DisplayName("an already-converted row passes through unchanged — re-running the copy is a no-op")
    void conversionIsIdempotent() {
        assertEquals("ACTOR:assignee|ROLE:GRO",
                LegacyMasterAdapter.audienceRef("ACTOR:assignee|ROLE:GRO", null));
        assertEquals("EVENT_RECIPIENTS", LegacyMasterAdapter.audienceRef("EVENT_RECIPIENTS", true));
        assertTrue(LegacyMasterAdapter.isSchemeRef("ROLE:GRO"));
        assertTrue(LegacyMasterAdapter.isSchemeRef("ACTOR:assignee|ROLE:GRO"));
        assertTrue(LegacyMasterAdapter.isSchemeRef("EVENT_RECIPIENTS"));
        assertTrue(!LegacyMasterAdapter.isSchemeRef("GRO"));

        Map<String, Object> alreadyNew = new LinkedHashMap<>(Map.of(
                "module", "Complaints", "eventName", "COMPLAINTS.WORKFLOW.APPLY.PENDINGFORASSIGNMENT",
                "audience", "ACTOR:citizen", "channel", "SMS", "active", true));
        RoutingRow passedThrough = LegacyMasterAdapter.convertRouting(alreadyNew);
        assertNotNull(passedThrough);
        assertEquals("COMPLAINTS.WORKFLOW.APPLY.PENDINGFORASSIGNMENT", passedThrough.eventName());
        assertEquals("ACTOR:citizen", passedThrough.audience());
    }

    @Test
    @DisplayName("the join hazard: an assigneeOnly routing row and its template land on the SAME audience string")
    void theTemplateJoinSurvivesAssigneeOnly() {
        List<Map<String, Object>> routing = List.of(new LinkedHashMap<>(Map.of(
                "businessService", "PGR", "action", "ASSIGN", "toState", "PENDINGATLME",
                "audience", "GRO", "channel", "SMS", "assigneeOnly", true, "active", true)));
        Map<String, String> index = LegacyMasterAdapter.buildAudienceIndex(routing);

        Map<String, Object> template = new LinkedHashMap<>(Map.of(
                "action", "ASSIGN", "toState", "PENDINGATLME", "audience", "GRO", "channel", "SMS",
                "locale", "en_IN", "body", "hello", "active", true));
        TemplateRow converted = LegacyMasterAdapter.convertTemplate(template, index);

        assertEquals("ACTOR:assignee|ROLE:GRO", converted.audience(),
                "the template row carries no assigneeOnly column of its own; without the routing "
                        + "rows as context it would map to a bare ROLE:GRO and the routing row "
                        + "would silently find no template");
        assertEquals("ACTOR:assignee|ROLE:GRO",
                LegacyMasterAdapter.convertRouting(routing.get(0)).audience());
    }

    @Test
    @DisplayName("an ORPHAN template — no routing row names its audience — falls back to the bare mapping")
    void anOrphanTemplateStillConverts() {
        TemplateRow converted = LegacyMasterAdapter.convertTemplate(new LinkedHashMap<>(Map.of(
                "action", "ASSIGN", "toState", "PENDINGATLME", "audience", "PGR_LME", "channel", "SMS",
                "locale", "en_IN", "body", "hello", "active", true)), Map.of());
        assertEquals("ROLE:PGR_LME", converted.audience());
    }

    @Test
    @DisplayName("eventName carries the target state; an unknown businessService is converted, never dropped")
    void eventNameRules() {
        assertEquals("COMPLAINTS.WORKFLOW.ASSIGN.PENDINGATLME",
                LegacyMasterAdapter.eventName("PGR", "ASSIGN", "PENDINGATLME"));
        assertEquals("COMPLAINTS.WORKFLOW.ASSIGN.PENDINGATLME",
                LegacyMasterAdapter.eventName("PGR", "assign", "pendingatlme"), "upper-cased");
        assertEquals("COMPLAINTS.WORKFLOW.APPLY.PENDINGFORASSIGNMENT",
                LegacyMasterAdapter.eventName(null, "APPLY", "PENDINGFORASSIGNMENT"),
                "a blank businessService means PGR: it has had exactly one value in production");
        assertEquals("TL.WORKFLOW.APPLY.APPLIED", LegacyMasterAdapter.eventName("TL", "APPLY", "APPLIED"),
                "a tenant that invented a business service keeps its rows");
        assertEquals("TL", LegacyMasterAdapter.moduleFor("TL"));
        assertEquals("Complaints", LegacyMasterAdapter.moduleFor("PGR"));

        assertThrows(LegacyMasterAdapter.ConversionException.class,
                () -> LegacyMasterAdapter.eventName("PGR", "", "PENDINGATLME"),
                "no eventName can be derived without an action; the producer returns early on one");
        assertThrows(LegacyMasterAdapter.ConversionException.class,
                () -> LegacyMasterAdapter.audienceRef("", null));
    }

    @Test
    @DisplayName("a blank locale becomes en_IN, because locale is a required key in the new schema")
    void aBlankLocaleGetsTheDefault() {
        TemplateRow converted = LegacyMasterAdapter.convertTemplate(new LinkedHashMap<>(Map.of(
                "action", "ASSIGN", "toState", "PENDINGATLME", "audience", "CITIZEN", "channel", "SMS",
                "body", "hello", "active", true)), Map.of());
        assertEquals("en_IN", converted.locale(),
                "a live row with a null locale would be REJECTED on create; giving it the default "
                        + "keeps a message body an operator wrote");
    }

    // ---- plumbing -----------------------------------------------------------

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> rows(String resource) throws Exception {
        try (InputStream in = LegacyMasterAdapterConversionTest.class.getClassLoader()
                .getResourceAsStream(resource)) {
            assertNotNull(in, resource + " is not on the test classpath");
            JsonNode array = MAPPER.readTree(in);
            List<Map<String, Object>> out = new ArrayList<>();
            array.forEach(row -> out.add(MAPPER.convertValue(row, LinkedHashMap.class)));
            return out;
        }
    }
}
