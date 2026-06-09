package org.egov.pgr.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.jayway.jsonpath.JsonPath;
import io.opentelemetry.api.trace.Span;
import lombok.extern.slf4j.Slf4j;
import org.egov.common.contract.request.RequestInfo;
import org.egov.common.contract.request.Role;
import org.egov.common.contract.request.User;
import org.egov.common.utils.MultiStateInstanceUtil;
import org.egov.mdms.model.*;
import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.repository.PGRRepository;
import org.egov.pgr.repository.ServiceRequestRepository;
import org.egov.pgr.util.EscalationSkipReason;
import org.egov.pgr.util.MDMSUtils;
import org.egov.pgr.util.PGRConstants;
import org.egov.pgr.web.models.*;
import org.egov.pgr.web.models.EscalationTriggerResponse.EscalationOutcome;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.util.CollectionUtils;

import java.util.*;
import java.util.stream.Collectors;

import static org.egov.pgr.util.PGRConstants.*;

@Component
@Slf4j
public class EscalationScheduler {

    private final PGRConfiguration config;
    private final PGRRepository repository;
    private final EscalationService escalationService;
    private final ServiceRequestRepository serviceRequestRepository;
    private final MDMSUtils mdmsUtils;
    private final ObjectMapper mapper;
    private final MultiStateInstanceUtil multiStateInstanceUtil;

    @Value("${egov.state.level.tenant.id:ke}")
    private String stateLevelTenantId;

    @Autowired
    public EscalationScheduler(PGRConfiguration config, PGRRepository repository,
                               EscalationService escalationService,
                               ServiceRequestRepository serviceRequestRepository,
                               MDMSUtils mdmsUtils, ObjectMapper mapper,
                               MultiStateInstanceUtil multiStateInstanceUtil) {
        this.config = config;
        this.repository = repository;
        this.escalationService = escalationService;
        this.serviceRequestRepository = serviceRequestRepository;
        this.mdmsUtils = mdmsUtils;
        this.mapper = mapper;
        this.multiStateInstanceUtil = multiStateInstanceUtil;
    }

    /**
     * Cron entry-point. Wraps {@link #scanAndEscalateOnce(String, java.util.List, RequestInfo)} so the @Scheduled
     * trigger and the synchronous /escalation/_trigger endpoint share one code path.
     */
    @Scheduled(fixedDelayString = "${pgr.escalation.interval.ms}")
    public void scanAndEscalate() {
        if (!Boolean.TRUE.equals(config.getEscalationEnabled())) {
            return;
        }

        log.info("Escalation scan started");

        String tenantId = getStateLevelTenantId();
        if (tenantId == null) {
            log.warn("Cannot determine state-level tenant ID, skipping escalation scan");
            return;
        }

        scanAndEscalateOnce(tenantId, null, buildSystemRequestInfo());
    }

