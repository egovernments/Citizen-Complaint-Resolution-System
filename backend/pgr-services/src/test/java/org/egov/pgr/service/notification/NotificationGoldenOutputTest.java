package org.egov.pgr.service.notification;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.util.MDMSUtils;
import org.egov.pgr.util.NotificationUtil;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.io.InputStream;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.mockito.Mockito.when;

/**
 * BACKWARD-COMPAT GATE (P1-9, §12.2). Proves the config-driven cutover is a behavioral no-op for SMS.
 *
 * For every §11 workflow transition this asserts the SET of (audience, channel, renderedBody) that the
 * config-driven {@link TemplateRenderer} produces — fed the seeded RAINMAKER-PGR.NotificationTemplate
 * rows — equals what the legacy {@link NotificationUtil#getCustomizedMsg(String, String, String, String)}
 * produces from the same rainmaker-pgr.json bodies (keyed PGR_&lt;ROLE&gt;_&lt;ACTION&gt;_&lt;STATUS&gt;_SMS_MESSAGE).
 *
 * Scope (per the prompt's explicit fallback + R14): restricted to SMS-only, and to
 * TemplateRenderer-vs-legacy *body equivalence*. The full NotificationService graph (workflow / HRMS /
 * user / localization HTTP calls) is intentionally NOT instantiated — body equivalence is the meaningful,
 * deterministic no-op assertion. WHATSAPP/EMAIL rows are net-new and excluded from the no-op gate.
 *
 * Determinism (R14): both paths render the SAME placeholder value map. The URL shortener + date are
 * supplied as fixed values, so no real shortener call or wall-clock date enters the comparison.
 *
 * Fixtures are copied verbatim from the authoritative seed + localisation files; see each fixture header.
 *   - notification/seed-templates.json     <- utilities/default-data-handler/.../RAINMAKER-PGR.NotificationTemplate.json
 *   - notification/seed-routing.json        <- utilities/default-data-handler/.../RAINMAKER-PGR.NotificationRouting.json
 *   - notification/legacy-localization.json <- utilities/default-data-handler/.../localisations/en_IN/rainmaker-pgr.json
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
public class NotificationGoldenOutputTest {

    private static final String TENANT = "ke.bomet";
    private static final String LOCALE = "en_IN";
    private static final String CHANNEL_SMS = "SMS";
    private static final String AUDIENCE_CITIZEN = "CITIZEN";
    private static final String AUDIENCE_EMPLOYEE = "EMPLOYEE";

    private final ObjectMapper mapper = new ObjectMapper();

    @Mock
    private MDMSUtils mdmsUtils;

    @Mock
    private PGRConfiguration config;

    @InjectMocks
    private TemplateRenderer renderer;

    @InjectMocks
    private NotificationRouter router;

    /** Legacy body source: getCustomizedMsg only parses the localization JSON string passed in. */
    private final NotificationUtil legacyUtil = new NotificationUtil();

    /** The serialized rainmaker-pgr.json (subset) fed to NotificationUtil.getCustomizedMsg. */
    private String legacyLocalizationJson;

    /**
     * Deterministic placeholder values shared by BOTH render paths so the comparison isolates the
     * template body, not the (already unit-tested) placeholder/shortener/date plumbing.
     */
    private Map<String, String> placeholderValues;

    @BeforeEach
    void setUp() throws Exception {
        when(config.getNotificationDefaultLocale()).thenReturn(LOCALE);
        when(mdmsUtils.getNotificationTemplates(TENANT)).thenReturn(loadTemplates());
        when(mdmsUtils.getNotificationRouting(TENANT)).thenReturn(loadRouting());
        legacyLocalizationJson = mapper.writeValueAsString(loadJson("notification/legacy-localization.json"));

        placeholderValues = new LinkedHashMap<>();
        placeholderValues.put("id", "PGR-2026-000123");
        placeholderValues.put("complaint_type", "Garbage not collected");
        placeholderValues.put("date", "29/06/2026");        // fixed (DATE_PATTERN dd/MM/yyyy), no wall clock
        placeholderValues.put("emp_name", "Jane Mwangi");
        placeholderValues.put("emp_designation", "Field Officer");
        placeholderValues.put("emp_department", "Sanitation");
        placeholderValues.put("ao_designation", "Assigning Officer");
        placeholderValues.put("ulb", "Bomet Municipality");
        placeholderValues.put("additional_comments", "Out of scope");
        placeholderValues.put("rating", "5");
        placeholderValues.put("status", "Resolved");
        placeholderValues.put("download_link", "https://sho.rt/abc"); // fixed shortener result, no HTTP call
    }

    // ---- §11 transition table (SMS-only, the no-op-cutover gate) ----------------------------------

    @Test
    void apply_citizenConfirmationSms() {
        assertGolden("APPLY", "PENDINGFORASSIGNMENT");
    }

    @Test
    void assign_citizenAndEmployeeSms() {
        assertGolden("ASSIGN", "PENDINGATLME");
    }

    @Test
    void reassign_citizenAndEmployeeSms() {
        assertGolden("REASSIGN", "PENDINGFORREASSIGNMENT");
    }

    @Test
    void reject_citizenSms() {
        assertGolden("REJECT", "REJECTED");
    }

    @Test
    void resolve_citizenSms() {
        assertGolden("RESOLVE", "RESOLVED");
    }

    @Test
    void reopen_citizenAndEmployeeSms() {
        assertGolden("REOPEN", "PENDINGFORASSIGNMENT");
    }

    @Test
    void rate_afterResolution_employeeSms() {
        assertGolden("RATE", "CLOSEDAFTERRESOLUTION");
    }

    @Test
    void rate_afterRejection_employeeSms() {
        assertGolden("RATE", "CLOSEDAFTERREJECTION");
    }

    /**
     * Sweep: assert EVERY routing row across the whole §11 table at once, so a stray routing/template
     * row that no per-transition test covers still trips the gate. This is the real all-up GATE.
     */
    @Test
    void allTransitions_configDrivenSetEqualsLegacySet() {
        List<Object> routing = loadRouting();
        assertFalse(routing.isEmpty(), "routing seed must not be empty");
        Set<String> configAll = new TreeSet<>();
        Set<String> legacyAll = new TreeSet<>();
        for (Object rowObj : routing) {
            Map<String, Object> row = asMap(rowObj);
            String action = (String) row.get("action");
            String toState = (String) row.get("toState");
            configAll.addAll(configDrivenSet(action, toState));
            legacyAll.addAll(legacySet(action, toState));
        }
        assertEquals(legacyAll, configAll,
                "config-driven SMS output set diverged from legacy across the full §11 table");
    }

    // ---- assertion core --------------------------------------------------------------------------

    /**
     * For one transition, assert the config-driven set of (audience,channel,renderedBody) equals the
     * legacy set, AND that the set is non-empty (a transition that emits nothing on both sides would
     * silently pass an equals() of two empty sets — that is not a no-op proof).
     */
    private void assertGolden(String action, String toState) {
        Set<String> config = configDrivenSet(action, toState);
        Set<String> legacy = legacySet(action, toState);
        assertFalse(config.isEmpty(),
                "config-driven path produced no SMS for " + action + "->" + toState
                        + " (routing/template seed gap)");
        assertEquals(legacy, config,
                "config-driven SMS output diverged from legacy for " + action + "->" + toState);
    }

    /**
     * Config-driven path: route the transition (real NotificationRouter over the seeded routing rows),
     * normalize each subscriber relationship to its audience, then render via the real TemplateRenderer
     * over the seeded template rows. Restricted to the SMS channel.
     */
    private Set<String> configDrivenSet(String action, String toState) {
        Set<String> out = new LinkedHashSet<>();
        List<RoutingMatch> matches = router.route(TENANT, "PGR", null, action, toState);
        for (RoutingMatch match : matches) {
            if (!CHANNEL_SMS.equals(match.getChannel())) continue;
            String audience = match.getAudience();
            String body = renderer.render(TENANT, audience, action, toState,
                    CHANNEL_SMS, LOCALE, placeholderValues);
            if (body != null) {
                out.add(key(audience, CHANNEL_SMS, body));
            }
        }
        return out;
    }

    /**
     * Legacy path: for the same routed audiences, fetch the body via NotificationUtil.getCustomizedMsg
     * (code = PGR_&lt;ROLE&gt;_&lt;ACTION&gt;_&lt;STATUS&gt;_SMS_MESSAGE) and fill the SAME placeholder map.
     * Driven off the routing seed so legacy and config-driven cover identical (audience) sets.
     */
    private Set<String> legacySet(String action, String toState) {
        Set<String> out = new LinkedHashSet<>();
        List<RoutingMatch> matches = router.route(TENANT, "PGR", null, action, toState);
        for (RoutingMatch match : matches) {
            if (!CHANNEL_SMS.equals(match.getChannel())) continue;
            String role = match.getAudience();
            String raw = legacyUtil.getCustomizedMsg(action, toState, role, legacyLocalizationJson);
            assertNotNull(raw, "legacy localization missing body for role=" + role
                    + " code=PGR_" + role + "_" + action + "_" + toState + "_SMS_MESSAGE");
            out.add(key(role, CHANNEL_SMS, substitute(raw, placeholderValues)));
        }
        return out;
    }

    // ---- helpers ---------------------------------------------------------------------------------

    private static String key(String audience, String channel, String body) {
        return audience + "" + channel + "" + body;
    }

    /** Same substitution semantics TemplateRenderer applies, so both sides fill placeholders identically. */
    private static String substitute(String body, Map<String, String> values) {
        String out = body;
        for (Map.Entry<String, String> e : values.entrySet()) {
            if (e.getKey() != null && e.getValue() != null) {
                out = out.replace("{" + e.getKey() + "}", e.getValue());
            }
        }
        return out;
    }

    private List<Object> loadTemplates() {
        List<Map<String, Object>> rows = readList("notification/seed-templates.json");
        return new ArrayList<>(rows);
    }

    private List<Object> loadRouting() {
        List<Map<String, Object>> rows = readList("notification/seed-routing.json");
        return new ArrayList<>(rows);
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> asMap(Object o) {
        return (Map<String, Object>) o;
    }

    private List<Map<String, Object>> readList(String resource) {
        try (InputStream in = cp(resource)) {
            return mapper.readValue(in, new TypeReference<List<Map<String, Object>>>() {});
        } catch (Exception e) {
            throw new IllegalStateException("Failed to load fixture " + resource, e);
        }
    }

    private Map<String, Object> loadJson(String resource) {
        try (InputStream in = cp(resource)) {
            return mapper.readValue(in, new TypeReference<Map<String, Object>>() {});
        } catch (Exception e) {
            throw new IllegalStateException("Failed to load fixture " + resource, e);
        }
    }

    private static InputStream cp(String resource) {
        InputStream in = NotificationGoldenOutputTest.class.getClassLoader().getResourceAsStream(resource);
        if (in == null) throw new IllegalStateException("Missing test resource: " + resource);
        return in;
    }
}
