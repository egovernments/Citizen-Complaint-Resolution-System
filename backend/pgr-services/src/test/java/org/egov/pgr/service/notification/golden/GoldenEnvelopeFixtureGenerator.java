package org.egov.pgr.service.notification.golden;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.egov.common.utils.MultiStateInstanceUtil;
import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.producer.Producer;
import org.egov.pgr.repository.ServiceRequestRepository;
import org.egov.pgr.service.NotificationService;
import org.egov.pgr.service.WorkflowService;
import org.egov.pgr.service.notification.NotificationRouter;
import org.egov.pgr.service.notification.TemplateRenderer;
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
import java.util.Comparator;
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
 * Characterisation-fixture generator for the PGR notification path (task T9).
 *
 * <p>For every scenario in {@code golden/inputs/scenarios.json} it builds a fresh object graph
 * around the REAL {@link NotificationService}, {@link NotificationRouter}, {@link TemplateRenderer},
 * {@link NotificationUtil} and {@link HRMSUtil}, stubs only the outside world (MDMS masters, the
 * single HTTP funnel {@link ServiceRequestRepository}, the URL shortener and the Kafka producer),
 * drives {@code process()} and captures every envelope handed to the producer.
 *
 * <p>The object graph is rebuilt per scenario on purpose: {@code NotificationService} keeps an
 * instance-level {@code preferredLocaleCache} with a 60 s TTL, and {@link MDMSUtils} caches master
 * rows per state tenant — a shared instance would leak one scenario's world into the next.
 *
 * <p><b>Determinism.</b> The JVM default time zone is forced to UTC for the whole run, exactly as
 * {@code MainConfiguration.initialize()} does in production ({@code app.timezone=UTC}); without it
 * {@code NotificationService.formatCreatedDate} would render {@code {date}} in the builder's local
 * zone. Two fields cannot be frozen without changing main code and are normalised instead:
 * {@code eventId} (a fresh {@code UUID.randomUUID()}) and {@code eventTime} ({@code Instant.now()}).
 * Both are validated for SHAPE before being replaced, so a change of format still fails the test.
 *
 * <p>Nothing here writes to {@code src/main}. See {@code src/test/resources/golden/README.md}.
 */
public final class GoldenEnvelopeFixtureGenerator {

    public static final String SCENARIOS_RESOURCE = "golden/inputs/scenarios.json";
    public static final String MASTERS_PREFIX = "golden/inputs/masters/";
    public static final String GOLDEN_RESOURCE = "golden/golden-envelopes.json";
    public static final String GOLDEN_SOURCE_PATH = "src/test/resources/golden/golden-envelopes.json";

    /** Placeholders substituted for the two fields that cannot be frozen from the test side. */
    public static final String UUID_PLACEHOLDER = "<uuid>";
    public static final String TIMESTAMP_PLACEHOLDER = "<timestamp>";

    private static final Pattern UUID_SHAPE =
            Pattern.compile("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}");

    private static final String TOPIC_FIELD = "topic";
    private static final String TENANT_FIELD = "producerTenantId";
    private static final String EVENT_FIELD = "event";

