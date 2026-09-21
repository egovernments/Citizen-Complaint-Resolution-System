package org.egov.pgr.service.notification.golden;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.producer.Producer;
import org.egov.pgr.repository.ServiceRequestRepository;
import org.egov.pgr.service.NotificationService;
import org.egov.pgr.service.WorkflowService;
import org.egov.pgr.service.notification.ThinEventBuilder;
import org.egov.pgr.util.HRMSUtil;
import org.egov.pgr.util.MDMSUtils;
import org.egov.pgr.util.NotificationUtil;
import org.egov.pgr.web.models.ServiceRequest;
import org.mockito.Mockito;
import org.springframework.web.client.RestTemplate;

import java.io.InputStream;
import java.lang.reflect.Field;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TimeZone;
import java.util.regex.Pattern;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * Runs the REAL {@link NotificationService} over the whole golden input matrix and captures the
 * thin events it publishes.
 *
 * <p>For every scenario in {@code golden/inputs/scenarios.json} it builds a fresh object graph
 * around the real {@link NotificationService}, {@link ThinEventBuilder}, {@link NotificationUtil}
 * and {@link HRMSUtil}, stubs only the outside world (the single HTTP funnel
 * {@link ServiceRequestRepository}, the MDMS {@code ComplaintHierarchy} read, the URL shortener and
 * the Kafka producer), drives {@code process()} and records what reached the producer.
 *
 * <p><b>Two stubs are deliberately booby-trapped.</b> egov-localization and
 * digit-user-preferences-service now throw if they are called at all: after the cutover the producer
 * ships localization CODES and names no recipient locale, so a call to either service is a
 * regression, not a detail — and a silent one, because the outage paths used to be handled. That
 * makes "the rendering half really is gone" a runtime assertion rather than a claim.
 *
 * <p>The object graph is rebuilt per scenario because {@link MDMSUtils} caches master rows per state
 * tenant; a shared instance would leak one scenario's world into the next.
 *
 * <p><b>Determinism.</b> The JVM default time zone is forced to UTC for the whole run, exactly as
 * {@code MainConfiguration.initialize()} does in production ({@code app.timezone=UTC}); without it
 * {@code {date}} would render in the builder's local zone. Two fields cannot be frozen without a
 * clock/id seam in main code and are normalised instead — {@code eventId} (a fresh
 * {@code UUID.randomUUID()}) and {@code eventTime} ({@code Instant.now()}) — after their SHAPE is
 * checked, so a change of format still fails the test.
 *
 * <p>See {@code src/test/resources/golden/README.md}.
 */
public final class GoldenThinEventFixtureGenerator {

    public static final String SCENARIOS_RESOURCE = "golden/inputs/scenarios.json";
    public static final String MASTERS_PREFIX = "golden/inputs/masters/";
    public static final String GOLDEN_RESOURCE = "golden/golden-thin-events.json";
    public static final String GOLDEN_SOURCE_PATH = "src/test/resources/golden/golden-thin-events.json";

    /** Placeholders substituted for the two fields that cannot be frozen from the test side. */
    public static final String UUID_PLACEHOLDER = "<uuid>";
    public static final String TIMESTAMP_PLACEHOLDER = "<timestamp>";

    private static final Pattern UUID_SHAPE =
            Pattern.compile("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}");

    private static final String TOPIC_FIELD = "topic";
    private static final String TENANT_FIELD = "producerTenantId";
    private static final String EVENT_FIELD = "event";

    private GoldenThinEventFixtureGenerator() {
    }

    /** A mapper configured exactly like the application's ({@code MainConfiguration.objectMapper}). */
    public static ObjectMapper newMapper() {
        return new ObjectMapper()
                .disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
                .setTimeZone(TimeZone.getTimeZone("UTC"));
    }

