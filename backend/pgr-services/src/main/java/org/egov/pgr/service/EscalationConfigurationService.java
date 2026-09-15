package org.egov.pgr.service;

import com.jayway.jsonpath.JsonPath;
import lombok.Getter;
import lombok.extern.slf4j.Slf4j;
import org.egov.common.contract.request.RequestInfo;
import org.egov.common.utils.MultiStateInstanceUtil;
import org.egov.mdms.model.MasterDetail;
import org.egov.mdms.model.MdmsCriteria;
import org.egov.mdms.model.MdmsCriteriaReq;
import org.egov.mdms.model.ModuleDetail;
import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.repository.ServiceRequestRepository;
import org.egov.pgr.util.MDMSUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import static org.egov.pgr.util.PGRConstants.MDMS_ESCALATION_CONFIG;
import static org.egov.pgr.util.PGRConstants.MDMS_ESCALATION_CONFIG_JSONPATH;
import static org.egov.pgr.util.PGRConstants.MDMS_MODULE_NAME;

/**
 * Reads and resolves the single RAINMAKER-PGR.EscalationConfig contract used by
 * both manual and automatic escalation.
 */
@Component
@Slf4j
public class EscalationConfigurationService {

    private static final String TENANT_MODULE = "tenant";
    private static final String TENANTS_MASTER = "tenants";

    private final PGRConfiguration config;
    private final ServiceRequestRepository serviceRequestRepository;
    private final MDMSUtils mdmsUtils;
    private final MultiStateInstanceUtil multiStateInstanceUtil;

    @Autowired
    public EscalationConfigurationService(PGRConfiguration config,
                                          ServiceRequestRepository serviceRequestRepository,
                                          MDMSUtils mdmsUtils,
                                          MultiStateInstanceUtil multiStateInstanceUtil) {
        this.config = config;
        this.serviceRequestRepository = serviceRequestRepository;
        this.mdmsUtils = mdmsUtils;
        this.multiStateInstanceUtil = multiStateInstanceUtil;
    }

    public ResolvedEscalationConfig resolve(RequestInfo requestInfo, String tenantId) {
        Map<String, Object> mdmsConfig = fetch(requestInfo, tenantId);
        int maxDepth = positiveInt(mdmsConfig == null ? null : mdmsConfig.get("maxDepth"),
                config.getEscalationMaxDepth());
        List<Long> defaultPercentages = percentageList(
                mdmsConfig == null ? null : mdmsConfig.get("defaultSlaPercentageByLevel"));
        List<Long> defaultSlas = numberList(mdmsConfig == null ? null : mdmsConfig.get("defaultSlaByLevel"));
        if (defaultSlas.isEmpty()) {
            defaultSlas = Collections.singletonList(config.getEscalationDefaultSlaMs());
        }
        List<Boolean> enabledByLevel = booleanList(mdmsConfig == null ? null : mdmsConfig.get("enabledByLevel"));
        List<String> eligibleStatuses = stringList(mdmsConfig == null ? null : mdmsConfig.get("eligibleStatuses"));
        if (eligibleStatuses.isEmpty()) {
            eligibleStatuses = stringList(config.getEscalationEligibleStatuses());
        }
        Map<String, Object> overrides = map(mdmsConfig == null ? null : mdmsConfig.get("overrides"));
        Map<String, Long> complaintSlas = mdmsUtils.getServiceCodeToSlaMillis(tenantId);
        return new ResolvedEscalationConfig(maxDepth, defaultPercentages, defaultSlas,
                enabledByLevel, eligibleStatuses, overrides, complaintSlas);
    }

