package org.egov.pgr.analytics;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.jayway.jsonpath.JsonPath;
import lombok.extern.slf4j.Slf4j;
import org.egov.common.contract.request.RequestInfo;
import org.egov.common.utils.MultiStateInstanceUtil;
import org.egov.mdms.model.MasterDetail;
import org.egov.mdms.model.MdmsCriteria;
import org.egov.mdms.model.MdmsCriteriaReq;
import org.egov.mdms.model.ModuleDetail;
import org.egov.pgr.analytics.model.DashboardPack;
import org.egov.pgr.analytics.model.KpiDefinition;
import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.repository.ServiceRequestRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.stream.Collectors;

/**
 * Loads KpiDefinition and DashboardPack records from MDMS (dss module) and applies
 * visibility filtering by status + caller roles.
 *
 * Uses the exact same MDMS client pattern as {@link org.egov.pgr.util.MDMSUtils}:
 * MdmsCriteriaReq built with builder, posted via ServiceRequestRepository.fetchResult,
 * result parsed with JsonPath.
 */
@Service
@Slf4j
public class KpiCatalogService {

    private static final String DSS_MODULE = "dss";
    private static final String MASTER_KPI  = "KpiDefinition";
    private static final String MASTER_PACK = "DashboardPack";
    private static final String MASTER_CONFIG = "DashboardConfig";

    /** The only departmentScoping value that turns employee department scoping OFF (#1280). */
    private static final String DEPT_SCOPING_DISABLED = "disabled";

    /**
     * Documented backward-compatible fallback zone (#29 timezone addendum) — used ONLY when a
     * tenant's state-root {@code dss.DashboardConfig.timeZone} is absent, malformed (not a valid
     * IANA zone id), or MDMS is unreachable. Matches the historical hardcoded EAT behavior every
     * unconfigured tenant already had, so an unconfigured deployment sees no change.
     */
    static final java.time.ZoneId DEFAULT_TIME_ZONE = BusinessCalendar.DEFAULT_ZONE;

    /**
     * ONE cached fetch of the state-root's {@code dss.DashboardConfig} record, shared by
     * {@link #isDepartmentScopingDisabled}, {@link #isPublicDashboardEnabled}, and
     * {@link #resolveTimeZone} so the config axes
     * never trigger duplicate MDMS calls or run parallel cache implementations (#29 requirement).
     * stateRoot -> [Map<String,Object> record-or-null, Long expiresAtMs].
     */
    private final java.util.concurrent.ConcurrentHashMap<String, Object[]> dashboardConfigCache =
            new java.util.concurrent.ConcurrentHashMap<>();
    /** Injectable clock for cache-expiry tests (see KpiCatalogServiceDeptScopingTest). */
    private java.util.function.LongSupplier configClock = System::currentTimeMillis;
    /**
     * TTL-bounded warning gate for {@link #resolveTimeZone}'s fallback logging — see
     * {@link #shouldWarnTimeZoneFallback}. stateRoot -> the {@code dashboardConfigCache}
     * generation (expiresAtMs) already warned for.
     */
    private final java.util.concurrent.ConcurrentHashMap<String, Long> timeZoneFallbackWarnedGeneration =
            new java.util.concurrent.ConcurrentHashMap<>();
    /** Same per-cache-generation gate for the department-scoping-disabled INFO line. */
    private final java.util.concurrent.ConcurrentHashMap<String, Long> deptScopingDisabledLoggedGeneration =
            new java.util.concurrent.ConcurrentHashMap<>();

    private final PGRConfiguration config;
    private final ServiceRequestRepository serviceRequestRepository;
    private final MultiStateInstanceUtil multiStateInstanceUtil;
    private final ObjectMapper mapper;

    @Autowired
    public KpiCatalogService(PGRConfiguration config,
                             ServiceRequestRepository serviceRequestRepository,
                             MultiStateInstanceUtil multiStateInstanceUtil,
                             ObjectMapper mapper) {
        this.config = config;
        this.serviceRequestRepository = serviceRequestRepository;
        this.multiStateInstanceUtil = multiStateInstanceUtil;
        this.mapper = mapper;
    }