    private GoldenEnvelopeFixtureGenerator() {
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
        out.put("generator", GoldenEnvelopeFixtureGenerator.class.getName());
        out.put("inputs", SCENARIOS_RESOURCE);
        ObjectNode normalised = out.putObject("normalisedFields");
        normalised.put("event.eventId", UUID_PLACEHOLDER);
        normalised.put("event.eventTime", TIMESTAMP_PLACEHOLDER);
        out.put("envelopeOrdering",
                "envelopes[] sorted by (event.transactionId, event.templateKey, event.renderedBody); "
                        + "emissionOrder[] preserves the order the producer was actually called in");

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
        String id = scenario.path("id").asText();
        ObjectNode cfg = merge(mapper, defaults.path("config"), scenario.path("config"));
        ObjectNode world = merge(mapper, defaults.path("world"), scenario.path("world"));
        JsonNode masters = scenario.path("masters");

        PGRConfiguration config = stubConfig(cfg);
        MultiStateInstanceUtil centralInstanceUtil = mock(MultiStateInstanceUtil.class);
        when(centralInstanceUtil.getStateLevelTenant(anyString())).thenReturn(text(cfg, "stateLevelTenant"));

        MDMSUtils mdmsUtils = mock(MDMSUtils.class);
        when(mdmsUtils.getNotificationRouting(anyString()))
                .thenReturn(masterRows(mapper, masters, "routing", "RAINMAKER-PGR.NotificationRouting.json"));
        when(mdmsUtils.getNotificationTemplates(anyString()))
                .thenReturn(masterRows(mapper, masters, "templates", "RAINMAKER-PGR.NotificationTemplate.json"));
        when(mdmsUtils.getNotificationProviderTemplates(anyString()))
                .thenReturn(masterRows(mapper, masters, "providerTemplates",
                        "RAINMAKER-PGR.NotificationProviderTemplate.json"));
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
        set(notificationUtil, "serviceRequestRepository", repository);
        set(notificationUtil, "config", config);
        set(notificationUtil, "restTemplate", restTemplate);
        set(notificationUtil, "centralInstanceUtil", centralInstanceUtil);

        HRMSUtil hrmsUtil = new HRMSUtil(repository, config);
        NotificationRouter router = new NotificationRouter(mdmsUtils);
        TemplateRenderer renderer = new TemplateRenderer(mdmsUtils, config);
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
        set(service, "centralInstanceUtil", centralInstanceUtil);
        set(service, "notificationRouter", router);
        set(service, "templateRenderer", renderer);
        set(service, "producer", producer);

        ServiceRequest request = mapper.convertValue(scenario.get("request"), ServiceRequest.class);
        service.process(request, "update-pgr-request");

        ObjectNode out = mapper.createObjectNode();
        out.put("id", id);
        out.put("description", scenario.path("description").asText());
        out.put("envelopeCount", captured.size());
        ArrayNode emission = out.putArray("emissionOrder");
        for (ObjectNode row : captured) {
            emission.add(row.path(EVENT_FIELD).path("transactionId").asText(null));
        }
        List<ObjectNode> sorted = new ArrayList<>(captured);
        sorted.sort(ENVELOPE_ORDER);
        ArrayNode envelopes = out.putArray("envelopes");
        sorted.forEach(envelopes::add);
        return out;
    }

    /** Stable, documented ordering so the committed file does not churn on a rerun. */
    private static final Comparator<ObjectNode> ENVELOPE_ORDER = Comparator
            .comparing((ObjectNode n) -> n.path(EVENT_FIELD).path("transactionId").asText(""))
            .thenComparing(n -> n.path(EVENT_FIELD).path("templateKey").asText(""))
            .thenComparing(n -> n.path(EVENT_FIELD).path("renderedBody").asText(""));

    // ------------------------------------------------------------------------------------------
    // the outside world
    // ------------------------------------------------------------------------------------------

