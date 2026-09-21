package org.egov.novubridge.service.resolution.digit;

import lombok.extern.slf4j.Slf4j;
import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.service.resolution.config.ConfigSourceReport;
import org.egov.novubridge.service.resolution.config.NotificationConfigRepository;
import org.egov.novubridge.service.resolution.config.NotificationConfigRows.CatalogueRow;
import org.egov.novubridge.service.resolution.config.NotificationConfigRows.ProviderTemplateRow;
import org.egov.novubridge.service.resolution.config.NotificationConfigRows.RoutingRow;
import org.egov.novubridge.service.resolution.config.NotificationConfigRows.TemplateRow;
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
 * <h2>Three behaviours that are the whole value of this class</h2>
 *
 * <p><b>1. Stale beats empty.</b> An empty fetch is NEVER cached — it is indistinguishable from a
 * transient MDMS miss, and caching it would turn a blip into a TTL-long notification outage — and
 * a last-known non-empty entry is served straight through an MDMS outage. This is ported verbatim
 * from the producer's readers, which is the one piece of caching in this codebase that was already
 * exactly right. Moving routing into the box makes MDMS a wider single point of failure, and this
 * is the mitigation.
 *
 * <p><b>2. Every page is read.</b> MDMS v2 answers a page, not a set; a single-page read is a
 * known bug class here, and it fails in the worst possible way — the first hundred routing rows
 * work and the hundred-and-first silently never fires. The loop runs until a short page, capped so
 * a misbehaving server cannot spin it forever.
 *
 * <p><b>3. The legacy namespace is a per-tenant, all-or-nothing fallback.</b> A tenant with zero
 * {@code NOTIFICATIONS.Routing} rows is served its {@code RAINMAKER-PGR.Notification*} rows,
 * adapted on the way in by {@link LegacyMasterAdapter}. Per tenant and never per row: per-row
 * precedence between two namespaces is the kind of thing nobody can reason about at 2am. It is
 * logged once per tenant and readable at {@code GET /novu-adapter/v1/config/source}, because there
 * is no SETTING that chooses — the data chooses, and the choice must be visible.
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
    static final class MdmsRow {
        final Map<String, Object> data;
        final boolean recordActive;

        MdmsRow(Map<String, Object> data, boolean recordActive) {
            this.data = data;
            this.recordActive = recordActive;
        }
    }

    /** What a read returned, and whether it came from a cache entry past its TTL. */
    static final class Page {
        final List<MdmsRow> rows;
        final boolean stale;

        Page(List<MdmsRow> rows, boolean stale) {
            this.rows = rows;
            this.stale = stale;
        }
    }

    private static final class Timed {
        final List<MdmsRow> rows;
        final long fetchedAt = System.currentTimeMillis();

        Timed(List<MdmsRow> rows) {
            this.rows = rows;
        }

        boolean fresh(long ttl) {
            return System.currentTimeMillis() - fetchedAt < ttl;
        }
    }

    private final RestTemplate restTemplate;
    private final NovuBridgeConfiguration config;
    private final Map<String, Timed> cache = new ConcurrentHashMap<>();
    private final Map<String, Boolean> legacyLogged = new ConcurrentHashMap<>();

    public MdmsNotificationConfigRepository(@Nullable RestTemplate restTemplate,
                                            NovuBridgeConfiguration config) {
        this.restTemplate = restTemplate;
        this.config = config;
    }

    // ---- the four masters --------------------------------------------------

    @Override
    public List<RoutingRow> routing(String tenantId) {
        String state = stateTenant(tenantId);
        Page current = read(state, schema(ROUTING));
        if (!current.rows.isEmpty()) {
            return convertRouting(current.rows);
        }
        Page legacy = read(state, LEGACY_SCHEMA.get(ROUTING));
        if (legacy.rows.isEmpty()) {
            return Collections.emptyList();
        }
        logLegacyOnce(state);
        return adaptRouting(legacy.rows);
    }

    @Override
    public List<TemplateRow> templates(String tenantId) {
        String state = stateTenant(tenantId);
        if (!usesLegacy(state)) {
            return convertTemplates(read(state, schema(TEMPLATE)).rows);
        }
        Map<String, String> index = LegacyMasterAdapter.buildAudienceIndex(
                dataOf(read(state, LEGACY_SCHEMA.get(ROUTING)).rows));
        List<TemplateRow> out = new ArrayList<>();
        for (MdmsRow row : read(state, LEGACY_SCHEMA.get(TEMPLATE)).rows) {
            TemplateRow converted = adapt(row, r -> LegacyMasterAdapter.convertTemplate(r, index), TEMPLATE);
            if (converted != null) {
                out.add(withActive(converted, row.recordActive));
            }
        }
        return out;
    }

    @Override
    public List<ProviderTemplateRow> providerTemplates(String tenantId) {
        String state = stateTenant(tenantId);
        if (!usesLegacy(state)) {
            return convertProviderTemplates(read(state, schema(PROVIDER_TEMPLATE)).rows);
        }
        Map<String, String> index = LegacyMasterAdapter.buildAudienceIndex(
                dataOf(read(state, LEGACY_SCHEMA.get(ROUTING)).rows));
        List<ProviderTemplateRow> out = new ArrayList<>();
        for (MdmsRow row : read(state, LEGACY_SCHEMA.get(PROVIDER_TEMPLATE)).rows) {
            ProviderTemplateRow converted =
                    adapt(row, r -> LegacyMasterAdapter.convertProviderTemplate(r, index), PROVIDER_TEMPLATE);
            if (converted != null) {
                out.add(withActive(converted, row.recordActive));
            }
        }
        return out;
    }

    /**
     * The event catalogue. There is NO legacy equivalent — the catalogue is new — so a tenant
     * still on the legacy masters simply has none, and the resolution stage treats an empty
     * catalogue as "no membership check", which is what makes the image-before-playbook upgrade
     * survivable.
     */
    @Override
    public List<CatalogueRow> catalogue(String tenantId) {
        List<CatalogueRow> out = new ArrayList<>();
        for (MdmsRow row : read(stateTenant(tenantId), schema(CATALOGUE)).rows) {
            out.add(new CatalogueRow(
                    text(row.data.get("module")),
                    text(row.data.get("eventName")),
                    text(row.data.get("entityType")),
                    text(row.data.get("label")),
                    maps(row.data.get("placeholders")),
                    effectiveActive(row)));
        }
        return out;
    }

    // ---- observability -----------------------------------------------------

    @Override
    public ConfigSourceReport describe(String tenantId) {
        String state = stateTenant(tenantId);
        ConfigSourceReport report = new ConfigSourceReport(tenantId, state);
        boolean legacy = usesLegacy(state);
        report.with(describeOne(state, ROUTING, legacy));
        report.with(describeOne(state, TEMPLATE, legacy));
        report.with(describeOne(state, PROVIDER_TEMPLATE, legacy));
        // The catalogue never has a legacy source; saying so explicitly is more useful than
        // leaving a reader to infer it from an absence.
        Page catalogue = read(state, schema(CATALOGUE));
        report.with(new ConfigSourceReport.MasterSource(CATALOGUE, schema(CATALOGUE),
                catalogue.rows.size(), false, catalogue.stale));
        return report;
    }

    private ConfigSourceReport.MasterSource describeOne(String state, String master, boolean legacy) {
        String schemaCode = legacy ? LEGACY_SCHEMA.get(master) : schema(master);
        Page page = read(state, schemaCode);
        return new ConfigSourceReport.MasterSource(master, schemaCode, page.rows.size(), legacy, page.stale);
    }

    /**
     * Whether this tenant is served from the legacy namespace: decided ONCE, on the routing
     * master, for every master. A tenant whose routing has been copied but whose templates have
     * not is a half-migrated tenant, and the honest answer there is "the copy did not finish",
     * not "serve each master from wherever it happens to have rows".
     */
    private boolean usesLegacy(String stateTenant) {
        if (!read(stateTenant, schema(ROUTING)).rows.isEmpty()) {
            return false;
        }
        boolean legacy = !read(stateTenant, LEGACY_SCHEMA.get(ROUTING)).rows.isEmpty();
        if (legacy) {
            logLegacyOnce(stateTenant);
        }
        return legacy;
    }

    private void logLegacyOnce(String stateTenant) {
        if (legacyLogged.putIfAbsent(stateTenant, Boolean.TRUE) == null) {
            log.info("Tenant {} has no NOTIFICATIONS.Routing rows — serving notification config from the "
                    + "legacy RAINMAKER-PGR.Notification* masters through the read adapter. Run "
                    + "`./deploy.sh <tenant> --tags notifications` to copy them; "
                    + "GET /novu-adapter/v1/config/source reports which namespace is in effect.", stateTenant);
        }
    }

    // ---- conversion of new-namespace rows ----------------------------------

    private List<RoutingRow> convertRouting(List<MdmsRow> rows) {
        List<RoutingRow> out = new ArrayList<>(rows.size());
        for (MdmsRow row : rows) {
            out.add(new RoutingRow(text(row.data.get("module")), text(row.data.get("eventName")),
                    text(row.data.get("audience")), upper(row.data.get("channel")), effectiveActive(row)));
        }
        return out;
    }

    private List<TemplateRow> convertTemplates(List<MdmsRow> rows) {
        List<TemplateRow> out = new ArrayList<>(rows.size());
        for (MdmsRow row : rows) {
            out.add(new TemplateRow(text(row.data.get("module")), text(row.data.get("eventName")),
                    text(row.data.get("audience")), upper(row.data.get("channel")),
                    locale(row.data.get("locale")), nullableText(row.data.get("subject")),
                    row.data.get("body") == null ? "" : String.valueOf(row.data.get("body")),
                    effectiveActive(row)));
        }
        return out;
    }

    private List<ProviderTemplateRow> convertProviderTemplates(List<MdmsRow> rows) {
        List<ProviderTemplateRow> out = new ArrayList<>(rows.size());
        for (MdmsRow row : rows) {
            out.add(new ProviderTemplateRow(text(row.data.get("provider")), upper(row.data.get("channel")),
                    text(row.data.get("eventName")), text(row.data.get("audience")),
                    locale(row.data.get("locale")), text(row.data.get("templateId")),
                    strings(row.data.get("variables")), nullableText(row.data.get("approvalStatus")),
                    effectiveActive(row)));
        }
        return out;
    }

    // ---- legacy adaptation --------------------------------------------------

    private List<RoutingRow> adaptRouting(List<MdmsRow> rows) {
        List<RoutingRow> out = new ArrayList<>();
        for (MdmsRow row : rows) {
            RoutingRow converted = adapt(row, LegacyMasterAdapter::convertRouting, ROUTING);
            if (converted != null) {
                out.add(new RoutingRow(converted.module(), converted.eventName(), converted.audience(),
                        converted.channel(), converted.active() && row.recordActive));
            }
        }
        return out;
    }

    /**
     * One legacy row through the adapter, with a conversion failure logged and dropped rather than
     * thrown. A single unconvertible row — a routing row with a blank action, say — must not take
     * a whole tenant's notifications down with it.
     */
    private <T> T adapt(MdmsRow row, java.util.function.Function<Map<String, Object>, T> conversion,
                        String master) {
        try {
            return conversion.apply(row.data);
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
            out.add(row.data);
        }
        return out;
    }

    // ---- MDMS --------------------------------------------------------------

    /** Cached, paged, stale-tolerant. Returns an empty page when the tenant genuinely has none. */
    Page read(String stateTenant, String schemaCode) {
        if (!StringUtils.hasText(stateTenant) || restTemplate == null) {
            return new Page(Collections.emptyList(), false);
        }
        String key = stateTenant + "|" + schemaCode;
        long ttl = config.getNotificationConfigCacheTtlMs() != null
                ? config.getNotificationConfigCacheTtlMs() : 60_000L;
        Timed cached = cache.get(key);
        if (cached != null && cached.fresh(ttl)) {
            return new Page(cached.rows, false);
        }
        List<MdmsRow> fetched = fetchAllPages(stateTenant, schemaCode);
        if (!fetched.isEmpty()) {
            cache.put(key, new Timed(fetched));
            return new Page(fetched, false);
        }
        // Empty means "transient MDMS miss" OR "genuinely unseeded". Never cache it; serve a
        // stale non-empty entry rather than dropping this tenant's notifications over a blip.
        return cached != null ? new Page(cached.rows, true) : new Page(Collections.emptyList(), false);
    }

    @SuppressWarnings("unchecked")
    private List<MdmsRow> fetchAllPages(String stateTenant, String schemaCode) {
        List<MdmsRow> all = new ArrayList<>();
        int limit = config.getNotificationConfigPageSize() != null
                ? config.getNotificationConfigPageSize() : 200;
        int maxPages = config.getNotificationConfigMaxPages() != null
                ? config.getNotificationConfigMaxPages() : 50;
        try {
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
        } catch (Exception e) {
            log.error("Failed to read {} for tenant {} — this tenant's notifications will be served from a "
                    + "stale cache entry, or dropped, until MDMS recovers", schemaCode, stateTenant, e);
            return Collections.emptyList();
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

    /**
     * A row is active only when BOTH flags say so: the MDMS record-level {@code isActive} (what a
     * soft delete sets) and the data block's own {@code active} column (what the Configurator's
     * deactivate toggle sets). Either one being false means an operator turned this row off.
     */
    private static boolean effectiveActive(MdmsRow row) {
        return row.recordActive && LegacyMasterAdapter.isActive(row.data);
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

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> maps(Object value) {
        List<Map<String, Object>> out = new ArrayList<>();
        if (value instanceof List) {
            for (Object element : (List<Object>) value) {
                if (element instanceof Map) {
                    out.add((Map<String, Object>) element);
                }
            }
        }
        return out;
    }
}
