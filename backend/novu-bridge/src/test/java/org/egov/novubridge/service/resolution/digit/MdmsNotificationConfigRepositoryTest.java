package org.egov.novubridge.service.resolution.digit;

import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.service.resolution.config.ConfigSourceReport;
import org.egov.novubridge.service.resolution.config.NotificationConfigRows.RoutingRow;
import org.egov.novubridge.service.resolution.config.NotificationConfigRows.TemplateRow;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.web.client.RestTemplate;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * The config reader's three promises: every page, stale beats empty, and the legacy namespace is
 * a per-tenant all-or-nothing fallback.
 *
 * <p>Each is a behaviour whose absence looks like working software. A single-page read notifies
 * the first two hundred routing rows and silently never fires the two-hundred-and-first. A cached
 * empty turns a one-second MDMS blip into a minute of silence. A per-ROW namespace fallback
 * produces a tenant whose routing comes from one vocabulary and whose templates come from
 * another, which nobody can debug at 2am.
 */
class MdmsNotificationConfigRepositoryTest {

    private RestTemplate restTemplate;
    private NovuBridgeConfiguration config;

    @BeforeEach
    void setUp() {
        restTemplate = mock(RestTemplate.class);
        config = new NovuBridgeConfiguration();
        config.setMdmsHost("http://mdms");
        config.setMdmsSearchPath("/mdms-v2/v2/_search");
        config.setNotificationConfigNamespace("NOTIFICATIONS");
        config.setNotificationConfigCacheTtlMs(60_000L);
        config.setNotificationConfigPageSize(2);
        config.setNotificationConfigMaxPages(10);
    }

    /** One MDMS record wrapper, as the service actually answers. */
    private static Map<String, Object> record(Map<String, Object> data, boolean isActive) {
        Map<String, Object> wrapper = new LinkedHashMap<>();
        wrapper.put("isActive", isActive);
        wrapper.put("data", data);
        return wrapper;
    }

    private static Map<String, Object> routingData(String eventName, String audience, String channel) {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("module", "Complaints");
        data.put("eventName", eventName);
        data.put("audience", audience);
        data.put("channel", channel);
        data.put("active", true);
        return data;
    }

    @SuppressWarnings("unchecked")
    private void answer(String schemaCode, List<List<Map<String, Object>>> pages) {
        AtomicInteger page = new AtomicInteger();
        when(restTemplate.exchange(anyString(), eq(HttpMethod.POST), any(HttpEntity.class), eq(Map.class)))
                .thenAnswer(invocation -> {
                    HttpEntity<Map<String, Object>> entity = invocation.getArgument(2);
                    Map<String, Object> criteria =
                            (Map<String, Object>) entity.getBody().get("MdmsCriteria");
                    if (!schemaCode.equals(criteria.get("schemaCode"))) {
                        return ResponseEntity.ok(Map.of("mdms", List.of()));
                    }
                    int index = page.getAndIncrement();
                    List<Map<String, Object>> rows = index < pages.size() ? pages.get(index) : List.of();
                    return ResponseEntity.ok(Map.of("mdms", rows));
                });
    }

    // ---- pagination ---------------------------------------------------------

    @Test
    @DisplayName("every page is read, not only the first")
    void everyPageIsRead() {
        answer("NOTIFICATIONS.Routing", List.of(
                List.of(record(routingData("E", "ACTOR:citizen", "SMS"), true),
                        record(routingData("E", "ACTOR:citizen", "EMAIL"), true)),
                List.of(record(routingData("E", "ROLE:GRO", "SMS"), true),
                        record(routingData("E", "ROLE:GRO", "EMAIL"), true)),
                List.of(record(routingData("E", "ROLE:PGR_LME", "SMS"), true))));

        List<RoutingRow> rows = new MdmsNotificationConfigRepository(restTemplate, config)
                .routing("ke.bomet");

        assertEquals(5, rows.size(),
                "the loop must run until a SHORT page; stopping at the first is the bug class here, "
                        + "and it fails by never firing the later rows rather than by erroring");
        assertEquals("ROLE:PGR_LME", rows.get(4).audience());
    }

    @Test
    @DisplayName("a record-level soft delete and a data-level deactivate both mean inactive")
    void bothActiveFlagsAreHonoured() {
        Map<String, Object> deactivated = routingData("E", "ROLE:GRO", "SMS");
        deactivated.put("active", false);
        answer("NOTIFICATIONS.Routing", List.of(List.of(
                record(routingData("E", "ACTOR:citizen", "SMS"), false),   // soft-deleted record
                record(deactivated, true))));                              // deactivated in the UI

        List<RoutingRow> rows = new MdmsNotificationConfigRepository(restTemplate, config)
                .routing("ke.bomet");
        assertEquals(2, rows.size(), "both rows are returned...");
        assertFalse(rows.get(0).active(), "...and both say they are off");
        assertFalse(rows.get(1).active());
    }

    // ---- caching -------------------------------------------------------------