    /**
     * Single, reusable escalation scan. Called by both the @Scheduled trigger
     * and the {@code POST /escalation/_trigger} controller. Synchronous: returns
     * only after every candidate has been processed.
     *
     * @param tenantId           state-level tenant to scan (e.g. {@code "ke"})
     * @param serviceRequestIds  optional scoping; null/empty = scan all candidates in PENDINGATLME / PENDINGFORASSIGNMENT
     * @param requestInfo        RequestInfo to use for downstream calls (workflow, HRMS). Caller passes
     *                           either a SYSTEM RequestInfo (cron) or the original SUPERUSER RequestInfo
     *                           augmented with AUTO_ESCALATE (controller).
     */
    public EscalationTriggerResponse scanAndEscalateOnce(String tenantId,
                                                         List<String> serviceRequestIds,
                                                         RequestInfo requestInfo) {

        Span span = Span.current();
        span.setAttribute("escalation.tenantId", tenantId == null ? "" : tenantId);

        Map<String, Object> escalationConfig = fetchEscalationConfig(requestInfo, tenantId);
        int maxDepth = getMaxDepth(escalationConfig);
        List<Long> defaultSlaByLevel = getDefaultSlaByLevel(escalationConfig);
        Map<String, List<Long>> overrides = getOverrides(escalationConfig);

        // CRS escalation-SLA (BRD v4.0) — loaded once per scan so the per-complaint
        // resolveSlaHours call is a pure local lookup. Both reads are best-effort:
        // a missing/empty CRS namespace falls through to the v0 EscalationConfig
        // path below.
        List<Map<String, Object>> crsCategorySla = fetchCrsCategorySla(requestInfo, tenantId);
        Map<String, Number> crsStateSlaDefaults = fetchCrsStateSlaDefaults(requestInfo, tenantId);
        Map<String, Map<String, Object>> serviceCodeToCategory = buildServiceCodeMapping(requestInfo, tenantId);

        Set<String> statuses = new HashSet<>(Arrays.asList(PENDINGATLME, PENDINGFORASSIGNMENT));

        Set<String> idScope = (serviceRequestIds == null || serviceRequestIds.isEmpty())
                ? null
                : new HashSet<>(serviceRequestIds);

        int scanned = 0;
        int escalated = 0;
        int skipped = 0;
        Map<EscalationSkipReason, Integer> skipMap = new EnumMap<>(EscalationSkipReason.class);
        List<EscalationOutcome> details = new ArrayList<>();

        for (String status : statuses) {
            try {
                List<ServiceWrapper> complaints = searchComplaintsByStatus(tenantId, status);

                for (ServiceWrapper wrapper : complaints) {
                    Service complaint = wrapper.getService();
                    String srid = complaint.getServiceRequestId();

                    if (idScope != null && !idScope.contains(srid)) {
                        continue;
                    }

                    scanned++;

                    int currentLevel = getEscalationLevel(complaint);
                    if (currentLevel >= maxDepth) {
                        recordSkip(skipMap, details, srid, status, currentLevel,
                                EscalationSkipReason.MAX_DEPTH_REACHED,
                                "currentLevel=" + currentLevel + ", maxDepth=" + maxDepth);
                        skipped++;
                        continue;
                    }

                    // Resolve SLA via the new CRS.* model first (CategorySLA → StateSLA),
                    // then fall through to the v0 EscalationConfig defaults. The per-complaint
                    // OTEL span gets a `escalation.slaSource` attribute so operators can tell
                    // which layer answered the lookup.
                    SlaResolution slaRes = resolveSlaHours(
                            complaint, status, crsCategorySla, crsStateSlaDefaults, serviceCodeToCategory,
                            currentLevel, defaultSlaByLevel, overrides);
                    long sla = slaRes.slaMs;
                    span.setAttribute("escalation.slaSource", slaRes.source);
                    if (slaRes.unmappedCategory) {
                        // Log + count once per scan so the warning is actionable without
                        // skipping the complaint outright — fallback still produced a usable SLA.
                        log.warn("Escalation SLA UNMAPPED_CATEGORY — srid={} serviceCode={} (fell back to {})",
                                srid, complaint.getServiceCode(), slaRes.source);
                        skipMap.merge(EscalationSkipReason.UNMAPPED_CATEGORY, 1, Integer::sum);
                    }

                    long lastModified = 0L;
                    if (complaint.getAuditDetails() != null) {
                        Long modified = complaint.getAuditDetails().getLastModifiedTime();
                        if (modified != null && modified > 0) {
                            lastModified = modified;
                        } else if (complaint.getAuditDetails().getCreatedTime() != null) {
                            lastModified = complaint.getAuditDetails().getCreatedTime();
                        }
                    }

                    if (lastModified == 0L) {
                        recordSkip(skipMap, details, srid, status, currentLevel,
                                EscalationSkipReason.NO_LAST_MODIFIED_TIME, "auditDetails missing timestamps");
                        skipped++;
                        continue;
                    }

                    long elapsed = System.currentTimeMillis() - lastModified;
                    if (elapsed < sla) {
                        recordSkip(skipMap, details, srid, status, currentLevel,
                                EscalationSkipReason.SLA_NOT_BREACHED,
                                "elapsed=" + elapsed + "ms, sla=" + sla + "ms");
                        skipped++;
                        continue;
                    }

                    List<String> assignees = escalationService.getCurrentAssignees(
                            srid, complaint.getTenantId(), requestInfo);

                    if (CollectionUtils.isEmpty(assignees)) {
                        recordSkip(skipMap, details, srid, status, currentLevel,
                                EscalationSkipReason.NO_ASSIGNEES, "workflow returned 0 assignees");
                        skipped++;
                        continue;
                    }

                    Workflow currentWorkflow = Workflow.builder().assignes(assignees).build();

                    EscalationService.EscalationResult result =
                            escalationService.escalateComplaintWithReason(complaint, currentWorkflow, requestInfo);

                    if (result.isSuccess()) {
                        escalated++;
                        details.add(EscalationOutcome.builder()
                                .serviceRequestId(srid)
                                .action("ESCALATED")
                                .reason(EscalationSkipReason.SUCCESS.name())
                                .detail("fromLevel=" + currentLevel + " toLevel=" + (currentLevel + 1))
                                .build());
                        log.info("Escalation success — srid={}, status={}, fromLevel={}, toLevel={}",
                                srid, status, currentLevel, currentLevel + 1);
                    } else {
                        EscalationSkipReason reason = result.getReason() != null
                                ? result.getReason()
                                : EscalationSkipReason.WORKFLOW_TRANSITION_FAILED;
                        recordSkip(skipMap, details, srid, status, currentLevel, reason, result.getDetail());
                        skipped++;
                    }
                }
            } catch (Exception e) {
                log.error("Error scanning complaints in status {} for tenant {}", status, tenantId, e);
            }
        }

        span.setAttribute("escalation.scanned", scanned);
        span.setAttribute("escalation.escalated", escalated);
        span.setAttribute("escalation.skipped", skipped);
        // OTEL attribute names are dotted-snake-case by convention
        skipMap.forEach((reason, count) ->
                span.setAttribute("escalation.skipped." + reason.name().toLowerCase(), count));

        Map<String, Integer> skipBreakdown = new LinkedHashMap<>();
        skipMap.forEach((reason, count) -> skipBreakdown.put(reason.name(), count));

        log.info("Escalation scan complete: scanned={}, escalated={}, skipped={}, skipBreakdown={}",
                scanned, escalated, skipped, skipBreakdown);

        return EscalationTriggerResponse.builder()
                .tenantId(tenantId)
                .scanned(scanned)
                .escalated(escalated)
                .skipped(skipped)
                .skipBreakdown(skipBreakdown)
                .details(details)
                .build();
    }

