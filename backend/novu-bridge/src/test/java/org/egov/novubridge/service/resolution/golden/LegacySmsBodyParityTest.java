package org.egov.novubridge.service.resolution.golden;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.egov.novubridge.service.resolution.TemplateRenderer;
import org.egov.novubridge.service.resolution.config.NotificationConfigRows.RoutingRow;
import org.egov.novubridge.service.resolution.config.NotificationConfigRows.TemplateRow;
import org.egov.novubridge.service.resolution.digit.LegacyMasterAdapter;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.InputStream;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * <b>THE LEGACY SMS-BODY PARITY GATE.</b> Re-homed from {@code pgr-services}, where it lived as
 * {@code NotificationGoldenOutputTest} until commit {@code 44ff7b20} deleted the renderer it drove.
 *
 * <p>It is the only thing that ties the SHIPPED {@code NotificationTemplate} SMS bodies back to the
 * pre-2025 <b>hardcoded</b> localization messages — the {@code PGR_<ROLE>_<ACTION>_<STATUS>_SMS_MESSAGE}
 * codes the deleted {@code NotificationUtil.getCustomizedMsg} looked up. Without it, a seed row
 * reworded by hand changes what a citizen receives and nothing anywhere says so.
 *
 * <p>The subject moved but the assertion did not: for every {@code (role, action, status)} the old
 * test covered, what the renderer produces for the shipped template must equal the legacy message
 * with the SAME placeholder values. What changed is only which renderer — the bridge's
 * {@link TemplateRenderer}, keyed {@code (eventName, audience, channel, locale)} — and how the
 * template row gets there.
 *
 * <h2>Both namespaces, one expectation</h2>
 * The comparison runs TWICE, against the two shapes a live tenant can be in, because the two must
 * say the same words:
 * <ol>
 *   <li><b>{@code LEGACY-ADAPTED}</b> — the shipped {@code RAINMAKER-PGR.Notification*} rows fed
 *       through the real {@link LegacyMasterAdapter}. This is the path a tenant the seeder has not
 *       reached yet takes on every read, so it is not a hypothetical.</li>
 *   <li><b>{@code NOTIFICATIONS}</b> — the committed new-namespace defaults
 *       ({@code NOTIFICATIONS.Routing.json} / {@code NOTIFICATIONS.Template.json}), read as they
 *       ship. This is what a tenant gets after the copy step runs.</li>
 * </ol>
 * {@link #bothNamespacesRenderTheSameWords()} additionally asserts the two produce an identical
 * set, which is the migration's real promise: copying a tenant's rows must not change a message.
 *
 * <h2>Scope — unchanged from the deleted test</h2>
 * SMS only, {@code en_IN} only, body equivalence only. WHATSAPP and EMAIL rows are net-new and have
 * no legacy body to be equal to. Both sides are handed the SAME fixed placeholder map, so the
 * comparison isolates the template body from the shortener, the clock and the placeholder plumbing
 * — all of which are tested elsewhere.
 *
 * <h2>The {@code hi_IN} rows are NOT gated, and that is a finding, not an omission</h2>
 * The seed also ships six {@code hi_IN} SMS templates, which this gate does not reach (it renders
 * {@code en_IN}) and which the deleted test did not reach either. They were checked by hand while
 * re-homing this test, against {@code localisations-dev/hi_IN/rainmaker-pgr.json}, and they do
 * <b>not</b> match:
 * <ul>
 *   <li>{@code PGR_CITIZEN_ASSIGN_PENDINGATLME_SMS_MESSAGE} has no {@code hi_IN} legacy message at
 *       all;</li>
 *   <li>the other five — {@code APPLY.PENDINGFORASSIGNMENT}, {@code REASSIGN.PENDINGFORREASSIGNMENT},
 *       {@code REJECT.REJECTED}, {@code RESOLVE.RESOLVED}, {@code REOPEN.PENDINGFORASSIGNMENT} —
 *       are reworded translations of the legacy Hindi, same meaning, different words.</li>
 * </ul>
 * So the Hindi bodies a tenant receives ALREADY changed at some point before this cutover. That is
 * a pre-existing divergence in shipped data, not something this test can assert away, and adding a
 * knowingly-red assertion here would only stop the en_IN gate from being read. Deciding whether the
 * Hindi seed or the Hindi localisation is the intended wording is a data decision for whoever owns
 * the seed; this note exists so the next person does not have to re-discover it.
 *
 * <p>Every fixture this test reads is drift-guarded by {@link LegacySmsBodyFixtureSyncTest}.
 */
class LegacySmsBodyParityTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private static final String LOCALE = "en_IN";
    private static final String CHANNEL_SMS = "SMS";
    private static final String EVENT_PREFIX = "COMPLAINTS.WORKFLOW.";

    /** The seed shape the whole gate is sized against; a shrunken seed must not quietly pass. */
    private static final int SEED_ROUTING_ROWS = 24;
    private static final int SEED_TEMPLATE_ROWS = 42;
    private static final int LEGACY_MESSAGES = 11;

    /**
     * The eight {@code (audience, SMS)} pairs the shipped routing seed produces across the whole
     * transition table. Asserted everywhere a set is compared, so an empty-vs-empty {@code equals}
     * can never read as parity.
     */
    private static final int SMS_ROUTING_ROWS = 8;

    private static final TemplateRenderer RENDERER = new TemplateRenderer(LOCALE);

    /**
     * Deterministic placeholder values shared by BOTH render paths, verbatim from the deleted test.
     * {@code date} is fixed rather than formatted from a clock and {@code download_link} is a fixed
     * shortener result rather than an HTTP call, so the comparison cannot depend on the machine.
     */
    private static final Map<String, String> VALUES = new LinkedHashMap<>();

    static {
        VALUES.put("id", "PGR-2026-000123");
        VALUES.put("complaint_type", "Garbage not collected");
        VALUES.put("date", "29/06/2026");
        VALUES.put("emp_name", "Jane Mwangi");
        VALUES.put("emp_designation", "Field Officer");
        VALUES.put("emp_department", "Sanitation");
        VALUES.put("ao_designation", "Assigning Officer");
        VALUES.put("ulb", "Bomet Municipality");
        VALUES.put("additional_comments", "Out of scope");
        VALUES.put("rating", "5");
        VALUES.put("status", "Resolved");
        VALUES.put("download_link", "https://sho.rt/abc");
    }

    // ---- the transition table (SMS-only), one test per case, as before -------------------------

    @Test
    void apply_citizenConfirmationSms() throws Exception {
        assertGolden("APPLY", "PENDINGFORASSIGNMENT", 1);
    }

    @Test
    void assign_citizenAndEmployeeSms() throws Exception {
        assertGolden("ASSIGN", "PENDINGATLME", 2);
    }

    /**
     * EMPLOYEE was dropped from this transition on the cutover branch (REASSIGN ->
     * PENDINGFORREASSIGNMENT has no assignee), so it notifies the CITIZEN only — the same reading
     * the deleted test already carried.
     */
    @Test
    void reassign_citizenSms() throws Exception {
        assertGolden("REASSIGN", "PENDINGFORREASSIGNMENT", 1);
    }

    @Test
    void reject_citizenSms() throws Exception {
        assertGolden("REJECT", "REJECTED", 1);
    }

    @Test
    void resolve_citizenSms() throws Exception {
        assertGolden("RESOLVE", "RESOLVED", 1);
    }

    /** EMPLOYEE dropped here too (REOPEN -> PENDINGFORASSIGNMENT has no assignee). */
    @Test
    void reopen_citizenSms() throws Exception {
        assertGolden("REOPEN", "PENDINGFORASSIGNMENT", 1);
    }

    @Test
    void rate_afterResolution_employeeSms() throws Exception {
        assertGolden("RATE", "CLOSEDAFTERRESOLUTION", 1);
    }

    /**
     * RATE -> CLOSEDAFTERREJECTION has no assignee, so its routing rows were trimmed and the
     * transition emits nothing. This asserts the honest behaviour — both paths route to no one —
     * rather than the old employee-SMS parity, which no longer applies.
     */
    @Test
    @DisplayName("RATE -> CLOSEDAFTERREJECTION emits no SMS on either side, in both namespaces")
    void rate_afterRejection_emitsNothing() throws Exception {
        for (Config config : configs()) {
            assertTrue(configDrivenSet(config, "RATE", "CLOSEDAFTERREJECTION").isEmpty(),
                    config.name + ": RATE->CLOSEDAFTERREJECTION must emit no SMS after the "
                            + "EMPLOYEE-on-no-assignee trim");
            assertTrue(legacySet(config, "RATE", "CLOSEDAFTERREJECTION").isEmpty(),
                    config.name + ": the legacy path must also route to no one for "
                            + "RATE->CLOSEDAFTERREJECTION (no routing rows)");
        }
    }

    /**
     * The all-up gate: every routing row in the seed at once, so a stray row that no per-transition
     * test names still trips it.
     */
    @Test
    @DisplayName("every seeded SMS routing row renders the legacy message, in both namespaces")
    void allTransitions_configDrivenSetEqualsLegacySet() throws Exception {
        for (Config config : configs()) {
            Set<String> configAll = new TreeSet<>();
            Set<String> legacyAll = new TreeSet<>();
            int rowsCompared = 0;
            for (RoutingRow row : config.routing) {
                if (!row.active() || !CHANNEL_SMS.equalsIgnoreCase(row.channel())) {
                    continue;
                }
                rowsCompared++;
                String[] transition = transition(row);
                configAll.addAll(configDrivenSet(config, transition[0], transition[1]));
                legacyAll.addAll(legacySet(config, transition[0], transition[1]));
            }
            assertEquals(SMS_ROUTING_ROWS, rowsCompared,
                    config.name + ": the shipped seed has " + SMS_ROUTING_ROWS + " active SMS routing "
                            + "rows; comparing a different number means the seed moved under the gate");
            assertEquals(SMS_ROUTING_ROWS, legacyAll.size(),
                    config.name + ": every SMS routing row must contribute one legacy body");
            assertEquals(legacyAll, configAll,
                    config.name + ": the shipped SMS bodies diverged from the legacy hardcoded "
                            + "messages across the full transition table");
        }
    }

    /**
     * The migration's promise, stated as an assertion: running the copy step must not change a
     * single word. If this is red and {@link #allTransitions_configDrivenSetEqualsLegacySet()} is
     * green, the two namespaces disagree with each other while both happening to match the legacy
     * messages — which cannot happen, and is worth failing loudly on if it ever does.
     */
    @Test
    @DisplayName("the legacy-adapted and NOTIFICATIONS namespaces render identical SMS bodies")
    void bothNamespacesRenderTheSameWords() throws Exception {
        List<Config> configs = configs();
        assertEquals(2, configs.size(), "both namespaces must be exercised");
        Set<String> first = wholeTableSet(configs.get(0));
        Set<String> second = wholeTableSet(configs.get(1));
        assertEquals(SMS_ROUTING_ROWS, first.size(),
                configs.get(0).name + ": expected " + SMS_ROUTING_ROWS + " rendered SMS bodies");
        assertEquals(first, second, "copying a tenant from RAINMAKER-PGR.* to NOTIFICATIONS.* "
                + "changes what it sends — the two masters must be the same words");
    }

    /** The fixtures are the shipped shape, so the gate cannot be sized down without saying so. */
    @Test
    @DisplayName("the fixtures are the shipped seed, at the size this gate is written against")
    void theFixturesAreTheShippedSeedAtTheExpectedSize() throws Exception {
        assertEquals(SEED_ROUTING_ROWS, rows(LEGACY_ROUTING).size(), "legacy routing seed rows");
        assertEquals(SEED_TEMPLATE_ROWS, rows(LEGACY_TEMPLATES).size(), "legacy template seed rows");
        assertEquals(SEED_ROUTING_ROWS, rows(NEW_ROUTING).size(), "NOTIFICATIONS.Routing rows");
        assertEquals(SEED_TEMPLATE_ROWS, rows(NEW_TEMPLATES).size(), "NOTIFICATIONS.Template rows");
        assertEquals(LEGACY_MESSAGES, legacyMessages().size(),
                "the legacy localization fixture carries " + LEGACY_MESSAGES + " PGR SMS messages");
        for (Config config : configs()) {
            assertEquals(SEED_ROUTING_ROWS, config.routing.size(), config.name + " routing rows");
            assertEquals(SEED_TEMPLATE_ROWS, config.templates.size(), config.name + " template rows");
        }
    }

    /**
     * The reverse audience mapping this test uses to find a legacy message code is DERIVED from the
     * real adapter, not written down here — and it has to stay one-to-one, or a lookup would be
     * ambiguous and the gate would be comparing the wrong message.
     */
    @Test
    @DisplayName("the audience-ref to legacy-role mapping is derived from the adapter and is 1:1")
    void theReverseAudienceMappingIsUnambiguous() throws Exception {
        Map<String, String> byRef = legacyRoleByRef();
        assertEquals(Set.of("ACTOR:citizen", "ACTOR:assignee"), byRef.keySet(),
                "the shipped seed has exactly two audiences");
        assertEquals("CITIZEN", byRef.get("ACTOR:citizen"));
        assertEquals("EMPLOYEE", byRef.get("ACTOR:assignee"));
        assertEquals(new LinkedHashSet<>(byRef.values()).size(), byRef.size(),
                "two audience refs mapping to one legacy role would make the code lookup ambiguous");
    }

    // ---- assertion core ------------------------------------------------------------------------

    /**
     * For one transition and BOTH namespaces: the rendered set equals the legacy set, and is
     * non-empty at the expected size. A transition that emitted nothing on both sides would pass an
     * {@code equals} of two empty sets — that is not a parity proof, which is why the count is here.
     */
    private void assertGolden(String action, String toState, int expectedRecipients) throws Exception {
        for (Config config : configs()) {
            Set<String> rendered = configDrivenSet(config, action, toState);
            Set<String> legacy = legacySet(config, action, toState);
            assertFalse(rendered.isEmpty(), config.name + ": produced no SMS for " + action + "->"
                    + toState + " (routing/template seed gap)");
            assertEquals(expectedRecipients, legacy.size(), config.name + ": " + action + "->" + toState
                    + " must route to " + expectedRecipients + " SMS audience(s)");
            assertEquals(legacy, rendered, config.name + ": the shipped SMS body diverged from the "
                    + "legacy hardcoded message for " + action + "->" + toState);
        }
    }

    /**
     * What ships: route the transition over the config's own routing rows, then render each matched
     * {@code (eventName, audience, SMS, en_IN)} through the real {@link TemplateRenderer}. Keyed on
     * the LEGACY role so both sides of the comparison speak the same vocabulary.
     */
    private Set<String> configDrivenSet(Config config, String action, String toState) throws Exception {
        Set<String> out = new LinkedHashSet<>();
        for (RoutingRow row : matching(config, action, toState)) {
            String body = RENDERER.render(config.templates, row.eventName(), row.audience(),
                    CHANNEL_SMS, LOCALE, VALUES);
            if (body != null) {
                out.add(key(legacyRole(row.audience()), body));
            }
        }
        return out;
    }

    /**
     * The golden set: for the SAME routed audiences, the body the deleted hardcoded path used —
     * {@code PGR_<ROLE>_<ACTION>_<STATUS>_SMS_MESSAGE} — filled with the SAME placeholder map.
     * Driven off the routing rows so golden and rendered cover identical audience sets.
     */
    private Set<String> legacySet(Config config, String action, String toState) throws Exception {
        Map<String, String> messages = legacyMessages();
        Set<String> out = new LinkedHashSet<>();
        for (RoutingRow row : matching(config, action, toState)) {
            String role = legacyRole(row.audience());
            String code = "PGR_" + role + "_" + action.toUpperCase(Locale.ROOT) + "_"
                    + toState.toUpperCase(Locale.ROOT) + "_SMS_MESSAGE";
            String raw = messages.get(code);
            assertNotNull(raw, config.name + ": legacy localization has no body for code " + code);
            out.add(key(role, substitute(raw, VALUES)));
        }
        return out;
    }

    private Set<String> wholeTableSet(Config config) throws Exception {
        Set<String> out = new TreeSet<>();
        for (RoutingRow row : config.routing) {
            if (!row.active() || !CHANNEL_SMS.equalsIgnoreCase(row.channel())) {
                continue;
            }
            String[] transition = transition(row);
            out.addAll(configDrivenSet(config, transition[0], transition[1]));
        }
        return out;
    }

    private List<RoutingRow> matching(Config config, String action, String toState) {
        List<RoutingRow> out = new ArrayList<>();
        for (RoutingRow row : config.routing) {
            if (!row.active() || !CHANNEL_SMS.equalsIgnoreCase(row.channel())) {
                continue;
            }
            String[] transition = transition(row);
            if (transition[0].equalsIgnoreCase(action) && transition[1].equalsIgnoreCase(toState)) {
                out.add(row);
            }
        }
        return out;
    }

    /** {@code COMPLAINTS.WORKFLOW.ASSIGN.PENDINGATLME} back to {@code (ASSIGN, PENDINGATLME)}. */
    private static String[] transition(RoutingRow row) {
        String eventName = row.eventName();
        assertTrue(eventName != null && eventName.startsWith(EVENT_PREFIX),
                "a PGR routing row's eventName must be " + EVENT_PREFIX + "<ACTION>.<TOSTATE>: " + eventName);
        String[] parts = eventName.substring(EVENT_PREFIX.length()).split("\\.");
        assertEquals(2, parts.length, "eventName must carry exactly ACTION and TOSTATE: " + eventName);
        return parts;
    }

    private String legacyRole(String audienceRef) throws Exception {
        String role = legacyRoleByRef().get(audienceRef);
        assertNotNull(role, "no legacy role maps to audience ref '" + audienceRef + "'; the legacy "
                + "SMS message codes are keyed by role, so an unmapped audience cannot be compared");
        return role;
    }

    /** {@code ACTOR:citizen -> CITIZEN}, derived by running the REAL adapter over the legacy seed. */
    private Map<String, String> legacyRoleByRef() throws Exception {
        Map<String, String> byRef = new LinkedHashMap<>();
        for (Map<String, Object> row : rows(LEGACY_ROUTING)) {
            String ref = LegacyMasterAdapter.audienceRef(row.get("audience"), row.get("assigneeOnly"));
            if (ref != null) {
                byRef.put(ref, String.valueOf(row.get("audience")).toUpperCase(Locale.ROOT));
            }
        }
        return byRef;
    }

    private static String key(String role, String body) {
        return role + "\u0000" + CHANNEL_SMS + "\u0000" + body;
    }

    /** The substitution {@link TemplateRenderer} applies, so both sides fill placeholders alike. */
    private static String substitute(String body, Map<String, String> values) {
        String out = body;
        for (Map.Entry<String, String> entry : values.entrySet()) {
            if (entry.getKey() != null && entry.getValue() != null) {
                out = out.replace("{" + entry.getKey() + "}", entry.getValue());
            }
        }
        return out;
    }

    // ---- the two namespaces --------------------------------------------------------------------

    static final String LEGACY_ROUTING = "golden/inputs/masters/RAINMAKER-PGR.NotificationRouting.json";
    static final String LEGACY_TEMPLATES = "golden/inputs/masters/RAINMAKER-PGR.NotificationTemplate.json";
    static final String NEW_ROUTING = "golden/expected/NOTIFICATIONS.Routing.json";
    static final String NEW_TEMPLATES = "golden/expected/NOTIFICATIONS.Template.json";
    static final String LEGACY_LOCALIZATION = "notification/legacy-localization.json";

    private static final class Config {
        final String name;
        final List<RoutingRow> routing;
        final List<TemplateRow> templates;

        Config(String name, List<RoutingRow> routing, List<TemplateRow> templates) {
            this.name = name;
            this.routing = routing;
            this.templates = templates;
        }
    }

    private List<Config> configs() throws Exception {
        return List.of(legacyAdapted(), newNamespace());
    }

    /** The path a tenant the seeder has not reached yet takes: legacy rows, adapted on every read. */
    private Config legacyAdapted() throws Exception {
        List<Map<String, Object>> routingRows = rows(LEGACY_ROUTING);
        Map<String, String> index = LegacyMasterAdapter.buildAudienceIndex(routingRows);
        List<RoutingRow> routing = new ArrayList<>();
        for (Map<String, Object> row : routingRows) {
            RoutingRow converted = LegacyMasterAdapter.convertRouting(row);
            if (converted != null) {
                routing.add(converted);
            }
        }
        List<TemplateRow> templates = new ArrayList<>();
        for (Map<String, Object> row : rows(LEGACY_TEMPLATES)) {
            TemplateRow converted = LegacyMasterAdapter.convertTemplate(row, index);
            if (converted != null) {
                templates.add(converted);
            }
        }
        return new Config("LEGACY-ADAPTED", routing, templates);
    }

    /** The path a tenant takes after the copy step: the committed {@code NOTIFICATIONS.*} defaults. */
    private Config newNamespace() throws Exception {
        List<RoutingRow> routing = new ArrayList<>();
        for (Map<String, Object> row : rows(NEW_ROUTING)) {
            routing.add(new RoutingRow(text(row.get("module")), text(row.get("eventName")),
                    text(row.get("audience")), text(row.get("channel")), truthy(row.get("active"))));
        }
        List<TemplateRow> templates = new ArrayList<>();
        for (Map<String, Object> row : rows(NEW_TEMPLATES)) {
            templates.add(new TemplateRow(text(row.get("module")), text(row.get("eventName")),
                    text(row.get("audience")), text(row.get("channel")), text(row.get("locale")),
                    row.get("subject") == null ? null : String.valueOf(row.get("subject")),
                    row.get("body") == null ? null : String.valueOf(row.get("body")),
                    truthy(row.get("active"))));
        }
        return new Config("NOTIFICATIONS", routing, templates);
    }

    // ---- fixtures ------------------------------------------------------------------------------

    /** code -> message, first wins: the removed {@code getCustomizedMsg} lookup, verbatim. */
    private Map<String, String> legacyMessages() throws Exception {
        Map<String, String> byCode = new LinkedHashMap<>();
        JsonNode root = read(LEGACY_LOCALIZATION);
        for (JsonNode message : root.path("messages")) {
            byCode.putIfAbsent(message.path("code").asText(), message.path("message").asText());
        }
        assertFalse(byCode.isEmpty(), "the legacy localization fixture is empty");
        return byCode;
    }

    @SuppressWarnings("unchecked")
    static List<Map<String, Object>> rows(String resource) throws Exception {
        List<Map<String, Object>> out = new ArrayList<>();
        JsonNode array = read(resource);
        assertTrue(array.isArray(), resource + " must be a JSON array");
        array.forEach(row -> out.add(MAPPER.convertValue(row, LinkedHashMap.class)));
        return out;
    }

    static JsonNode read(String resource) throws Exception {
        try (InputStream in = LegacySmsBodyParityTest.class.getClassLoader().getResourceAsStream(resource)) {
            assertNotNull(in, resource + " is not on the test classpath");
            return MAPPER.readTree(in);
        }
    }

    private static String text(Object value) {
        return value == null ? null : String.valueOf(value);
    }

    private static boolean truthy(Object value) {
        if (value instanceof Boolean) {
            return (Boolean) value;
        }
        assertNull(value, "an 'active' column must be a boolean or absent, got: " + value);
        return true;
    }
}
