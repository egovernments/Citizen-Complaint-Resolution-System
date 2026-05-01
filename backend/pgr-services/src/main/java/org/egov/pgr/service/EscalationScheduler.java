package org.egov.pgr.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.jayway.jsonpath.JsonPath;
import lombok.extern.slf4j.Slf4j;
import org.egov.common.contract.request.RequestInfo;
import org.egov.common.contract.request.Role;
import org.egov.common.contract.request.User;
import org.egov.common.utils.MultiStateInstanceUtil;
import org.egov.mdms.model.*;
import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.repository.PGRRepository;
import org.egov.pgr.repository.ServiceRequestRepository;
import org.egov.pgr.util.MDMSUtils;
import org.egov.pgr.web.models.*;
import org.springframework.beans.factory.annotation.Autowired;
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

    @Scheduled(fixedDelayString = "${pgr.escalation.interval.ms}")
    public void scanAndEscalate() {
        if (!Boolean.TRUE.equals(config.getEscalationEnabled())) {
            return;
        }

        log.info("Escalation scan started");

        RequestInfo systemRequestInfo = buildSystemRequestInfo();

        // Fetch escalation config from MDMS (will use default SLA if MDMS config not found)
        Map<String, Object> escalationConfig = fetchEscalationConfig(systemRequestInfo);

        int maxDepth = getMaxDepth(escalationConfig);
        List<Long> defaultSlaByLevel = getDefaultSlaByLevel(escalationConfig);
        Map<String, List<Long>> overrides = getOverrides(escalationConfig);

        // Search for complaints in PENDINGATLME and PENDINGFORASSIGNMENT
        Set<String> statuses = new HashSet<>(Arrays.asList(PENDINGATLME, PENDINGFORASSIGNMENT));

        // Get all tenants — for now, use the state-level tenant from config
        // In a multi-tenant setup, this would iterate over all tenants
        String stateLevelTenantId = getStateLevelTenantId();
        if (stateLevelTenantId == null) {
            log.warn("Cannot determine state-level tenant ID, skipping escalation scan");
            return;
        }

        int scanned = 0;
        int escalated = 0;
        int skipped = 0;

        for (String status : statuses) {
            try {
                List<ServiceWrapper> complaints = searchComplaintsByStatus(stateLevelTenantId, status);

                for (ServiceWrapper wrapper : complaints) {
                    scanned++;
                    Service complaint = wrapper.getService();

                    // Determine SLA for this complaint's serviceCode + escalation level
                    int currentLevel = getEscalationLevel(complaint);
                    if (currentLevel >= maxDepth) {
                        skipped++;
                        continue;
                    }

                    long sla = resolveSla(complaint.getServiceCode(), currentLevel, defaultSlaByLevel, overrides);

                    // Check if SLA is breached based on lastModifiedTime
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
                        skipped++;
                        continue;
                    }

                    long elapsed = System.currentTimeMillis() - lastModified;
                    if (elapsed < sla) {
                        // SLA not yet breached
                        continue;
                    }

                    // SLA breached — get current assignees from workflow
                    List<String> assignees = escalationService.getCurrentAssignees(
                            complaint.getServiceRequestId(), complaint.getTenantId(), systemRequestInfo);

                    if (CollectionUtils.isEmpty(assignees)) {
                        skipped++;
                        continue;
                    }

                    Workflow currentWorkflow = Workflow.builder().assignes(assignees).build();

                    boolean success = escalationService.escalateComplaint(complaint, currentWorkflow, systemRequestInfo);
                    if (success) {
                        escalated++;
                    } else {
                        skipped++;
                    }
                }
            } catch (Exception e) {
                log.error("Error scanning complaints in status {} for tenant {}", status, stateLevelTenantId, e);
            }
        }

        log.info("Escalation scan complete: scanned={}, escalated={}, skipped={}", scanned, escalated, skipped);
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
        User systemUser = User.builder()
                .uuid(config.getEgovInternalMicroserviceUserUuid())
                .type("SYSTEM")
                .roles(Collections.singletonList(
                        Role.builder().code("SYSTEM").name("System").build()
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
    private Map<String, Object> fetchEscalationConfig(RequestInfo requestInfo) {
        try {
            String tenantId = getStateLevelTenantId();
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
        return null;
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