    private void recordSkip(Map<EscalationSkipReason, Integer> skipMap,
                            List<EscalationOutcome> details,
                            String srid, String status, int currentLevel,
                            EscalationSkipReason reason, String detail) {
        log.info("Escalation skip — srid={}, status={}, level={}, reason={}, detail={}",
                srid, status, currentLevel, reason, detail);
        skipMap.merge(reason, 1, Integer::sum);
        details.add(EscalationOutcome.builder()
                .serviceRequestId(srid)
                .action("SKIPPED")
                .reason(reason.name())
                .detail(detail)
                .build());
    }

    /**
     * Searches complaints by application status using the PGR repository.
     */
    private List<ServiceWrapper> searchComplaintsByStatus(String tenantId, String status) {
        RequestSearchCriteria criteria = RequestSearchCriteria.builder()
                .tenantId(tenantId)
                .applicationStatus(Collections.singleton(status))
                .limit(config.getEscalationBatchSize())
                .offset(0)
                .isPlainSearch(true)
                .build();

        return repository.getServiceWrappers(criteria);
    }

    /**
     * Builds a system RequestInfo for internal service-to-service calls.
     */
    private RequestInfo buildSystemRequestInfo() {
        // The workflow validator looks up roles by tenantId (action's tenant + its
        // state-level parent). A tenant-less Role never matches. Tag the SYSTEM
        // role with the state-level tenant (e.g. "ke") so the validator's
        // parent-tenant fallback (line 113-117 of WorkflowValidator.java) finds it
        // for all city tenants like "ke.nairobi", "ke.bomet", etc.
        User systemUser = User.builder()
                .uuid(config.getEgovInternalMicroserviceUserUuid())
                .type("SYSTEM")
                .roles(Collections.singletonList(
                        Role.builder().code("SYSTEM").name("System").tenantId(stateLevelTenantId).build()
                ))
                .build();

        return RequestInfo.builder()
                .apiId("Rainmaker")
                .ver(".01")
                .ts(null)
                .action("")
                .did("1")
                .key("")
                .msgId("20170310130900|en_IN")
                .authToken("")
                .userInfo(systemUser)
                .build();
    }