    @Test
    @DisplayName("a stale non-empty entry is served through an MDMS outage; an empty is never cached")
    void staleBeatsEmpty() {
        MdmsNotificationConfigRepository repository =
                new MdmsNotificationConfigRepository(restTemplate, config);
        answer("NOTIFICATIONS.Routing",
                List.of(List.of(record(routingData("E", "ACTOR:citizen", "SMS"), true))));
        assertEquals(1, repository.routing("ke.bomet").size());

        // The TTL expires and MDMS is now unreachable.
        config.setNotificationConfigCacheTtlMs(0L);
        when(restTemplate.exchange(anyString(), eq(HttpMethod.POST), any(HttpEntity.class), eq(Map.class)))
                .thenThrow(new IllegalStateException("MDMS is down"));

        List<RoutingRow> rows = repository.routing("ke.bomet");
        assertEquals(1, rows.size(),
                "the last known non-empty answer is served rather than dropping this tenant's "
                        + "notifications over a blip — the one piece of caching that was already right");
        assertTrue(repository.describe("ke.bomet").getMasters().get("Routing").isStale(),
                "and /config/source says the rows are not fresh, so nobody mistakes it for health");
    }

    // ---- the legacy fallback --------------------------------------------------

    @Test
    @DisplayName("a tenant with no NOTIFICATIONS.Routing rows is served its legacy rows, adapted")
    void theLegacyFallbackIsPerTenant() {
        Map<String, Object> legacyRouting = new LinkedHashMap<>();
        legacyRouting.put("businessService", "PGR");
        legacyRouting.put("action", "ASSIGN");
        legacyRouting.put("toState", "PENDINGATLME");
        legacyRouting.put("audience", "GRO");
        legacyRouting.put("assigneeOnly", true);
        legacyRouting.put("channel", "SMS");
        legacyRouting.put("active", true);

        Map<String, Object> legacyTemplate = new LinkedHashMap<>();
        legacyTemplate.put("audience", "GRO");
        legacyTemplate.put("action", "ASSIGN");
        legacyTemplate.put("toState", "PENDINGATLME");
        legacyTemplate.put("channel", "SMS");
        legacyTemplate.put("locale", "en_IN");
        legacyTemplate.put("body", "hello");
        legacyTemplate.put("active", true);

        when(restTemplate.exchange(anyString(), eq(HttpMethod.POST), any(HttpEntity.class), eq(Map.class)))
                .thenAnswer(invocation -> {
                    HttpEntity<Map<String, Object>> entity = invocation.getArgument(2);
                    @SuppressWarnings("unchecked")
                    Map<String, Object> criteria =
                            (Map<String, Object>) entity.getBody().get("MdmsCriteria");
                    String schema = String.valueOf(criteria.get("schemaCode"));
                    int offset = ((Number) criteria.get("offset")).intValue();
                    if (offset > 0) {
                        return ResponseEntity.ok(Map.of("mdms", List.of()));
                    }
                    if ("RAINMAKER-PGR.NotificationRouting".equals(schema)) {
                        return ResponseEntity.ok(Map.of("mdms", List.of(record(legacyRouting, true))));
                    }
                    if ("RAINMAKER-PGR.NotificationTemplate".equals(schema)) {
                        return ResponseEntity.ok(Map.of("mdms", List.of(record(legacyTemplate, true))));
                    }
                    return ResponseEntity.ok(Map.of("mdms", List.of()));   // nothing in the new namespace
                });

        MdmsNotificationConfigRepository repository =
                new MdmsNotificationConfigRepository(restTemplate, config);

        List<RoutingRow> routing = repository.routing("ke.bomet");
        assertEquals(1, routing.size());
        assertEquals("COMPLAINTS.WORKFLOW.ASSIGN.PENDINGATLME", routing.get(0).eventName());
        assertEquals("ACTOR:assignee|ROLE:GRO", routing.get(0).audience());

        List<TemplateRow> templates = repository.templates("ke.bomet");
        assertEquals(1, templates.size());
        assertEquals("ACTOR:assignee|ROLE:GRO", templates.get(0).audience(),
                "the template joins on the audience string ROUTING produced — a bare ROLE:GRO here "
                        + "would leave the routing row with no template and nobody would be told");

        ConfigSourceReport report = repository.describe("ke.bomet");
        assertTrue(report.isAnyLegacy());
        assertEquals("RAINMAKER-PGR.NotificationRouting", report.getMasters().get("Routing").getSchemaCode());
        assertEquals("RAINMAKER-PGR.NotificationTemplate", report.getMasters().get("Template").getSchemaCode());
        assertEquals("NOTIFICATIONS.EventCatalogue", report.getMasters().get("EventCatalogue").getSchemaCode(),
                "the catalogue has no legacy equivalent, and saying so beats leaving it to be inferred");
        assertEquals("ke", report.getStateTenantId(), "the masters are held at the state root");
    }

    @Test
    @DisplayName("a tenant WITH new rows never looks at the legacy namespace")
    void theNewNamespaceWins() {
        answer("NOTIFICATIONS.Routing",
                List.of(List.of(record(routingData("E", "ACTOR:citizen", "SMS"), true))));

        MdmsNotificationConfigRepository repository =
                new MdmsNotificationConfigRepository(restTemplate, config);
        assertEquals(1, repository.routing("ke.bomet").size());
        assertFalse(repository.describe("ke.bomet").isAnyLegacy());
    }

    @Test
    @DisplayName("with no RestTemplate the reader answers empty instead of failing to start")
    void noRestTemplateIsNotAnError() {
        MdmsNotificationConfigRepository repository = new MdmsNotificationConfigRepository(null, config);
        assertTrue(repository.routing("ke.bomet").isEmpty());
        assertTrue(repository.catalogue("ke.bomet").isEmpty());
        assertEquals(new ArrayList<>(), new ArrayList<>(repository.templates("ke.bomet")));
    }
}
