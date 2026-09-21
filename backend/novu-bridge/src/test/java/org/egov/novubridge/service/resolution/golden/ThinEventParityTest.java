package org.egov.novubridge.service.resolution.golden;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.repository.DispatchLogRepository;
import org.egov.novubridge.service.DispatchPipelineService;
import org.egov.novubridge.service.resolution.ActorRecipientResolver;
import org.egov.novubridge.service.resolution.EventRecipientsResolver;
import org.egov.novubridge.service.resolution.NotificationResolver;
import org.egov.novubridge.service.resolution.PlaceholderResolver;
import org.egov.novubridge.service.resolution.RecipientResolver;
import org.egov.novubridge.service.resolution.TemplateRenderer;
import org.egov.novubridge.service.resolution.config.NotificationConfigRepository;
import org.egov.novubridge.service.resolution.config.NotificationConfigRows.CatalogueRow;
import org.egov.novubridge.service.resolution.digit.DigitRoleRecipientResolver;
import org.egov.novubridge.service.resolution.digit.DigitUserHydrator;
import org.egov.novubridge.service.resolution.digit.DigitUserSearch;
import org.egov.novubridge.service.resolution.digit.LegacyMasterAdapter;
import org.egov.novubridge.web.models.Contact;
import org.egov.novubridge.web.models.DispatchLogEntry;
import org.egov.novubridge.web.models.DispatchResult;
import org.egov.novubridge.web.models.NotificationEvent;
import org.egov.novubridge.web.models.ThinEvent;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.InputStream;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.TreeSet;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;

/**
 * <b>The acceptance criterion for moving the decision half of notifications into the box.</b>
 *
 * <p>{@code golden-envelopes.json} records, envelope by envelope, what {@code pgr-services}
 * publishes today for twenty-six scenarios — every transition, both locales, a role pool with a
 * uuid-less holder, a localization outage, a shortener outage, an unapproved WhatsApp template,
 * an EMAIL with no subject. This test builds the thin event the producer WILL emit for each of
 * those same scenarios, feeds it through the real resolution stage with the same masters and the
 * same world, and asserts the envelopes that come out are the ones in that file — field for
 * field, including {@code transactionId}, {@code renderedBody}, {@code contentVariables} and the
 * whole {@code contact} block.
 *
 * <p><b>The differences are a table, not a judgement call.</b> {@link #INTENDED_DIFFERENCES} below
 * is applied to the expected envelope before comparison; anything else that differs is a failure.
 * That is the property worth having: "we changed only what we said we would" is checkable, and
 * "the test passes" stops meaning "someone decided the difference was fine".
 *
 * <p><b>What is deliberately NOT stubbed.</b> The legacy master adapter, the template renderer,
 * the role-pool resolver with its paging and its uuid-less handling, the actor hydrator, the
 * placeholder resolver and the fan-out loop are all the real classes. Only the four network
 * seams are in-memory, and each is faked at the narrowest point its adapter offers. A parity test
 * that stubbed the resolvers would prove the loop and nothing about the two things most likely to
 * regress in a port: role-pool ordering, and the legacy audience join.
 */
class ThinEventParityTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    // =====================================================================
    //  THE INTENDED DIFFERENCES
    //  Every way the thin path's output differs from what pgr-services publishes today.
    //  One row per (scenario, field). Anything not here is a failure, not a difference.
    // =====================================================================

    /**
     * | scenario | field | old | new | reason |
     * |---|---|---|---|---|
     * | * | {@code templateKey} | {@code <AUDIENCE>.<ACTION>.<TOSTATE>.<CHANNEL>.<LOCALE>} | {@code <eventName>.<audienceRef>.<CHANNEL>.<LOCALE>} | Design §8.3(2). {@code templateKey} reports the MDMS {@code uniqueIdentifier} of the row that actually rendered, so an operator reading a ledger row can go straight to it. The new master's x-unique is {@code (eventName, audience, channel, locale)} and its audience is a scheme reference, so the key necessarily changes shape. No information is lost: the old key's five segments are all still present, the audience now says which scheme it is, and the event name distinguishes {@code RATE.CLOSEDAFTERRESOLUTION} from {@code RATE.CLOSEDAFTERREJECTION}, which the old form could not. |
     *
     * <p><b>Differences that are documented but that this fixture does not exercise</b>, because
     * the golden world never makes them happen:
     *
     * <ul>
     *   <li><b>The assignee's identity on the lookup-failure path.</b> Today an assignee resolved
     *       through workflow history whose egov-user lookup fails is published under a SECOND
     *       identity — the workflow's own user record, with no country code on the phone and
     *       possibly no uuid — giving the same human a different {@code subscriberId} and
     *       therefore a different {@code transactionId} from the one they get when the lookup
     *       succeeds. The thin path has one rule: the assignee is the actor the producer named,
     *       hydrated when the producer sent a uuid and no contact. On the normal path that is
     *       byte-identical (which is what this test proves, in S04, S09, S14, S15 and S23); when
     *       hydration fails the recipient is reported as {@code SKIPPED / NB_CONTACT_MISSING}
     *       against the uuid the producer named, instead of being messaged under a second
     *       identity. The producer, which knows the fallback record, sends it inline when its own
     *       lookup failed — see {@code ScenarioThinEventBuilder.resolveAssignee}.</li>
     *   <li><b>New SKIPPED ledger rows</b> where the producer previously logged and dropped: no
     *       routing (S10, S26), no template (S21), a contact-gated recipient (S02's EMAIL). Design
     *       §8.3(3). These are additional ROWS, not changed envelopes, so they do not appear in
     *       the comparison below; {@link #zeroEnvelopeScenariosBecomeLedgerRows()} asserts them
     *       directly.</li>
     *   <li><b>{@code source_path = RESOLVED}</b> on every row. Design §8.3(4). A new column, not
     *       a changed envelope field.</li>
     * </ul>
     */
    private static final List<String[]> INTENDED_DIFFERENCES = List.<String[]>of(
            new String[]{"*", "templateKey",
                    "<AUDIENCE>.<ACTION>.<TOSTATE>.<CHANNEL>.<LOCALE>",
                    "<eventName>.<audienceRef>.<CHANNEL>.<LOCALE>",
                    "design 8.3(2): the MDMS uniqueIdentifier of the NOTIFICATIONS.Template row "
                            + "that rendered, whose x-unique is (eventName, audience, channel, locale)"});

    // ---- the test ----------------------------------------------------------

    @Test
    @DisplayName("every golden scenario's envelopes are reproduced by the resolution stage, field for field")
    void everyScenarioMatchesTheGoldenMaster() throws Exception {
        JsonNode scenarios = read("golden/inputs/scenarios.json");
        JsonNode golden = read("golden/golden-envelopes.json");
        Map<String, JsonNode> expectedByScenario = new LinkedHashMap<>();
        golden.path("scenarios").forEach(s -> expectedByScenario.put(s.path("id").asText(), s));

        assertEquals(26, scenarios.path("scenarios").size(), "the matrix is 26 scenarios");
        assertEquals(scenarios.path("scenarios").size(), expectedByScenario.size(),
                "every scenario must have a recorded expectation");

        List<String> failures = new ArrayList<>();
        int envelopesCompared = 0;
        for (JsonNode scenario : scenarios.path("scenarios")) {
            String id = scenario.path("id").asText();
            Run run = run(scenario, scenarios.path("defaults"));
            JsonNode expected = expectedByScenario.get(id);

            List<Map<String, Object>> actual = new ArrayList<>();
            for (NotificationEvent envelope : run.envelopes) {
                actual.add(normalise(envelope));
            }
            List<Map<String, Object>> wanted = new ArrayList<>();
            for (JsonNode envelope : expected.path("envelopes")) {
                wanted.add(applyIntendedDifferences(envelope.path("event"), scenario, run));
            }

            if (actual.size() != wanted.size()) {
                failures.add(id + ": expected " + wanted.size() + " envelopes, got " + actual.size()
                        + "\n  expected txns " + txns(wanted) + "\n  actual   txns " + txns(actual));
                continue;
            }
            Map<String, Map<String, Object>> actualByTxn = byTransactionId(actual);
            Map<String, Map<String, Object>> wantedByTxn = byTransactionId(wanted);
            assertEquals(wanted.size(), wantedByTxn.size(), id + ": transactionIds must be unique");
            if (!actualByTxn.keySet().equals(wantedByTxn.keySet())) {
                failures.add(id + ": different recipients/channels"
                        + "\n  expected " + new TreeSet<>(wantedByTxn.keySet())
                        + "\n  actual   " + new TreeSet<>(actualByTxn.keySet()));
                continue;
            }
            for (String txn : wantedByTxn.keySet()) {
                envelopesCompared++;
                String diff = firstDifference(wantedByTxn.get(txn), actualByTxn.get(txn));
                if (diff != null) {
                    failures.add(id + " / " + txn + ": " + diff);
                }
            }
            // The order the producer was actually called in is a real observable — routing-row
            // file order crossed with recipient order — and a port must not reorder it silently.
            List<String> emissionOrder = new ArrayList<>();
            expected.path("emissionOrder").forEach(t -> emissionOrder.add(t.asText()));
            List<String> actualOrder = new ArrayList<>();
            run.envelopes.forEach(e -> actualOrder.add(e.getTransactionId()));
            if (!emissionOrder.equals(actualOrder)) {
                failures.add(id + ": emission ORDER differs\n  expected " + emissionOrder
                        + "\n  actual   " + actualOrder);
            }
        }
        assertTrue(failures.isEmpty(),
                "the thin path does not reproduce the golden master:\n\n" + String.join("\n\n", failures));
        assertEquals(57, envelopesCompared, "the fixture records 57 envelopes; all must be compared");
    }

    @Test
    @DisplayName("S10, S21 and S26 send nothing today and become one visible ledger row each")
    void zeroEnvelopeScenariosBecomeLedgerRows() throws Exception {
        JsonNode scenarios = read("golden/inputs/scenarios.json");
        Map<String, String> expectedCode = Map.of(
                // A transition with no routing row at all. Today: a log line inside the producer
                // and a message nobody knows was never sent.
                "S10-rate-closedafterrejection-no-routing", "NB_NO_ROUTING",
                "S26-escalate-has-no-routing-today", "NB_NO_ROUTING",
                // Routed, with a resolvable recipient, and no template for the key. Today: a
                // silent drop. The row carries the REAL channel, because by then the box knows
                // which channel it could not render for.
                "S21-routed-channel-without-template-emits-nothing", "NB_NO_TEMPLATE");

        for (JsonNode scenario : scenarios.path("scenarios")) {
            String id = scenario.path("id").asText();
            if (!expectedCode.containsKey(id)) {
                continue;
            }
            Run run = run(scenario, scenarios.path("defaults"));
            assertTrue(run.envelopes.isEmpty(), id + " must still send nothing");
            assertEquals(1, run.rows.size(), id + " must write exactly one row, not none and not several");
            DispatchLogEntry row = run.rows.get(0);
            assertEquals("SKIPPED", row.getStatus(), id + ": nothing is wrong with the event");
            assertEquals(expectedCode.get(id), row.getLastErrorCode(), id);
            assertEquals("RESOLVED", row.getSourcePath(), id + ": the row must own up to its path");
            assertNotNull(row.getLastErrorMessage(), id + ": a row must say why, not only that");
            if ("NB_NO_TEMPLATE".equals(expectedCode.get(id))) {
                assertEquals("EMAIL", row.getChannel(),
                        id + ": by now the box knows which channel it could not render for");
            } else {
                assertEquals("NONE", row.getChannel(),
                        id + ": the decision was taken before there was a channel to name");
                assertEquals("none", row.getRecipientValue());
                assertTrue(row.getTransactionId().endsWith(":NONE"),
                        id + ": the pseudo-channel keeps the ledger's unique key intact");
            }
        }
    }

    @Test
    @DisplayName("a contact-gated recipient is a visible row too, and does not cost the rest of the fan-out")
    void theContactGateIsVisible() throws Exception {
        JsonNode scenarios = read("golden/inputs/scenarios.json");
        for (JsonNode scenario : scenarios.path("scenarios")) {
            if (!"S02-apply-citizen-phone-only".equals(scenario.path("id").asText())) {
                continue;
            }
            Run run = run(scenario, scenarios.path("defaults"));
            assertEquals(2, run.envelopes.size(), "SMS and WHATSAPP still go");
            assertEquals(1, run.rows.size(), "the EMAIL row the citizen cannot receive is written down");
            assertEquals("NB_CONTACT_MISSING", run.rows.get(0).getLastErrorCode());
            assertEquals("EMAIL", run.rows.get(0).getChannel());
            assertEquals("SKIPPED", run.rows.get(0).getStatus());
            return;
        }
        throw new AssertionError("S02 is missing from the matrix");
    }

    @Test
    @DisplayName("the intended-differences table is stated, and is the ONLY thing allowed to differ")
    void theDifferencesTableIsExplicit() {
        assertEquals(1, INTENDED_DIFFERENCES.size(),
                "adding a difference is a decision; it belongs in the table with its reason, "
                        + "and the reason belongs in the commit message too");
        for (String[] difference : INTENDED_DIFFERENCES) {
            assertEquals(5, difference.length, "scenario, field, old, new, reason");
            assertFalse(difference[4].isBlank(), "a difference with no reason is a regression");
        }
    }

    // ---- driving one scenario ----------------------------------------------

    private static final class Run {
        final List<NotificationEvent> envelopes = new ArrayList<>();
        final List<DispatchLogEntry> rows = new ArrayList<>();
        /** legacy audience -> the ref the converter produced, for the templateKey rewrite. */
        final Map<String, String> audienceRefs = new LinkedHashMap<>();
    }

    private Run run(JsonNode scenario, JsonNode defaults) throws Exception {
        Run run = new Run();
        JsonNode world = merge(defaults.path("world"), scenario.path("world"));
        JsonNode config = merge(defaults.path("config"), scenario.path("config"));

        List<Map<String, Object>> routing = masterRows(scenario, "routing",
                "RAINMAKER-PGR.NotificationRouting");
        List<Map<String, Object>> templates = masterRows(scenario, "templates",
                "RAINMAKER-PGR.NotificationTemplate");
        List<Map<String, Object>> providerTemplates = masterRows(scenario, "providerTemplates",
                "RAINMAKER-PGR.NotificationProviderTemplate");

        // Re-derive the legacy -> scheme-reference mapping from the routing rows, independently of
        // the adapter's own index, so the templateKey rewrite below is a second opinion rather
        // than a restatement of the code under test.
        for (Map<String, Object> row : routing) {
            Object audience = row.get("audience");
            if (audience == null || String.valueOf(audience).isBlank()) {
                continue;
            }
            try {
                String ref = LegacyMasterAdapter.audienceRef(audience, row.get("assigneeOnly"));
                if (ref != null) {
                    run.audienceRefs.put(String.valueOf(audience).toUpperCase(Locale.ROOT), ref);
                }
            } catch (LegacyMasterAdapter.ConversionException ignored) {
                // a blank audience: dropped, exactly as the converter drops it
            }
        }

        ScenarioWorld scenarioWorld = new ScenarioWorld(world);
        NovuBridgeConfiguration bridgeConfig = new NovuBridgeConfiguration();
        bridgeConfig.setDefaultLocale(config.path("notificationDefaultLocale").asText("en_IN"));
        bridgeConfig.setRolePoolPageSize(config.path("notificationRolePoolPageSize").asInt(100));
        bridgeConfig.setRolePoolMaxPages(config.path("notificationRolePoolMaxPages").asInt(10));
        bridgeConfig.setUserHost("http://user/");
        bridgeConfig.setUserSearchPath("user/_search");

        DigitUserSearch users = scenarioWorld.userSearch(bridgeConfig);
        ActorRecipientResolver actors = new ActorRecipientResolver(new DigitUserHydrator(users));
        List<RecipientResolver> resolvers = List.of(actors, new EventRecipientsResolver(actors),
                new DigitRoleRecipientResolver(users, bridgeConfig));

        NotificationConfigRepository repository = scenarioWorld.config(routing, templates,
                providerTemplates, catalogue());

        DispatchPipelineService pipeline = mock(DispatchPipelineService.class);
        doAnswer(invocation -> {
            run.envelopes.add(invocation.getArgument(0));
            return DispatchResult.builder().valid(true).build();
        }).when(pipeline).process(any(NotificationEvent.class), anyBoolean(), any(), anyString());

        DispatchLogRepository ledger = mock(DispatchLogRepository.class);
        doAnswer(invocation -> {
            run.rows.add(invocation.getArgument(0));
            return null;
        }).when(ledger).upsert(any(DispatchLogEntry.class));

        NotificationResolver resolver = new NotificationResolver(repository, resolvers,
                scenarioWorld.locales(), new PlaceholderResolver(scenarioWorld.localization()),
                new TemplateRenderer(bridgeConfig.getDefaultLocale()), pipeline, ledger,
                bridgeConfig.getDefaultLocale(), 1000);

        ThinEvent event = ScenarioThinEventBuilder.build(scenario.path("request"), scenarioWorld);
        resolver.resolve(event, true);
        return run;
    }

    /** The committed PGR catalogue, so the fixture proves it covers every event PGR emits. */
    private List<CatalogueRow> catalogue() throws Exception {
        List<CatalogueRow> rows = new ArrayList<>();
        for (JsonNode row : read("golden/expected/NOTIFICATIONS.EventCatalogue.json")) {
            rows.add(new CatalogueRow(row.path("module").asText(), row.path("eventName").asText(),
                    row.path("entityType").asText(), row.path("label").asText(), List.of(),
                    row.path("active").asBoolean(true)));
        }
        return rows;
    }

    // ---- masters ------------------------------------------------------------

    /**
     * Per the fixture's contract: absent or {@code "seed"} is the committed seed copy, an inline
     * array REPLACES it, and {@code "<name>Append"} appends to whichever base was chosen.
     */
    private List<Map<String, Object>> masterRows(JsonNode scenario, String name, String seedFile)
            throws Exception {
        JsonNode masters = scenario.path("masters");
        JsonNode override = masters.path(name);
        List<Map<String, Object>> rows = new ArrayList<>();
        if (override.isArray()) {
            override.forEach(row -> rows.add(ScenarioWorld.toMap(row)));
        } else {
            read("golden/inputs/masters/" + seedFile + ".json").forEach(row -> rows.add(ScenarioWorld.toMap(row)));
        }
        JsonNode append = masters.path(name + "Append");
        if (append.isArray()) {
            append.forEach(row -> rows.add(ScenarioWorld.toMap(row)));
        }
        return rows;
    }

    // ---- comparison ---------------------------------------------------------

    /**
     * The minted envelope as the producer's own map: the same keys, in the same absent/present
     * shape. {@code templateId} and {@code contentVariables} are ABSENT rather than
     * present-and-null when there is no approved provider template, and {@code subject} is
     * present-and-null for SMS and WHATSAPP. That distinction is on the wire and is part of what
     * is being preserved.
     */
    private static Map<String, Object> normalise(NotificationEvent envelope) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("schemaVersion", envelope.getSchemaVersion());
        assertTrue(envelope.getEventId().matches("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"),
                "eventId must still be a uuid: " + envelope.getEventId());
        out.put("eventId", "<uuid>");
        out.put("eventType", envelope.getEventType());
        out.put("eventName", envelope.getEventName());
        assertTrue(envelope.getEventTime().endsWith("Z"), "eventTime must still be an ISO instant");
        out.put("eventTime", "<timestamp>");
        out.put("producer", envelope.getProducer());
        out.put("module", envelope.getModule());
        out.put("entityType", envelope.getEntityType());
        out.put("entityId", envelope.getEntityId());
        out.put("tenantId", envelope.getTenantId());
        out.put("channel", envelope.getChannel());
        out.put("subscriberId", envelope.getSubscriberId());
        Contact contact = envelope.getContact();
        Map<String, Object> contactMap = new LinkedHashMap<>();
        contactMap.put("userId", contact.getUserId());
        contactMap.put("type", contact.getType());
        contactMap.put("name", contact.getName());
        contactMap.put("phone", contact.getPhone());
        contactMap.put("email", contact.getEmail());
        contactMap.put("locale", contact.getLocale());
        out.put("contact", contactMap);
        out.put("renderedBody", envelope.getRenderedBody());
        out.put("subject", envelope.getSubject());
        out.put("transactionId", envelope.getTransactionId());
        if (envelope.getTemplateKey() != null && !envelope.getTemplateKey().isBlank()) {
            out.put("templateKey", envelope.getTemplateKey());
        }
        out.put("data", envelope.getData());
        if (envelope.getTemplateId() != null && !envelope.getTemplateId().isBlank()) {
            out.put("templateId", envelope.getTemplateId());
            if (envelope.getContentVariables() != null && !envelope.getContentVariables().isEmpty()) {
                out.put("contentVariables", envelope.getContentVariables());
            }
        }
        return out;
    }

    /**
     * The golden envelope, with the table's transformations applied. This is the ONE place a
     * difference is allowed to enter the comparison, and it has to be spelled out to get here.
     */
    private Map<String, Object> applyIntendedDifferences(JsonNode event, JsonNode scenario, Run run) {
        Map<String, Object> expected = MAPPER.convertValue(event, LinkedHashMap.class);
        Object templateKey = expected.get("templateKey");
        if (templateKey != null) {
            expected.put("templateKey", newTemplateKey(String.valueOf(templateKey), run));
        }
        return expected;
    }

    /**
     * {@code CITIZEN.ASSIGN.PENDINGATLME.SMS.en_IN} becomes
     * {@code COMPLAINTS.WORKFLOW.ASSIGN.PENDINGATLME.ACTOR:citizen.SMS.en_IN} — the
     * {@code uniqueIdentifier} of the {@code NOTIFICATIONS.Template} row that rendered. The
     * audience reference is the one the SCENARIO'S OWN routing rows produce, re-derived here from
     * the raw JSON, so a scenario with an {@code assigneeOnly} row (S15, S16) expects the pipe
     * chain and would fail if the adapter's join broke.
     */
    private String newTemplateKey(String oldKey, Run run) {
        String[] parts = oldKey.split("\\.");
        assertEquals(5, parts.length, "the old templateKey is AUDIENCE.ACTION.TOSTATE.CHANNEL.LOCALE: " + oldKey);
        String audience = parts[0];
        String ref = run.audienceRefs.getOrDefault(audience.toUpperCase(Locale.ROOT),
                LegacyMasterAdapter.audienceRef(audience, null));
        return "COMPLAINTS.WORKFLOW." + parts[1] + "." + parts[2] + "." + ref + "." + parts[3] + "." + parts[4];
    }

    private static String firstDifference(Map<String, Object> expected, Map<String, Object> actual) {
        for (Map.Entry<String, Object> entry : expected.entrySet()) {
            if (!actual.containsKey(entry.getKey())) {
                return "field '" + entry.getKey() + "' is MISSING (expected " + entry.getValue() + ")";
            }
            if (!java.util.Objects.equals(entry.getValue(), actual.get(entry.getKey()))) {
                return "field '" + entry.getKey() + "'\n    expected: " + entry.getValue()
                        + "\n    actual:   " + actual.get(entry.getKey());
            }
        }
        for (String key : actual.keySet()) {
            if (!expected.containsKey(key)) {
                return "field '" + key + "' is UNEXPECTED (actual " + actual.get(key) + ")";
            }
        }
        return null;
    }

    private static Map<String, Map<String, Object>> byTransactionId(List<Map<String, Object>> envelopes) {
        Map<String, Map<String, Object>> out = new LinkedHashMap<>();
        envelopes.forEach(e -> out.put(String.valueOf(e.get("transactionId")), e));
        return out;
    }

    private static List<String> txns(List<Map<String, Object>> envelopes) {
        List<String> out = new ArrayList<>();
        envelopes.forEach(e -> out.add(String.valueOf(e.get("transactionId"))));
        return out;
    }

    // ---- fixture plumbing ---------------------------------------------------

    /** Scenario overrides replace a key wholesale, exactly as the fixture's contract says. */
    private static JsonNode merge(JsonNode base, JsonNode override) {
        if (!override.isObject()) {
            return base;
        }
        var merged = base.deepCopy();
        override.fields().forEachRemaining(e -> ((com.fasterxml.jackson.databind.node.ObjectNode) merged)
                .set(e.getKey(), e.getValue()));
        return merged;
    }

    static JsonNode read(String resource) throws Exception {
        try (InputStream in = ThinEventParityTest.class.getClassLoader().getResourceAsStream(resource)) {
            assertNotNull(in, resource + " is not on the test classpath");
            return MAPPER.readTree(in);
        }
    }
}