    /**
     * Fetches EscalationConfig from MDMS. Returns null if not found.
     */
    @SuppressWarnings("unchecked")
    private Map<String, Object> fetchEscalationConfig(RequestInfo requestInfo, String tenantId) {
        try {
            if (tenantId == null) return null;

            List<MasterDetail> masterDetails = Collections.singletonList(
                    MasterDetail.builder().name(MDMS_ESCALATION_CONFIG).build()
            );

            ModuleDetail moduleDetail = ModuleDetail.builder()
                    .masterDetails(masterDetails)
                    .moduleName(MDMS_MODULE_NAME)
                    .build();

            MdmsCriteria mdmsCriteria = MdmsCriteria.builder()
                    .moduleDetails(Collections.singletonList(moduleDetail))
                    .tenantId(multiStateInstanceUtil.getStateLevelTenant(tenantId))
                    .build();

            MdmsCriteriaReq mdmsCriteriaReq = MdmsCriteriaReq.builder()
                    .mdmsCriteria(mdmsCriteria)
                    .requestInfo(requestInfo)
                    .build();

            Object result = serviceRequestRepository.fetchResult(mdmsUtils.getMdmsSearchUrl(), mdmsCriteriaReq);

            List<Map<String, Object>> configs = JsonPath.read(result, MDMS_ESCALATION_CONFIG_JSONPATH);
            if (configs != null && !configs.isEmpty()) {
                return configs.get(0);
            }
        } catch (Exception e) {
            log.warn("Failed to fetch EscalationConfig from MDMS, using defaults", e);
        }
        return null;
    }

    /**
     * Gets the state-level tenant ID from the configuration.
     */
    private String getStateLevelTenantId() {
        // Use the user host map keys as a hint for available tenants,
        // or fall back to deriving from config
        Map<String, String> hostMap = config.getUiAppHostMap();
        if (hostMap != null && !hostMap.isEmpty()) {
            return hostMap.keySet().iterator().next();
        }
        return stateLevelTenantId;
    }

    private int getMaxDepth(Map<String, Object> escalationConfig) {
        if (escalationConfig != null && escalationConfig.containsKey("maxDepth")) {
            return ((Number) escalationConfig.get("maxDepth")).intValue();
        }
        return config.getEscalationMaxDepth();
    }

    @SuppressWarnings("unchecked")
    private List<Long> getDefaultSlaByLevel(Map<String, Object> escalationConfig) {
        if (escalationConfig != null && escalationConfig.containsKey("defaultSlaByLevel")) {
            List<Number> slaList = (List<Number>) escalationConfig.get("defaultSlaByLevel");
            return slaList.stream().map(Number::longValue).collect(Collectors.toList());
        }
        // Fallback: use the single default SLA for all levels
        return Collections.singletonList(config.getEscalationDefaultSlaMs());
    }

    @SuppressWarnings("unchecked")
    private Map<String, List<Long>> getOverrides(Map<String, Object> escalationConfig) {
        if (escalationConfig != null && escalationConfig.containsKey("overrides")) {
            Map<String, List<Number>> raw = (Map<String, List<Number>>) escalationConfig.get("overrides");
            Map<String, List<Long>> result = new HashMap<>();
            for (Map.Entry<String, List<Number>> entry : raw.entrySet()) {
                result.put(entry.getKey(),
                        entry.getValue().stream().map(Number::longValue).collect(Collectors.toList()));
            }
            return result;
        }
        return Collections.emptyMap();
    }

    /**
     * Resolves the SLA for a specific complaint type and escalation level.
     * Priority: overrides[serviceCode][level] > defaultSlaByLevel[level] > last value in array
     */
    private long resolveSla(String serviceCode, int level, List<Long> defaultSlaByLevel, Map<String, List<Long>> overrides) {
        // Check overrides first
        if (overrides.containsKey(serviceCode)) {
            List<Long> slaList = overrides.get(serviceCode);
            if (level < slaList.size()) {
                return slaList.get(level);
            }
            // Use last value if level exceeds array
            return slaList.get(slaList.size() - 1);
        }

        // Use default SLA by level
        if (level < defaultSlaByLevel.size()) {
            return defaultSlaByLevel.get(level);
        }

        // Use last value in default array
        return defaultSlaByLevel.get(defaultSlaByLevel.size() - 1);
    }

