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
import java.util.List;
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
        List<Long> defaultSlas = numberList(mdmsConfig == null ? null : mdmsConfig.get("defaultSlaByLevel"));
        if (defaultSlas.isEmpty()) {
            defaultSlas = Collections.singletonList(config.getEscalationDefaultSlaMs());
        }
        List<Boolean> enabledByLevel = booleanList(mdmsConfig == null ? null : mdmsConfig.get("enabledByLevel"));
        Map<String, Object> overrides = map(mdmsConfig == null ? null : mdmsConfig.get("overrides"));
        return new ResolvedEscalationConfig(maxDepth, defaultSlas, enabledByLevel, overrides);
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> fetch(RequestInfo requestInfo, String tenantId) {
        try {
            if (tenantId == null || tenantId.isBlank()) {
                return null;
            }
            String stateTenant = multiStateInstanceUtil.getStateLevelTenant(tenantId);
            MasterDetail master = MasterDetail.builder().name(MDMS_ESCALATION_CONFIG).build();
            ModuleDetail module = ModuleDetail.builder()
                    .moduleName(MDMS_MODULE_NAME)
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
            List<Map<String, Object>> records = JsonPath.read(response, MDMS_ESCALATION_CONFIG_JSONPATH);
            return records == null || records.isEmpty() ? null : records.get(0);
        } catch (Exception e) {
            log.warn("Failed to fetch {} for tenant {}; using service defaults",
                    MDMS_MODULE_NAME + "." + MDMS_ESCALATION_CONFIG, tenantId, e);
            return null;
        }
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

    @SuppressWarnings("unchecked")
    private static Map<String, Object> map(Object value) {
        return value instanceof Map<?, ?> ? (Map<String, Object>) value : Collections.emptyMap();
    }

    @Getter
    public static final class ResolvedEscalationConfig {
        private final int maxDepth;
        private final List<Long> defaultSlas;
        private final List<Boolean> enabledByLevel;
        private final Map<String, Object> overrides;

        ResolvedEscalationConfig(int maxDepth, List<Long> defaultSlas,
                                 List<Boolean> enabledByLevel, Map<String, Object> overrides) {
            this.maxDepth = maxDepth;
            this.defaultSlas = List.copyOf(defaultSlas);
            this.enabledByLevel = List.copyOf(enabledByLevel);
            this.overrides = Map.copyOf(overrides);
        }

        public boolean isEnabled(String serviceCode, int level) {
            OverrideConfig override = override(serviceCode);
            List<Boolean> enabled = override.enabled.isEmpty() ? enabledByLevel : override.enabled;
            return enabled.isEmpty() || valueAt(enabled, level);
        }

        public long resolveSla(String serviceCode, int level) {
            OverrideConfig override = override(serviceCode);
            List<Long> slas = override.slas.isEmpty() ? defaultSlas : override.slas;
            return valueAt(slas, level);
        }

        private OverrideConfig override(String serviceCode) {
            Object raw = overrides.get(serviceCode);
            if (raw instanceof List<?>) {
                return new OverrideConfig(numberList(raw), Collections.emptyList());
            }
            Map<String, Object> structured = map(raw);
            return new OverrideConfig(numberList(structured.get("slaByLevel")),
                    booleanList(structured.get("enabledByLevel")));
        }

        private static <T> T valueAt(List<T> values, int level) {
            int safeLevel = Math.max(level, 0);
            return values.get(Math.min(safeLevel, values.size() - 1));
        }

        private record OverrideConfig(List<Long> slas, List<Boolean> enabled) {
        }
    }
}