    /**
     * The one HTTP funnel every collaborator goes through. Routed by URI prefix, so a scenario's
     * {@code world} block is the whole of the outside world this run can see.
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
                if (world.path("localizationFails").asBoolean(false)) {
                    throw new IllegalStateException("egov-localization unavailable");
                }
                String module = queryParam(uri, "module");
                JsonNode messages = world.path("localization").path(module);
                return messages.isMissingNode() || messages.isNull()
                        ? emptyMessages() : asMap(mapper, messages);
            }
            if (uri.startsWith(prefsHost)) {
                LinkedHashMap<String, Object> res = new LinkedHashMap<>();
                List<Object> rows = new ArrayList<>();
                JsonNode prefs = world.path("preferences");
                prefs.fieldNames().forEachRemaining(uuid -> {
                    LinkedHashMap<String, Object> row = new LinkedHashMap<>();
                    row.put("userId", uuid);
                    row.put("tenantId", text(cfg, "stateLevelTenant"));
                    LinkedHashMap<String, Object> payload = new LinkedHashMap<>();
                    payload.put("preferredLanguage", prefs.path(uuid).asText());
                    row.put("payload", payload);
                    rows.add(row);
                });
                res.put("preferences", rows);
                return res;
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
                String roleCode = ((List<String>) search.get("roleCodes")).get(0);
                int page = ((Number) search.get("pageNumber")).intValue();
                JsonNode pages = world.path("rolePools").path(roleCode);
                res.put("user", page < pages.size()
                        ? mapper.convertValue(pages.get(page), List.class) : new ArrayList<>());
                return res;
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

    private static LinkedHashMap<String, Object> emptyMessages() {
        LinkedHashMap<String, Object> empty = new LinkedHashMap<>();
        empty.put("messages", new ArrayList<>());
        return empty;
    }

    private static String queryParam(String uri, String name) {
        for (String part : uri.substring(uri.indexOf('?') + 1).split("&")) {
            int eq = part.indexOf('=');
            if (eq > 0 && part.substring(0, eq).equals(name)) return part.substring(eq + 1);
        }
        return null;
    }

    private static PGRConfiguration stubConfig(ObjectNode cfg) {
        PGRConfiguration config = mock(PGRConfiguration.class, Mockito.RETURNS_DEFAULTS);
        when(config.getNotificationDefaultLocale()).thenReturn(text(cfg, "notificationDefaultLocale"));
        when(config.getNotificationLocalePerRecipient()).thenReturn(cfg.path("notificationLocalePerRecipient").asBoolean());
        when(config.getNotificationPreferenceCode()).thenReturn(text(cfg, "notificationPreferenceCode"));
        when(config.getNotificationRolePoolPageSize()).thenReturn(cfg.path("notificationRolePoolPageSize").asInt());
        when(config.getNotificationRolePoolMaxPages()).thenReturn(cfg.path("notificationRolePoolMaxPages").asInt());
        when(config.getNotificationMdmsCacheTtlMs()).thenReturn(cfg.path("notificationMdmsCacheTtlMs").asLong());
        when(config.getComplaintsDomainEventsTopic()).thenReturn(text(cfg, "complaintsDomainEventsTopic"));
        when(config.getMobileDownloadLink()).thenReturn(text(cfg, "mobileDownloadLink"));
        when(config.getUserHost()).thenReturn(text(cfg, "userHost"));
        when(config.getUserSearchEndpoint()).thenReturn(text(cfg, "userSearchEndpoint"));
        when(config.getEgovInternalMicroserviceUserUuid()).thenReturn(text(cfg, "egovInternalMicroserviceUserUuid"));
        when(config.getUserPreferenceHost()).thenReturn(text(cfg, "userPreferenceHost"));
        when(config.getUserPreferenceSearchPath()).thenReturn(text(cfg, "userPreferenceSearchPath"));
        when(config.getLocalizationHost()).thenReturn(text(cfg, "localizationHost"));
        when(config.getLocalizationContextPath()).thenReturn(text(cfg, "localizationContextPath"));
        when(config.getLocalizationSearchEndpoint()).thenReturn(text(cfg, "localizationSearchEndpoint"));
        when(config.getUrlShortnerHost()).thenReturn(text(cfg, "urlShortnerHost"));
        when(config.getUrlShortnerEndpoint()).thenReturn(text(cfg, "urlShortnerEndpoint"));
        when(config.getHrmsHost()).thenReturn(text(cfg, "hrmsHost"));
        when(config.getHrmsEndPoint()).thenReturn(text(cfg, "hrmsEndPoint"));
        return config;
    }

    // ------------------------------------------------------------------------------------------
    // masters, merging, normalisation, reflection
    // ------------------------------------------------------------------------------------------

    /**
     * Resolves one master for a scenario: {@code "seed"} (the committed copy of the shipped
     * default-data-handler file) or an inline array that REPLACES it, then anything under
     * {@code <name>Append} is appended in order.
     */
    static List<Object> masterRows(ObjectMapper mapper, JsonNode masters, String name, String seedFile) {
        JsonNode spec = masters.path(name);
        List<Object> rows = new ArrayList<>();
        if (spec.isArray()) {
            rows.addAll(mapper.convertValue(spec, List.class));
        } else {
            rows.addAll(mapper.convertValue(readJson(mapper, MASTERS_PREFIX + seedFile), List.class));
        }
        JsonNode append = masters.path(name + "Append");
        if (append.isArray()) {
            rows.addAll(mapper.convertValue(append, List.class));
        }
        return rows;
    }

    /** Shallow (top-level key) override of the defaults block by the scenario's block. */
    private static ObjectNode merge(ObjectMapper mapper, JsonNode base, JsonNode override) {
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
        try (InputStream in = GoldenEnvelopeFixtureGenerator.class.getClassLoader()
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