    @SuppressWarnings("unchecked")
    private int getEscalationLevel(Service complaint) {
        Object additionalDetail = complaint.getAdditionalDetail();
        if (additionalDetail == null) return 0;

        try {
            Map<String, Object> details;
            if (additionalDetail instanceof Map) {
                details = (Map<String, Object>) additionalDetail;
            } else {
                details = mapper.convertValue(additionalDetail, Map.class);
            }

            Object level = details.get("escalationLevel");
            if (level instanceof Number) {
                return ((Number) level).intValue();
            }
        } catch (Exception e) {
            // ignore
        }
        return 0;
    }

    // ----------------------------------------------------------------------
    // CRS escalation-SLA model (BRD v4.0)
    //
    // The new SLA pipeline reads two MDMS v2 schemas:
    //   1. CRS.CategorySLA — per (path, category, subcategoryL1) row whose
    //      `slaHoursByState` cell for the complaint's current workflow state
    //      is either null (fall through), a number (hours), or a [min,max]
    //      range (collapses to MAX for scheduler math; UI shows the range).
    //   2. CRS.StateSLA — singleton (`uniqueIdentifier=default`) holding the
    //      6 per-state defaults from BRD §5.2.
    //
    // The v0 RAINMAKER-PGR.EscalationConfig path stays as a safety-net
    // fallback so a tenant that hasn't migrated yet doesn't lose escalation
    // overnight. The selected layer is surfaced as the OTEL span attribute
    // `escalation.slaSource`.
    // ----------------------------------------------------------------------

    /** Result of an SLA resolution — keeps the source (for OTEL) + the value (ms). */
    static final class SlaResolution {
        final long slaMs;
        final String source;
        final boolean unmappedCategory;
        SlaResolution(long slaMs, String source, boolean unmappedCategory) {
            this.slaMs = slaMs;
            this.source = source;
            this.unmappedCategory = unmappedCategory;
        }
    }

    /**
     * Resolve the SLA (in MS) for the given complaint + workflow state.
     * Visible for testing.
     */
    @SuppressWarnings("unchecked")
    SlaResolution resolveSlaHours(Service complaint,
                                   String workflowState,
                                   List<Map<String, Object>> crsCategorySla,
                                   Map<String, Number> crsStateSlaDefaults,
                                   Map<String, Map<String, Object>> serviceCodeToCategory,
                                   int currentLevel,
                                   List<Long> defaultSlaByLevel,
                                   Map<String, List<Long>> overrides) {

        Map<String, Object> categoryTuple = extractCategoryTuple(complaint, serviceCodeToCategory);
        String stateKey = mapWorkflowStateToKey(workflowState);
        boolean unmapped = false;

        // 1) CategorySLA hit
        if (categoryTuple != null && stateKey != null && crsCategorySla != null) {
            for (Map<String, Object> row : crsCategorySla) {
                Object active = row.get("isActive");
                if (active instanceof Boolean && !(Boolean) active) continue;
                if (!Objects.equals(row.get("path"), categoryTuple.get("path"))) continue;
                if (!Objects.equals(row.get("category"), categoryTuple.get("category"))) continue;
                if (!Objects.equals(row.get("subcategoryL1"), categoryTuple.get("subcategoryL1"))) continue;
                Object by = row.get("slaHoursByState");
                if (!(by instanceof Map)) continue;
                Object cell = ((Map<String, Object>) by).get(stateKey);
                Long cellMs = cellToMillis(cell);
                if (cellMs != null) {
                    return new SlaResolution(cellMs, PGRConstants.SLA_SOURCE_CATEGORY, false);
                }
                break; // matched row, but cell is null/missing → fall through
            }
        } else if (categoryTuple == null) {
            unmapped = true;
        }

        // 2) StateSLA fallback
        if (stateKey != null && crsStateSlaDefaults != null) {
            Number defHrs = crsStateSlaDefaults.get(stateKey);
            if (defHrs != null) {
                return new SlaResolution(hoursToMillis(defHrs.doubleValue()), PGRConstants.SLA_SOURCE_STATE, unmapped);
            }
        }

        // 3) v0 EscalationConfig fallback (existing behaviour).
        log.info("Escalation SLA falling back to v0 EscalationConfig for srid={} stateKey={}",
                complaint.getServiceRequestId(), stateKey);
        long v0 = resolveSla(complaint.getServiceCode(), currentLevel, defaultSlaByLevel, overrides);
        return new SlaResolution(v0, PGRConstants.SLA_SOURCE_V0, unmapped);
    }