    /** Runs the whole matrix and returns the golden document (same shape as the committed file). */
    public static ObjectNode generate() {
        ObjectMapper mapper = newMapper();
        JsonNode doc = readJson(mapper, SCENARIOS_RESOURCE);
        JsonNode defaults = doc.path("defaults");

        ObjectNode out = mapper.createObjectNode();
        out.put("$comment", "GENERATED - do not hand-edit. See src/test/resources/golden/README.md. "
                + "Regenerate with -Dgolden.regenerate=true ONLY for an intended behaviour change.");
        out.put("generator", GoldenThinEventFixtureGenerator.class.getName());
        out.put("inputs", SCENARIOS_RESOURCE);
        out.put("contract", "docs/2.12/notifications/contract/thin-event-v1.schema.json");
        ObjectNode normalised = out.putObject("normalisedFields");
        normalised.put("event.eventId", UUID_PLACEHOLDER);
        normalised.put("event.eventTime", TIMESTAMP_PLACEHOLDER);

        ArrayNode scenarios = out.putArray("scenarios");
        TimeZone previous = TimeZone.getDefault();
        TimeZone.setDefault(TimeZone.getTimeZone("UTC"));   // mirrors MainConfiguration (app.timezone=UTC)
        try {
            for (JsonNode scenario : doc.path("scenarios")) {
                scenarios.add(runScenario(mapper, defaults, scenario));
            }
        } finally {
            TimeZone.setDefault(previous);
        }
        return out;
    }

    // ------------------------------------------------------------------------------------------
    // one scenario
    // ------------------------------------------------------------------------------------------

    private static ObjectNode runScenario(ObjectMapper mapper, JsonNode defaults, JsonNode scenario) {
        ObjectNode cfg = merge(mapper, defaults.path("config"), scenario.path("config"));
        ObjectNode world = merge(mapper, defaults.path("world"), scenario.path("world"));

        PGRConfiguration config = stubConfig(cfg);

        MDMSUtils mdmsUtils = mock(MDMSUtils.class);
        when(mdmsUtils.mDMSCall(any(ServiceRequest.class))).thenReturn(asMapOrNull(mapper, world.get("mdms")));

        RestTemplate restTemplate = mock(RestTemplate.class);
        if (world.path("shortUrlFails").asBoolean(false)) {
            when(restTemplate.postForObject(anyString(), any(), eq(String.class)))
                    .thenThrow(new IllegalStateException("egov-url-shortening unavailable"));
        } else {
            when(restTemplate.postForObject(anyString(), any(), eq(String.class)))
                    .thenReturn(world.path("shortUrl").asText(null));
        }

        WorkflowService workflowService = mock(WorkflowService.class);
        when(workflowService.getprocessInstanceSearchURL(anyString(), anyString()))
                .thenAnswer(inv -> new StringBuilder("http://workflow/egov-workflow-v2/egov-wf/process/_search")
                        .append("?tenantId=").append((String) inv.getArgument(0))
                        .append("&businessIds=").append((String) inv.getArgument(1)));

        ServiceRequestRepository repository = stubHttpFunnel(mapper, cfg, world);

        NotificationUtil notificationUtil = new NotificationUtil();
        set(notificationUtil, "config", config);
        set(notificationUtil, "restTemplate", restTemplate);

        HRMSUtil hrmsUtil = new HRMSUtil(repository, config);
        Producer producer = mock(Producer.class);

        List<ObjectNode> captured = new ArrayList<>();
        doAnswer(inv -> {
            ObjectNode row = mapper.createObjectNode();
            row.put(TENANT_FIELD, (String) inv.getArgument(0));
            row.put(TOPIC_FIELD, (String) inv.getArgument(1));
            row.set(EVENT_FIELD, normalise(mapper.valueToTree(inv.getArgument(2))));
            captured.add(row);
            return null;
        }).when(producer).push(anyString(), anyString(), any());

        NotificationService service = new NotificationService();
        set(service, "config", config);
        set(service, "notificationUtil", notificationUtil);
        set(service, "workflowService", workflowService);
        set(service, "serviceRequestRepository", repository);
        set(service, "mdmsUtils", mdmsUtils);
        set(service, "hrmsUtils", hrmsUtil);
        set(service, "mapper", newMapper());
        set(service, "thinEventBuilder", new ThinEventBuilder());
        set(service, "producer", producer);

        ServiceRequest request = mapper.convertValue(scenario.get("request"), ServiceRequest.class);
        service.process(request, "update-pgr-request");

        ObjectNode out = mapper.createObjectNode();
        out.put("id", scenario.path("id").asText());
        out.put("description", scenario.path("description").asText());
        out.put("eventCount", captured.size());
        ArrayNode events = out.putArray("events");
        captured.forEach(events::add);
        return out;
    }