    /** Returns the state root and every registered city below it. */
    public List<String> resolveStateTenants(RequestInfo requestInfo, String tenantId) {
        if (tenantId == null || tenantId.isBlank()) {
            return Collections.emptyList();
        }
        String stateTenant = multiStateInstanceUtil.getStateLevelTenant(tenantId.trim());
        LinkedHashSet<String> discoveredTenants = new LinkedHashSet<>();

        try {
            MasterDetail master = MasterDetail.builder().name(TENANTS_MASTER).build();
            ModuleDetail module = ModuleDetail.builder()
                    .moduleName(TENANT_MODULE)
                    .masterDetails(Collections.singletonList(master))
                    .build();
            MdmsCriteria criteria = MdmsCriteria.builder()
                    .tenantId(stateTenant)
                    .moduleDetails(Collections.singletonList(module))
                    .build();
            MdmsCriteriaReq request = MdmsCriteriaReq.builder()
                    .requestInfo(requestInfo)
                    .mdmsCriteria(criteria)
                    .build();

            Object response = serviceRequestRepository.fetchResult(mdmsUtils.getMdmsSearchUrl(), request);
            List<Map<String, Object>> tenants = JsonPath.read(
                    response, "$.MdmsRes." + TENANT_MODULE + "." + TENANTS_MASTER);
            if (tenants != null) {
                for (Map<String, Object> tenant : tenants) {
                    if (Boolean.FALSE.equals(tenant.get("active"))) {
                        continue;
                    }
                    String configuredTenant = text(tenant.get("code"));
                    if (belongsToState(configuredTenant, stateTenant)) {
                        discoveredTenants.add(configuredTenant);
                    }
                }
            }
        } catch (Exception e) {
            log.warn("Failed to discover city tenants below {}; caller must use a state-wide fallback scan",
                    stateTenant, e);
            return Collections.emptyList();
        }
        if (discoveredTenants.isEmpty()) {
            log.warn("No active tenants discovered below {}; caller must use a state-wide fallback scan",
                    stateTenant);
            return Collections.emptyList();
        }
        LinkedHashSet<String> tenantIds = new LinkedHashSet<>();
        tenantIds.add(stateTenant);
        tenantIds.addAll(discoveredTenants);
        return new ArrayList<>(tenantIds);
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> fetch(RequestInfo requestInfo, String tenantId) {
        if (tenantId == null || tenantId.isBlank()) {
            return null;
        }
        String requestedTenant = tenantId.trim();
        String stateTenant = multiStateInstanceUtil.getStateLevelTenant(requestedTenant);
        Map<String, Object> cityConfig = fetchAtTenant(requestInfo, requestedTenant);
        if (cityConfig != null || requestedTenant.equals(stateTenant)) {
            return cityConfig;
        }
        log.debug("{} not found for city {}; falling back to state tenant {}",
                MDMS_MODULE_NAME + "." + MDMS_ESCALATION_CONFIG, requestedTenant, stateTenant);
        return fetchAtTenant(requestInfo, stateTenant);
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> fetchAtTenant(RequestInfo requestInfo, String tenantId) {
        try {
            MasterDetail master = MasterDetail.builder().name(MDMS_ESCALATION_CONFIG).build();
            ModuleDetail module = ModuleDetail.builder()
                    .moduleName(MDMS_MODULE_NAME)
                    .masterDetails(Collections.singletonList(master))
                    .build();
            MdmsCriteria criteria = MdmsCriteria.builder()
                    .tenantId(tenantId)
                    .moduleDetails(Collections.singletonList(module))
                    .build();
            MdmsCriteriaReq request = MdmsCriteriaReq.builder()
                    .requestInfo(requestInfo)
                    .mdmsCriteria(criteria)
                    .build();

            Object response = serviceRequestRepository.fetchResult(mdmsUtils.getMdmsSearchUrl(), request);
            List<Map<String, Object>> records = JsonPath.read(response, MDMS_ESCALATION_CONFIG_JSONPATH);
            if (records == null || records.isEmpty()) {
                return null;
            }
            List<Map<String, Object>> defaults = records.stream()
                    .filter(record -> "DEFAULT".equalsIgnoreCase(text(record.get("code"))))
                    .toList();
            if (records.size() == 1) {
                if (defaults.size() == 1) {
                    return defaults.get(0);
                }
                if (text(records.get(0).get("code")) == null) {
                    log.warn("Using legacy {} record without code=DEFAULT for tenant {}",
                            MDMS_MODULE_NAME + "." + MDMS_ESCALATION_CONFIG, tenantId);
                    return records.get(0);
                }
            }
            log.error("Expected exactly one {} record for tenant {}; found {} records and {} defaults",
                    MDMS_MODULE_NAME + "." + MDMS_ESCALATION_CONFIG, tenantId,
                    records.size(), defaults.size());
            return null;
        } catch (Exception e) {
            log.warn("Failed to fetch {} for tenant {}",
                    MDMS_MODULE_NAME + "." + MDMS_ESCALATION_CONFIG, tenantId, e);
            return null;
        }
    }

    private static boolean belongsToState(String tenantId, String stateTenant) {
        return tenantId != null && (tenantId.equals(stateTenant) || tenantId.startsWith(stateTenant + "."));
    }

    private static String text(Object value) {
        return value instanceof String text && !text.isBlank() ? text.trim() : null;
    }

    private static int positiveInt(Object value, Integer fallback) {
        if (value instanceof Number number && number.intValue() >= 0) {
            return number.intValue();
        }
        return fallback == null ? 0 : fallback;
    }

    private static List<Long> numberList(Object value) {
        if (!(value instanceof List<?> values)) {
            return Collections.emptyList();
        }
        List<Long> result = new ArrayList<>();
        for (Object item : values) {
            if (item instanceof Number number && number.longValue() >= 0) {
                result.add(number.longValue());
            }
        }
        return result;
    }

    private static List<Long> percentageList(Object value) {
        if (!(value instanceof List<?> values)) {
            return Collections.emptyList();
        }
        List<Long> percentages = new ArrayList<>();
        long previous = 0;
        for (Object item : values) {
            if (!(item instanceof Number number)) {
                return Collections.emptyList();
            }
            long percentage = number.longValue();
            if (number.doubleValue() != percentage || percentage <= previous || percentage > 200) {
                return Collections.emptyList();
            }
            percentages.add(percentage);
            previous = percentage;
        }
        return percentages;
    }

    private static List<Boolean> booleanList(Object value) {
        if (!(value instanceof List<?> values)) {
            return Collections.emptyList();
        }
        List<Boolean> result = new ArrayList<>();
        for (Object item : values) {
            if (item instanceof Boolean enabled) {
                result.add(enabled);
            }
        }
        return result;
    }

    private static List<String> stringList(Object value) {
        if (!(value instanceof List<?> values)) {
            return Collections.emptyList();
        }
        LinkedHashSet<String> result = new LinkedHashSet<>();
        for (Object item : values) {
            if (item instanceof String text && !text.isBlank()) {
                result.add(text.trim().toUpperCase(Locale.ROOT));
            }
        }
        return new ArrayList<>(result);
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> map(Object value) {
        return value instanceof Map<?, ?> ? (Map<String, Object>) value : Collections.emptyMap();
    }

    @Getter
    public static final class ResolvedEscalationConfig {
        private final int maxDepth;
        private final List<Long> defaultPercentages;
        private final List<Long> defaultSlas;
        private final List<Boolean> enabledByLevel;
        private final List<String> eligibleStatuses;
        private final Map<String, Object> overrides;
        private final Map<String, Long> complaintSlas;

        ResolvedEscalationConfig(int maxDepth, List<Long> defaultPercentages, List<Long> defaultSlas,
                                 List<Boolean> enabledByLevel, List<String> eligibleStatuses,
                                 Map<String, Object> overrides, Map<String, Long> complaintSlas) {
            this.maxDepth = maxDepth;
            this.defaultPercentages = List.copyOf(defaultPercentages);
            this.defaultSlas = List.copyOf(defaultSlas);
            this.enabledByLevel = List.copyOf(enabledByLevel);
            this.eligibleStatuses = List.copyOf(eligibleStatuses);
            this.overrides = Map.copyOf(overrides);
            this.complaintSlas = Map.copyOf(complaintSlas);
        }

        public boolean isEnabled(String serviceCode, int level) {
            OverrideConfig override = override(serviceCode);
            List<Boolean> enabled = override.enabled.isEmpty() ? enabledByLevel : override.enabled;
            return enabled.isEmpty() || valueAt(enabled, level);
        }

        public long resolveSla(String serviceCode, int level) {
            OverrideConfig override = override(serviceCode);
            boolean overridesTiming = !override.percentages.isEmpty() || !override.slas.isEmpty();
            List<Long> percentages = overridesTiming ? override.percentages : defaultPercentages;
            Long complaintSla = complaintSlas.get(serviceCode);
            if (complaintSla != null && complaintSla > 0 && !percentages.isEmpty()) {
                return percentageOf(complaintSla, valueAt(percentages, level));
            }
            List<Long> slas = overridesTiming && !override.slas.isEmpty() ? override.slas : defaultSlas;
            return valueAt(slas, level);
        }

        /** Percentage ladders are finite: their last entry is the final escalation. */
        public int effectiveMaxDepth(String serviceCode) {
            OverrideConfig override = override(serviceCode);
            boolean overridesTiming = !override.percentages.isEmpty() || !override.slas.isEmpty();
            List<Long> percentages = overridesTiming ? override.percentages : defaultPercentages;
            Long complaintSla = complaintSlas.get(serviceCode);
            if (complaintSla != null && complaintSla > 0 && !percentages.isEmpty()) {
                return Math.min(maxDepth, percentages.size());
            }
            List<Long> slas = overridesTiming && !override.slas.isEmpty() ? override.slas : defaultSlas;
            return Math.min(maxDepth, slas.size());
        }

        private OverrideConfig override(String serviceCode) {
            Object raw = overrides.get(serviceCode);
            if (raw instanceof List<?>) {
                return new OverrideConfig(Collections.emptyList(), numberList(raw), Collections.emptyList());
            }
            Map<String, Object> structured = map(raw);
            return new OverrideConfig(percentageList(structured.get("slaPercentageByLevel")),
                    numberList(structured.get("slaByLevel")),
                    booleanList(structured.get("enabledByLevel")));
        }

        private static long percentageOf(long value, long percentage) {
            long whole = value / 100;
            long remainder = value % 100;
            try {
                return Math.addExact(Math.multiplyExact(whole, percentage),
                        (remainder * percentage + 99) / 100);
            } catch (ArithmeticException ignored) {
                return Long.MAX_VALUE;
            }
        }

        private static <T> T valueAt(List<T> values, int level) {
            int safeLevel = Math.max(level, 0);
            return values.get(Math.min(safeLevel, values.size() - 1));
        }

        private record OverrideConfig(List<Long> percentages, List<Long> slas, List<Boolean> enabled) {
        }
    }
}