    /**
     * Every published KpiDefinition the caller's resolved capabilities reach,
     * scoped to the state-root tenant derived from tenantId.
     * Returns an empty list (never throws) when the dss module does not exist in MDMS.
     */
    public List<KpiDefinition> getVisibleDefs(String tenantId, AnalyticsCapabilities capabilities) {
        String stateRoot = multiStateInstanceUtil.getStateLevelTenant(tenantId);
        List<KpiDefinition> all = fetchDefs(stateRoot);
        return all.stream()
                .filter(KpiDefinition::isPublished)
                .filter(capabilities::canSee)
                .collect(Collectors.toList());
    }

    /**
     * The first DashboardPack the caller's capabilities select, searching
     * from MDMS for the state-root tenant. Returns Optional.empty() when none match or
     * when the dss module does not exist.
     */
    public Optional<DashboardPack> getBestPack(String tenantId, AnalyticsCapabilities capabilities,
                                               List<KpiDefinition> visibleDefs) {
        String stateRoot = multiStateInstanceUtil.getStateLevelTenant(tenantId);
        Set<String> visibleIds = visibleDefs.stream()
                .map(KpiDefinition::getId)
                .collect(Collectors.toSet());

        return fetchPacks(stateRoot).stream()
                .filter(capabilities::canSee)
                // Filter pack tiles down to only what the caller can actually see
                .peek(p -> {
                    if (p.getTiles() != null)
                        p.setTiles(p.getTiles().stream().filter(visibleIds::contains).collect(Collectors.toList()));
                    if (p.getLayout() != null)
                        p.setLayout(p.getLayout().stream()
                                .filter(e -> visibleIds.contains(e.getKpiId()))
                                .collect(Collectors.toList()));
                })
                .findFirst();
    }

    /**
     * Returns a single KpiDefinition by id (no visibility check — the caller must apply
     * isVisibleTo separately). Returns Optional.empty() when not found or MDMS unavailable.
     */
    public Optional<KpiDefinition> getDef(String kpiId, String tenantId) {
        String stateRoot = multiStateInstanceUtil.getStateLevelTenant(tenantId);
        return fetchDefs(stateRoot).stream()
                .filter(d -> kpiId.equals(d.getId()))
                .findFirst();
    }

    /**
     * Whether {@code dss.DashboardConfig.departmentScoping} is {@code "disabled"} for the tenant's
     * state root (#1280) — i.e. employees should NOT be department-scoped on the analytics API.
     *
     * <p>Returns {@code true} only when a DashboardConfig record exists whose
     * {@code departmentScoping} equals {@code "disabled"} (case-insensitive, trimmed). Everything
     * else — module/record/field absent, malformed value, MDMS unreachable — resolves to
     * {@code false} ("enforced", today's behavior). Fail-safe by construction; this method never
     * throws.
     *
     * <p>Cached in-memory per state root (both outcomes) for
     * {@code pgr.analytics.config-cache-ttl-ms} (the single TTL shared by every analytics
     * config cache; default 5 minutes), mirroring the {@code recordCount} cache idiom in
     * AnalyticsService — a config flip takes effect within one TTL without a redeploy.
     */
    public boolean isDepartmentScopingDisabled(String tenantId) {
        try {
            if (tenantId == null || tenantId.isEmpty()) return false;
            String stateRoot = multiStateInstanceUtil.getStateLevelTenant(tenantId);
            Object[] entry = dashboardConfigEntry(tenantId);
            @SuppressWarnings("unchecked")
            Map<String, Object> record = (Map<String, Object>) entry[0];
            if (record == null) return false;
            Object v = record.get("departmentScoping");
            boolean disabled = v instanceof String && DEPT_SCOPING_DISABLED.equalsIgnoreCase(((String) v).trim());
            if (disabled && shouldLogDepartmentScopingDisabled(stateRoot, (Long) entry[1]))
                log.info("dss.DashboardConfig.departmentScoping=disabled at {} — employee department scoping OFF",
                        stateRoot);
            return disabled;
        } catch (Exception e) {
            // Fail-safe: any unexpected error means "enforced" (current behavior), never a throw
            // that could flip the caller's HRMS-error path to deny-all.
            log.warn("departmentScoping lookup failed for tenant {}; treating as enforced", tenantId, e);
            return false;
        }
    }