    // ------------------------------------------------------------------------------------------
    // the outside world
    // ------------------------------------------------------------------------------------------

    /**
     * The one HTTP funnel every collaborator goes through. Routed by URI prefix, so a scenario's
     * {@code world} block is the whole of the outside world this run can see — and anything the
     * producer should no longer reach for is an explicit failure rather than a missing branch.
     */
    @SuppressWarnings("unchecked")
    private static ServiceRequestRepository stubHttpFunnel(ObjectMapper mapper, ObjectNode cfg, ObjectNode world) {
        String userHost = text(cfg, "userHost");
        String prefsHost = text(cfg, "userPreferenceHost");
        String localizationHost = text(cfg, "localizationHost");
        String hrmsHost = text(cfg, "hrmsHost");

        ServiceRequestRepository repository = mock(ServiceRequestRepository.class);
        when(repository.fetchResult(any(StringBuilder.class), any())).thenAnswer(inv -> {
            String uri = String.valueOf(inv.<StringBuilder>getArgument(0));
            Object body = inv.getArgument(1);

            if (uri.startsWith(localizationHost)) {
                // The thin event carries localization CODES; resolving them is novu-bridge's job,
                // once per recipient locale. A call from here means the rendering half came back.
                throw new AssertionError("pgr-services called egov-localization (" + uri + "). The thin "
                        + "event carries codes in `localized`; the bridge resolves them per locale.");
            }
            if (uri.startsWith(prefsHost)) {
                throw new AssertionError("pgr-services called digit-user-preferences-service (" + uri
                        + "). Per-recipient locale is the bridge's decision now.");
            }
            if (uri.startsWith(userHost)) {
                Map<String, Object> search = (Map<String, Object>) body;
                LinkedHashMap<String, Object> res = new LinkedHashMap<>();
                if (search.containsKey("uuid")) {
                    Object raw = search.get("uuid");
                    String uuid = ((Collection<String>) raw).iterator().next();
                    JsonNode row = world.path("usersByUuid").path(uuid);
                    res.put("user", row.isMissingNode() || row.isNull()
                            ? new ArrayList<>() : List.of(asMap(mapper, row)));
                    return res;
                }
                throw new AssertionError("pgr-services searched egov-user by something other than a uuid ("
                        + search.keySet() + "). Role pools are resolved inside the bridge now.");
            }
            if (uri.startsWith(hrmsHost)) {
                return asMapOrNull(mapper, world.get("hrms"));
            }
            if (uri.contains("egov-wf/process/_search")) {
                JsonNode history = world.get("workflowHistory");
                if (history == null || history.isNull()) {
                    LinkedHashMap<String, Object> empty = new LinkedHashMap<>();
                    empty.put("ProcessInstances", new ArrayList<>());
                    return empty;
                }
                return asMap(mapper, history);
            }
            throw new IllegalStateException("Golden fixture: unexpected outbound call to " + uri);
        });
        return repository;
    }