    private static Long cellToMillis(Object cell) {
        if (cell == null) return null;
        if (cell instanceof Number) {
            double h = ((Number) cell).doubleValue();
            return h > 0 ? hoursToMillis(h) : null;
        }
        if (cell instanceof List) {
            List<?> r = (List<?>) cell;
            if (r.size() == 2 && r.get(0) instanceof Number && r.get(1) instanceof Number) {
                // scheduler uses MAX for breach detection — UI surfaces the range.
                double hi = Math.max(((Number) r.get(0)).doubleValue(), ((Number) r.get(1)).doubleValue());
                return hi > 0 ? hoursToMillis(hi) : null;
            }
        }
        return null;
    }

    private static long hoursToMillis(double h) {
        return (long) (h * 60L * 60L * 1000L);
    }

    /**
     * Map a DIGIT PGR workflow state name to the schema key. Conservative;
     * only states the BRD §5.2 table names are mapped. Anything else returns
     * null and the caller falls through to v0.
     */
    private static String mapWorkflowStateToKey(String workflowState) {
        if (workflowState == null) return null;
        switch (workflowState) {
            case "PENDINGFORASSIGNMENT": return "new";
            case "PENDINGATLME":         return "forwarded";
            case "IN_TRIAGE":
            case "TRIAGE":               return "triage";
            case "FORWARDED":            return "forwarded";
            case "UNDER_INVESTIGATION":
            case "INVESTIGATION":        return "investigation";
            case "AWAITING_INFORMATION":
            case "AWAITING":             return "awaiting";
            case "RESOLVED":             return "resolved";
            default: return null;
        }
    }

    /**
     * Pull (path, category, subcategoryL1) from the complaint. Tries the
     * additionalDetail blob first (the UI tags new complaints there), then
     * falls back to a serviceCode → tuple lookup we precomputed off
     * RAINMAKER-PGR.ServiceDefs. Returns null if neither path resolves.
     */
    @SuppressWarnings("unchecked")
    private Map<String, Object> extractCategoryTuple(Service complaint,
                                                     Map<String, Map<String, Object>> serviceCodeToCategory) {
        Object detail = complaint.getAdditionalDetail();
        if (detail != null) {
            try {
                Map<String, Object> details = detail instanceof Map
                        ? (Map<String, Object>) detail
                        : mapper.convertValue(detail, Map.class);
                String path = (String) details.get("path");
                String category = (String) details.get("category");
                String subcategoryL1 = (String) details.get("subcategoryL1");
                if (path != null && category != null && subcategoryL1 != null) {
                    Map<String, Object> out = new HashMap<>();
                    out.put("path", path);
                    out.put("category", category);
                    out.put("subcategoryL1", subcategoryL1);
                    return out;
                }
            } catch (Exception ignored) { /* fall through */ }
        }
        String code = complaint.getServiceCode();
        if (code != null && serviceCodeToCategory != null) {
            return serviceCodeToCategory.get(code);
        }
        return null;
    }