    /**
     * Whether the state root explicitly enables the credential-free dashboard.
     *
     * <p>This is deliberately fail-closed: only the JSON boolean {@code true} in
     * {@code dss.DashboardConfig.publicDashboardEnabled} enables the public data plane. An absent
     * record/field, a string such as {@code "true"}, an MDMS failure, or any unexpected error all
     * resolve to {@code false}. It shares the same state-root cache as the other DashboardConfig
     * fields, so a configurator change reaches every public endpoint together within the configured
     * analytics config-cache TTL (five minutes by default).
     */
    public boolean isPublicDashboardEnabled(String tenantId) {
        try {
            if (tenantId == null || tenantId.isEmpty()) return false;
            Map<String, Object> record = dashboardConfig(tenantId);
            return record != null && Boolean.TRUE.equals(record.get("publicDashboardEnabled"));
        } catch (Exception e) {
            log.warn("publicDashboardEnabled lookup failed for tenant {}; treating as disabled", tenantId, e);
            return false;
        }
    }

    /**
     * Evict and immediately reload the state-root DashboardConfig after an authenticated
     * configurator write. Returning the freshly resolved switch lets the caller verify the write
     * reached the analytics data plane instead of waiting for the normal TTL.
     */
    public boolean refreshPublicDashboardConfig(String tenantId) {
        if (tenantId == null || tenantId.isEmpty()) return false;
        String stateRoot = multiStateInstanceUtil.getStateLevelTenant(tenantId);
        dashboardConfigCache.remove(stateRoot);
        timeZoneFallbackWarnedGeneration.remove(stateRoot);
        return isPublicDashboardEnabled(tenantId);
    }

    /**
     * Resolve the IANA {@link java.time.ZoneId} {@code dss.DashboardConfig.timeZone} declares for
     * this tenant's state root (#29 timezone addendum) — the single source of the analytics
     * calendar zone every downstream consumer (planner, composer, compose ops, response) uses.
     *
     * <p>Falls back to {@link #DEFAULT_TIME_ZONE} (Africa/Nairobi, documented migration
     * compatibility default) when the record/field is absent, the value fails
     * {@link java.time.ZoneId#of}, or MDMS is unreachable (fetchMaster resolves that to "no
     * record" — see {@link #fetchMaster}). Logged at WARN, gated by {@link #shouldWarnTimeZoneFallback}
     * so it fires at most once per {@link #dashboardConfigEntry} cache generation (i.e. once per
     * TTL window) per state root, then again the first request after that generation's config
     * refresh — never once per request. The rare genuine-exception path (e.g. state-root
     * resolution itself throwing) is not TTL-gated; it is not expected to repeat every request.
     * Never throws; never consults the browser or JVM default zone.
     */
    public java.time.ZoneId resolveTimeZone(String tenantId) {
        try {
            if (tenantId == null || tenantId.isEmpty()) return DEFAULT_TIME_ZONE;
            String stateRoot = multiStateInstanceUtil.getStateLevelTenant(tenantId);
            Object[] entry = dashboardConfigEntry(tenantId);
            @SuppressWarnings("unchecked")
            Map<String, Object> record = (Map<String, Object>) entry[0];
            long generation = (Long) entry[1];
            if (record == null) {
                if (shouldWarnTimeZoneFallback(stateRoot, generation)) {
                    log.warn("dss.DashboardConfig not found at {} — falling back to {} (migration compatibility default)",
                            stateRoot, DEFAULT_TIME_ZONE);
                }
                return DEFAULT_TIME_ZONE;
            }
            Object v = record.get("timeZone");
            if (!(v instanceof String) || ((String) v).trim().isEmpty()) {
                if (shouldWarnTimeZoneFallback(stateRoot, generation)) {
                    log.warn("dss.DashboardConfig.timeZone not configured at {} — falling back to {}",
                            stateRoot, DEFAULT_TIME_ZONE);
                }
                return DEFAULT_TIME_ZONE;
            }
            try {
                return java.time.ZoneId.of(((String) v).trim());
            } catch (java.time.DateTimeException ex) {
                if (shouldWarnTimeZoneFallback(stateRoot, generation)) {
                    log.warn("dss.DashboardConfig.timeZone '{}' at {} is not a valid IANA zone — falling back to {}",
                            v, stateRoot, DEFAULT_TIME_ZONE);
                }
                return DEFAULT_TIME_ZONE;
            }
        } catch (Exception e) {
            log.warn("timeZone lookup failed for tenant {}; falling back to {}", tenantId, DEFAULT_TIME_ZONE, e);
            return DEFAULT_TIME_ZONE;
        }
    }