    private static PGRConfiguration stubConfig(ObjectNode cfg) {
        PGRConfiguration config = mock(PGRConfiguration.class, Mockito.RETURNS_DEFAULTS);
        when(config.getComplaintsDomainEventsTopic()).thenReturn(text(cfg, "complaintsDomainEventsTopic"));
        when(config.getMobileDownloadLink()).thenReturn(text(cfg, "mobileDownloadLink"));
        when(config.getUserHost()).thenReturn(text(cfg, "userHost"));
        when(config.getUserSearchEndpoint()).thenReturn(text(cfg, "userSearchEndpoint"));
        when(config.getEgovInternalMicroserviceUserUuid()).thenReturn(text(cfg, "egovInternalMicroserviceUserUuid"));
        when(config.getUrlShortnerHost()).thenReturn(text(cfg, "urlShortnerHost"));
        when(config.getUrlShortnerEndpoint()).thenReturn(text(cfg, "urlShortnerEndpoint"));
        when(config.getHrmsHost()).thenReturn(text(cfg, "hrmsHost"));
        when(config.getHrmsEndPoint()).thenReturn(text(cfg, "hrmsEndPoint"));
        return config;
    }

    // ------------------------------------------------------------------------------------------
    // merging, normalisation, reflection
    // ------------------------------------------------------------------------------------------

    /** Shallow (top-level key) override of the defaults block by the scenario's block. */
    static ObjectNode merge(ObjectMapper mapper, JsonNode base, JsonNode override) {
        ObjectNode out = base.isObject() ? base.deepCopy() : mapper.createObjectNode();
        if (override.isObject()) {
            override.fields().forEachRemaining(e -> out.set(e.getKey(), e.getValue()));
        }
        return out;
    }

    /**
     * Replaces the two unfreezable fields, after asserting their SHAPE — a change from a uuid to
     * something else, or from an ISO-8601 instant to something else, must still fail the test.
     */
    private static JsonNode normalise(JsonNode event) {
        ObjectNode copy = (ObjectNode) event;
        String eventId = copy.path("eventId").asText(null);
        if (eventId == null || !UUID_SHAPE.matcher(eventId).matches()) {
            throw new IllegalStateException("eventId is no longer a random uuid: " + eventId);
        }
        String eventTime = copy.path("eventTime").asText(null);
        try {
            Instant.parse(eventTime);
        } catch (RuntimeException e) {
            throw new IllegalStateException("eventTime is no longer an ISO-8601 instant: " + eventTime);
        }
        copy.put("eventId", UUID_PLACEHOLDER);
        copy.put("eventTime", TIMESTAMP_PLACEHOLDER);
        return copy;
    }

    static JsonNode readJson(ObjectMapper mapper, String resource) {
        try (InputStream in = GoldenThinEventFixtureGenerator.class.getClassLoader()
                .getResourceAsStream(resource)) {
            if (in == null) throw new IllegalStateException("Missing test resource: " + resource);
            return mapper.readTree(in);
        } catch (Exception e) {
            throw new IllegalStateException("Failed to read " + resource, e);
        }
    }

    @SuppressWarnings("unchecked")
    private static LinkedHashMap<String, Object> asMap(ObjectMapper mapper, JsonNode node) {
        return mapper.convertValue(node, LinkedHashMap.class);
    }

    private static LinkedHashMap<String, Object> asMapOrNull(ObjectMapper mapper, JsonNode node) {
        return node == null || node.isNull() ? null : asMap(mapper, node);
    }

    private static String text(JsonNode node, String field) {
        JsonNode value = node.path(field);
        return value.isMissingNode() || value.isNull() ? null : value.asText();
    }

    private static void set(Object target, String field, Object value) {
        Class<?> type = target.getClass();
        while (type != null) {
            try {
                Field f = type.getDeclaredField(field);
                f.setAccessible(true);
                f.set(target, value);
                return;
            } catch (NoSuchFieldException e) {
                type = type.getSuperclass();
            } catch (IllegalAccessException e) {
                throw new IllegalStateException("Cannot set " + field, e);
            }
        }
        throw new IllegalStateException("No such field " + field + " on " + target.getClass());
    }
}
