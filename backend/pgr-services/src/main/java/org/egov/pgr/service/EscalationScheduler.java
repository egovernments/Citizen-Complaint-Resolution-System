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

                    long sla = resolveSla(complaint.getServiceCode(), currentLevel, defaultSlaByLevel, overrides);

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
}