    /**
     * Per-state-root TTL-bounded warning gate for {@link #resolveTimeZone}'s fallback branches
     * (#29 review fix): {@code generation} is the owning cache entry's {@code expiresAtMs} (see
     * {@link #dashboardConfigEntry}) — a stable id for "this fetch" that changes only when the
     * TTL expires and the config is re-fetched. Returns {@code true} (and atomically records
     * {@code generation} as warned) the FIRST time a given state root/generation pair asks;
     * every subsequent call for the same still-cached generation returns {@code false}, so a
     * missing/invalid config warns once per TTL window, then again only after the next refresh.
     *
     * <p>{@code ConcurrentHashMap#compute} makes the check-and-set atomic per key, so concurrent
     * requests racing the same state root's first warning cannot both win. Keyed 1:1 with
     * {@link #dashboardConfigCache}'s own state-root key set — no separate unbounded retention;
     * an entry here lives exactly as long as its config-cache counterpart is relevant.
     */
    private boolean shouldWarnTimeZoneFallback(String stateRoot, long generation) {
        boolean[] shouldWarn = {false};
        timeZoneFallbackWarnedGeneration.compute(stateRoot, (root, warnedGeneration) -> {
            if (warnedGeneration == null || warnedGeneration != generation) {
                shouldWarn[0] = true;
                return generation;
            }
            return warnedGeneration;
        });
        return shouldWarn[0];
    }

    /**
     * Returns true once per state-root DashboardConfig cache generation, preventing the
     * department-scoping-disabled INFO line from becoming a per-request log.
     */
    private boolean shouldLogDepartmentScopingDisabled(String stateRoot, long generation) {
        boolean[] shouldLog = {false};
        deptScopingDisabledLoggedGeneration.compute(stateRoot, (root, loggedGeneration) -> {
            if (loggedGeneration == null || loggedGeneration != generation) {
                shouldLog[0] = true;
                return generation;
            }
            return loggedGeneration;
        });
        return shouldLog[0];
    }

    /**
     * THE single cached fetch of the state-root's {@code dss.DashboardConfig} record — the shared
     * seam {@link #isDepartmentScopingDisabled}, {@link #isPublicDashboardEnabled}, and
     * {@link #resolveTimeZone} all read, so a request touching multiple axes issues exactly one
     * MDMS call and any config-field flip takes effect within one {@link #configCacheTtlMs()}
     * window. Returns {@code null} (cached) when no record exists; never throws — callers apply
     * their own field-specific fallback.
     */
    private Map<String, Object> dashboardConfig(String tenantId) {
        @SuppressWarnings("unchecked")
        Map<String, Object> record = (Map<String, Object>) dashboardConfigEntry(tenantId)[0];
        return record;
    }

    /**
     * THE single cached fetch of the state-root's {@code dss.DashboardConfig} record — the shared
     * seam {@link #dashboardConfig} and the logging gates both read. Also exposes the cache entry's
     * {@code expiresAtMs} as its generation id so those gates can distinguish "still the same TTL
     * window" from "config was just re-fetched". Returns
     * {@code Object[]{Map<String,Object> record-or-null, Long expiresAtMs}}.
     */
    private Object[] dashboardConfigEntry(String tenantId) {
        String stateRoot = multiStateInstanceUtil.getStateLevelTenant(tenantId);
        return dashboardConfigCache.compute(stateRoot, (root, cached) -> {
            long now = configClock.getAsLong();
            if (cached != null && (Long) cached[1] > now) return cached;

            List<Map<String, Object>> records =
                    fetchMaster(root, MASTER_CONFIG, new TypeReference<List<Map<String, Object>>>() {});
            Map<String, Object> selected = selectDashboardConfigRecord(records);
            // Unmodifiable: this same Map instance is cached and handed to every caller/thread until
            // the TTL expires, so a caller mutating it must never corrupt the shared cache.
            Map<String, Object> record = selected == null
                    ? null : Collections.unmodifiableMap(selected);
            return new Object[]{record, now + configCacheTtlMs()};
        });
    }

