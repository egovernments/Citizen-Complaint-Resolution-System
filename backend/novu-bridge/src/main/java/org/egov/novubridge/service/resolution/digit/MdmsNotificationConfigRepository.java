package org.egov.novubridge.service.resolution.digit;

import lombok.extern.slf4j.Slf4j;
import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.service.resolution.config.ConfigSourceReport;
import org.egov.novubridge.service.resolution.config.NotificationConfigRepository;
import org.egov.novubridge.service.resolution.config.NotificationConfigRows.CatalogueRow;
import org.egov.novubridge.service.resolution.config.NotificationConfigRows.ProviderTemplateRow;
import org.egov.novubridge.service.resolution.config.NotificationConfigRows.RoutingRow;
import org.egov.novubridge.service.resolution.config.NotificationConfigRows.TemplateRow;
import org.egov.novubridge.service.thin.ThinEventErrorCodes;
import org.egov.tracer.model.CustomException;
import org.egov.novubridge.util.ServiceUrl;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.lang.Nullable;
import org.springframework.util.StringUtils;
import org.springframework.web.client.RestTemplate;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * The four config masters, read from MDMS v2 at the tenant's STATE root.
 *
 * <ul>
 *   <li><b>Stale beats empty.</b> A last-known answer is served through an empty answer or an
 *       outage; an outage with nothing cached throws (see {@link #read}).</li>
 *   <li><b>Every page is read</b>, until a short page: a single-page read silently drops the
 *       101st routing row.</li>
 *   <li><b>Legacy fallback is per tenant, all-or-nothing, decided once per {@link #load}</b>: a
 *       tenant with zero {@code NOTIFICATIONS.Routing} rows is served its {@code RAINMAKER-PGR.Notification*} rows
 *       through {@link LegacyMasterAdapter}, visible at {@code GET /config/source}.</li>
 * </ul>
 */
@Slf4j
public class MdmsNotificationConfigRepository implements NotificationConfigRepository {

    public static final String ROUTING = "Routing";
    public static final String TEMPLATE = "Template";
    public static final String PROVIDER_TEMPLATE = "ProviderTemplate";
    public static final String CATALOGUE = "EventCatalogue";

    private static final Map<String, String> LEGACY_SCHEMA = Map.of(
            ROUTING, "RAINMAKER-PGR.NotificationRouting",
            TEMPLATE, "RAINMAKER-PGR.NotificationTemplate",
            PROVIDER_TEMPLATE, "RAINMAKER-PGR.NotificationProviderTemplate");

    /** One MDMS record: the record-level active flag and the data block it wraps. */
    record MdmsRow(Map<String, Object> data, boolean recordActive) {
    }

    /** What a read returned, and whether it came from a cache entry past its TTL. */
    record Page(List<MdmsRow> rows, boolean stale) {
    }

    private final RestTemplate restTemplate;
    private final NovuBridgeConfiguration config;
    private final TtlCache<String, List<MdmsRow>> cache = new TtlCache<>();
    private final Map<String, Boolean> legacyLogged = new ConcurrentHashMap<>();

    public MdmsNotificationConfigRepository(@Nullable RestTemplate restTemplate,
                                            NovuBridgeConfiguration config) {
        this.restTemplate = restTemplate;
        this.config = config;
    }

    @Override
    public NotificationConfig load(String tenantId) {
        String state = stateTenant(tenantId);
        List<CatalogueRow> catalogue = new ArrayList<>();
        for (MdmsRow row : read(state, schema(CATALOGUE)).rows()) {
            catalogue.add(new CatalogueRow(text(row.data().get("eventName")), effectiveActive(row)));
        }
        Page current = read(state, schema(ROUTING));
        if (!current.rows().isEmpty()) {
            return new NotificationConfig(convertRouting(current.rows()),
                    convertTemplates(read(state, schema(TEMPLATE)).rows()),
                    convertProviderTemplates(read(state, schema(PROVIDER_TEMPLATE)).rows()), catalogue);
        }
        Page legacy = read(state, LEGACY_SCHEMA.get(ROUTING));
        if (legacy.rows().isEmpty()) {
            return new NotificationConfig(List.of(), List.of(), List.of(), catalogue);
        }
        logLegacyOnce(state);
        Map<String, String> index = LegacyMasterAdapter.buildAudienceIndex(dataOf(legacy.rows()));
        List<TemplateRow> templates = new ArrayList<>();
        for (MdmsRow row : read(state, LEGACY_SCHEMA.get(TEMPLATE)).rows()) {
            TemplateRow converted = adapt(row, r -> LegacyMasterAdapter.convertTemplate(r, index), TEMPLATE);
            if (converted != null) {
                templates.add(withActive(converted, row.recordActive()));
            }
        }
        List<ProviderTemplateRow> providerTemplates = new ArrayList<>();
        for (MdmsRow row : read(state, LEGACY_SCHEMA.get(PROVIDER_TEMPLATE)).rows()) {
            ProviderTemplateRow converted =
                    adapt(row, r -> LegacyMasterAdapter.convertProviderTemplate(r, index), PROVIDER_TEMPLATE);
            if (converted != null) {
                providerTemplates.add(withActive(converted, row.recordActive()));
            }
        }
        return new NotificationConfig(adaptRouting(legacy.rows()), templates, providerTemplates, catalogue);
    }

    @Override
    public ConfigSourceReport describe(String tenantId) {
        String state = stateTenant(tenantId);
        ConfigSourceReport report = new ConfigSourceReport(tenantId, state);
        boolean legacy = read(state, schema(ROUTING)).rows().isEmpty()
                && !read(state, LEGACY_SCHEMA.get(ROUTING)).rows().isEmpty();
        report.with(describeOne(state, ROUTING, legacy));
        report.with(describeOne(state, TEMPLATE, legacy));
        report.with(describeOne(state, PROVIDER_TEMPLATE, legacy));
        Page catalogue = read(state, schema(CATALOGUE));
        report.with(new ConfigSourceReport.MasterSource(CATALOGUE, schema(CATALOGUE),
                catalogue.rows().size(), false, catalogue.stale()));
        return report;
    }

    private ConfigSourceReport.MasterSource describeOne(String state, String master, boolean legacy) {
        String schemaCode = legacy ? LEGACY_SCHEMA.get(master) : schema(master);
        Page page = read(state, schemaCode);
        return new ConfigSourceReport.MasterSource(master, schemaCode, page.rows().size(), legacy, page.stale());
    }

    private void logLegacyOnce(String stateTenant) {
        if (legacyLogged.putIfAbsent(stateTenant, Boolean.TRUE) == null) {
            log.info("Tenant {} has no NOTIFICATIONS.Routing rows — serving notification config from the "
                    + "legacy RAINMAKER-PGR.Notification* masters through the read adapter. Run "
                    + "`./deploy.sh <tenant> --tags notifications` to copy them; "
                    + "GET /novu-adapter/v1/config/source reports which namespace is in effect.", stateTenant);
        }
    }

    private List<RoutingRow> convertRouting(List<MdmsRow> rows) {
        List<RoutingRow> out = new ArrayList<>(rows.size());
        for (MdmsRow row : rows) {
            out.add(new RoutingRow(text(row.data().get("module")), text(row.data().get("eventName")),
                    text(row.data().get("audience")), upper(row.data().get("channel")), effectiveActive(row)));
        }
        return out;
    }

    private List<TemplateRow> convertTemplates(List<MdmsRow> rows) {
        List<TemplateRow> out = new ArrayList<>(rows.size());
        for (MdmsRow row : rows) {
            out.add(new TemplateRow(text(row.data().get("module")), text(row.data().get("eventName")),
                    text(row.data().get("audience")), upper(row.data().get("channel")),
                    locale(row.data().get("locale")), nullableText(row.data().get("subject")),
                    row.data().get("body") == null ? "" : String.valueOf(row.data().get("body")),
                    effectiveActive(row)));
        }
        return out;
    }

    private List<ProviderTemplateRow> convertProviderTemplates(List<MdmsRow> rows) {
        List<ProviderTemplateRow> out = new ArrayList<>(rows.size());
        for (MdmsRow row : rows) {
            out.add(new ProviderTemplateRow(text(row.data().get("provider")), upper(row.data().get("channel")),
                    text(row.data().get("eventName")), text(row.data().get("audience")),
                    locale(row.data().get("locale")), text(row.data().get("templateId")),
                    strings(row.data().get("variables")), nullableText(row.data().get("approvalStatus")),
                    effectiveActive(row)));
        }
        return out;
    }

    private List<RoutingRow> adaptRouting(List<MdmsRow> rows) {
        List<RoutingRow> out = new ArrayList<>();
        for (MdmsRow row : rows) {
            RoutingRow converted = adapt(row, LegacyMasterAdapter::convertRouting, ROUTING);
            if (converted != null) {
                out.add(new RoutingRow(converted.module(), converted.eventName(), converted.audience(),
                        converted.channel(), converted.active() && row.recordActive()));
            }
        }
        return out;
    }

    /** An unconvertible legacy row is logged and dropped, never allowed to fail the tenant. */
    private <T> T adapt(MdmsRow row, java.util.function.Function<Map<String, Object>, T> conversion,
                        String master) {
        try {
            return conversion.apply(row.data());
        } catch (LegacyMasterAdapter.ConversionException e) {
            log.warn("Skipping an unconvertible legacy {} row: {}", master, e.getMessage());
            return null;
        }
    }

    private static TemplateRow withActive(TemplateRow row, boolean recordActive) {
        return recordActive ? row : new TemplateRow(row.module(), row.eventName(), row.audience(),
                row.channel(), row.locale(), row.subject(), row.body(), false);
    }

    private static ProviderTemplateRow withActive(ProviderTemplateRow row, boolean recordActive) {
        return recordActive ? row : new ProviderTemplateRow(row.provider(), row.channel(), row.eventName(),
                row.audience(), row.locale(), row.templateId(), row.variables(), row.approvalStatus(), false);
    }

    private static List<Map<String, Object>> dataOf(List<MdmsRow> rows) {
        List<Map<String, Object>> out = new ArrayList<>(rows.size());
        for (MdmsRow row : rows) {
            out.add(row.data());
        }
        return out;
    }

    /**
     * Cached, paged, stale-tolerant. An empty answer never replaces a non-empty cached one (it may
     * be a transient miss). A FAILED read serves the last answer if there is one and otherwise
     * throws: a failure must never look like "this tenant has no rows", which would skip the
     * event or silently switch a migrated tenant to the legacy masters.
     */
    Page read(String stateTenant, String schemaCode) {
        if (!StringUtils.hasText(stateTenant) || restTemplate == null) {
            return new Page(Collections.emptyList(), false);
        }
        String key = stateTenant + "|" + schemaCode;
        long ttl = config.getNotificationConfigCacheTtlMs() != null
                ? config.getNotificationConfigCacheTtlMs() : 60_000L;
        List<MdmsRow> fresh = cache.fresh(key, ttl);
        if (fresh != null && !fresh.isEmpty()) {
            return new Page(fresh, false);
        }
        List<MdmsRow> last = cache.any(key);
        List<MdmsRow> fetched;
        try {
            fetched = fetchAllPages(stateTenant, schemaCode);
        } catch (RuntimeException e) {
            if (last == null) {
                log.error("Failed to read {} for tenant {} and no cached copy exists", schemaCode, stateTenant, e);
                throw new CustomException(ThinEventErrorCodes.CONFIG_UNAVAILABLE, "Could not read " + schemaCode
                        + " for tenant " + stateTenant + " and no cached copy exists: " + e.getMessage());
            }
            log.warn("Failed to read {} for tenant {} ({}); serving the cached copy", schemaCode, stateTenant,
                    e.getMessage());
            return new Page(last, true);
        }
        if (fetched.isEmpty() && last != null && !last.isEmpty()) {
            return new Page(last, true);
        }
        cache.put(key, fetched);
        return new Page(fetched, false);
    }

    @SuppressWarnings("unchecked")
    private List<MdmsRow> fetchAllPages(String stateTenant, String schemaCode) {
        List<MdmsRow> all = new ArrayList<>();
        int limit = config.getNotificationConfigPageSize() != null
                ? config.getNotificationConfigPageSize() : 200;
        int maxPages = config.getNotificationConfigMaxPages() != null
                ? config.getNotificationConfigMaxPages() : 50;
        String url = ServiceUrl.join(config.getMdmsHost(), config.getMdmsSearchPath());
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        for (int page = 0; page < maxPages; page++) {
            Map<String, Object> criteria = new LinkedHashMap<>();
            criteria.put("tenantId", stateTenant);
            criteria.put("schemaCode", schemaCode);
            criteria.put("limit", limit);
            criteria.put("offset", page * limit);
            Map<String, Object> body = new LinkedHashMap<>();
            body.put("RequestInfo", Map.of("apiId", "novu-bridge"));
            body.put("MdmsCriteria", criteria);

            ResponseEntity<Map> response = restTemplate.exchange(url, HttpMethod.POST,
                    new HttpEntity<>(body, headers), Map.class);
            Object mdms = response.getBody() == null ? null : response.getBody().get("mdms");
            if (!(mdms instanceof List)) {
                break;
            }
            List<Object> records = (List<Object>) mdms;
            for (Object record : records) {
                if (!(record instanceof Map)) {
                    continue;
                }
                Map<String, Object> wrapper = (Map<String, Object>) record;
                Object data = wrapper.get("data");
                if (data instanceof Map) {
                    all.add(new MdmsRow((Map<String, Object>) data,
                            !Boolean.FALSE.equals(wrapper.get("isActive"))));
                }
            }
            if (records.size() < limit) {
                break;   // short page: that was the last one
            }
            if (page == maxPages - 1) {
                log.warn("{} at tenant {} has more than {} rows; the rest were NOT read and their "
                                + "notifications will not fire. Raise novu.bridge.notifications.max.pages.",
                        schemaCode, stateTenant, limit * maxPages);
            }
        }
        return all;
    }

    private String schema(String master) {
        return config.getNotificationConfigNamespace() + "." + master;
    }

    /** Masters are held at the state root: {@code ke.bomet} reads {@code ke}. */
    static String stateTenant(String tenantId) {
        if (!StringUtils.hasText(tenantId)) {
            return null;
        }
        int dot = tenantId.indexOf('.');
        return dot < 0 ? tenantId : tenantId.substring(0, dot);
    }

    /** Active only when BOTH the record's isActive (soft delete) and the data's active flag agree. */
    private static boolean effectiveActive(MdmsRow row) {
        return row.recordActive() && LegacyMasterAdapter.isActive(row.data());
    }

    private static String text(Object value) {
        return value == null ? "" : String.valueOf(value).trim();
    }

    private static String nullableText(Object value) {
        return value == null ? null : String.valueOf(value);
    }

    private static String upper(Object value) {
        return text(value).toUpperCase(Locale.ROOT);
    }

    private static String locale(Object value) {
        String locale = text(value);
        return locale.isEmpty() ? LegacyMasterAdapter.DEFAULT_LOCALE : locale;
    }

    @SuppressWarnings("unchecked")
    private static List<String> strings(Object value) {
        List<String> out = new ArrayList<>();
        if (value instanceof List) {
            for (Object element : (List<Object>) value) {
                if (element != null) {
                    out.add(String.valueOf(element));
                }
            }
        }
        return out;
    }
}