    /**
     * Fetch all CRS.CategorySLA rows for the tenant. Uses MDMS v1 search
     * with module-name {@code CRS}, which works against the same egov-mdms
     * v1 endpoint that already serves RAINMAKER-PGR.* — no v2 client is
     * needed because we're treating CRS rows as plain master records.
     */
    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> fetchCrsCategorySla(RequestInfo requestInfo, String tenantId) {
        try {
            Object res = fetchMdmsModule(requestInfo, tenantId, "CRS", "CategorySLA");
            if (res == null) return Collections.emptyList();
            Object rows = JsonPath.read(res, "$.MdmsRes.CRS.CategorySLA");
            if (rows instanceof List) return (List<Map<String, Object>>) rows;
        } catch (Exception e) {
            log.debug("CRS.CategorySLA fetch failed (probably not seeded yet): {}", e.getMessage());
        }
        return Collections.emptyList();
    }

    /** Fetch CRS.StateSLA singleton's stateDefaults map. */
    @SuppressWarnings("unchecked")
    private Map<String, Number> fetchCrsStateSlaDefaults(RequestInfo requestInfo, String tenantId) {
        try {
            Object res = fetchMdmsModule(requestInfo, tenantId, "CRS", "StateSLA");
            if (res == null) return Collections.emptyMap();
            List<Map<String, Object>> rows = JsonPath.read(res, "$.MdmsRes.CRS.StateSLA");
            if (rows == null || rows.isEmpty()) return Collections.emptyMap();
            Object defaults = rows.get(0).get("stateDefaults");
            if (defaults instanceof Map) return (Map<String, Number>) defaults;
        } catch (Exception e) {
            log.debug("CRS.StateSLA fetch failed (probably not seeded yet): {}", e.getMessage());
        }
        return Collections.emptyMap();
    }

    /**
     * Build serviceCode → (path, category, subcategoryL1) mapping. We pull
     * RAINMAKER-PGR.ServiceDefs and read three optional fields the
     * configurator's complaint-type editor sets when present. ServiceDefs
     * without those fields silently aren't mapped (the resolver then reads
     * additionalDetail or falls through to StateSLA).
     */
    @SuppressWarnings("unchecked")
    private Map<String, Map<String, Object>> buildServiceCodeMapping(RequestInfo requestInfo, String tenantId) {
        try {
            Object res = fetchMdmsModule(requestInfo, tenantId, MDMS_MODULE_NAME, "ServiceDefs");
            if (res == null) return Collections.emptyMap();
            List<Map<String, Object>> defs = JsonPath.read(res, "$.MdmsRes.RAINMAKER-PGR.ServiceDefs");
            if (defs == null) return Collections.emptyMap();
            Map<String, Map<String, Object>> out = new HashMap<>();
            for (Map<String, Object> d : defs) {
                String code = (String) d.get("serviceCode");
                String path = (String) d.get("path");
                String category = (String) d.get("category");
                String subcategoryL1 = (String) d.get("subcategoryL1");
                if (code != null && path != null && category != null && subcategoryL1 != null) {
                    Map<String, Object> v = new HashMap<>();
                    v.put("path", path);
                    v.put("category", category);
                    v.put("subcategoryL1", subcategoryL1);
                    out.put(code, v);
                }
            }
            return out;
        } catch (Exception e) {
            log.debug("ServiceDefs mapping build failed: {}", e.getMessage());
            return Collections.emptyMap();
        }
    }

    /** Shared MDMS v1 fetch — same shape as fetchEscalationConfig, generalised. */
    private Object fetchMdmsModule(RequestInfo requestInfo, String tenantId, String moduleName, String masterName) {
        if (tenantId == null) return null;
        try {
            List<MasterDetail> masters = Collections.singletonList(
                    MasterDetail.builder().name(masterName).build()
            );
            ModuleDetail module = ModuleDetail.builder()
                    .masterDetails(masters)
                    .moduleName(moduleName)
                    .build();
            MdmsCriteria criteria = MdmsCriteria.builder()
                    .moduleDetails(Collections.singletonList(module))
                    .tenantId(multiStateInstanceUtil.getStateLevelTenant(tenantId))
                    .build();
            MdmsCriteriaReq req = MdmsCriteriaReq.builder()
                    .mdmsCriteria(criteria)
                    .requestInfo(requestInfo)
                    .build();
            return serviceRequestRepository.fetchResult(mdmsUtils.getMdmsSearchUrl(), req);
        } catch (Exception e) {
            log.debug("MDMS fetch failed for {}/{}: {}", moduleName, masterName, e.getMessage());
            return null;
        }
    }
}