    /**
     * Deterministic dashboard-config record selection when MDMS returns more than one active
     * {@code dss.DashboardConfig} record for a state root (duplicate/malformed data) — the same
     * rule applied by the {@code pgr_dashboard_tenant_timezone} SQL view (ORDER BY) and the FE's
     * {@code useDashboardConfig.js}, so every layer picks the identical record from identical
     * data. Depends only on fields present in the MDMS data object itself:
     * <ol>
     *   <li>the record whose (trimmed) {@code id} equals {@code "default"} wins;</li>
     *   <li>else the first record in API response order (the historical behavior).</li>
     * </ol>
     * Deliberately does NOT consult API ordering guarantees or audit metadata
     * (lastModifiedTime etc.) unavailable on this Java data map. Returns {@code null} for an
     * empty list; a single record is always returned unchanged.
     */
    static Map<String, Object> selectDashboardConfigRecord(List<Map<String, Object>> records) {
        if (records == null || records.isEmpty()) return null;
        if (records.size() == 1) return records.get(0);

        for (Map<String, Object> r : records) {
            if ("default".equals(trimmedId(r))) return r;
        }

        return records.get(0);
    }

    private static String trimmedId(Map<String, Object> record) {
        Object id = record == null ? null : record.get("id");
        return id instanceof String ? ((String) id).trim() : null;
    }

    /**
     * The shared analytics config-cache TTL ({@code pgr.analytics.config-cache-ttl-ms});
     * falls back to the 5-minute default when the config mock/bean has no value.
     * Same accessor idiom as AnalyticsService.configCacheTtlMs().
     */
    private long configCacheTtlMs() {
        Long v = config == null ? null : config.getAnalyticsConfigCacheTtlMs();
        return v != null ? v : PGRConfiguration.DEFAULT_ANALYTICS_CONFIG_CACHE_TTL_MS;
    }

    // ---- private MDMS helpers ----

    private List<KpiDefinition> fetchDefs(String stateRoot) {
        return fetchMaster(stateRoot, MASTER_KPI, new TypeReference<List<KpiDefinition>>() {});
    }

    private List<DashboardPack> fetchPacks(String stateRoot) {
        return fetchMaster(stateRoot, MASTER_PACK, new TypeReference<List<DashboardPack>>() {});
    }

    private <T> List<T> fetchMaster(String stateRoot, String masterName, TypeReference<List<T>> typeRef) {
        try {
            MdmsCriteriaReq req = buildMdmsRequest(new RequestInfo(), stateRoot, masterName);
            Object result = serviceRequestRepository.fetchResult(getMdmsSearchUrl(), req);
            if (result == null) return Collections.emptyList();

            String jsonPath = "$.MdmsRes." + DSS_MODULE + "." + masterName;
            List<Object> raw = JsonPath.read(result, jsonPath);
            if (raw == null || raw.isEmpty()) return Collections.emptyList();

            return mapper.convertValue(raw, typeRef);
        } catch (com.jayway.jsonpath.PathNotFoundException e) {
            // dss module or master not present in MDMS — graceful empty
            log.debug("MDMS path not found for {}.{} at tenant {}: {}", DSS_MODULE, masterName, stateRoot, e.getMessage());
            return Collections.emptyList();
        } catch (Exception e) {
            log.warn("Failed to load {}.{} from MDMS for tenant {}; returning empty list. Cause: {}",
                    DSS_MODULE, masterName, stateRoot, e.getMessage());
            return Collections.emptyList();
        }
    }

    private MdmsCriteriaReq buildMdmsRequest(RequestInfo requestInfo, String tenantId, String masterName) {
        MasterDetail masterDetail = MasterDetail.builder().name(masterName).build();
        ModuleDetail moduleDetail = ModuleDetail.builder()
                .moduleName(DSS_MODULE)
                .masterDetails(Collections.singletonList(masterDetail))
                .build();
        MdmsCriteria mdmsCriteria = MdmsCriteria.builder()
                .tenantId(tenantId)
                .moduleDetails(Collections.singletonList(moduleDetail))
                .build();
        return MdmsCriteriaReq.builder()
                .requestInfo(requestInfo)
                .mdmsCriteria(mdmsCriteria)
                .build();
    }

    private StringBuilder getMdmsSearchUrl() {
        return new StringBuilder().append(config.getMdmsHost()).append(config.getMdmsEndPoint());
    }
}
