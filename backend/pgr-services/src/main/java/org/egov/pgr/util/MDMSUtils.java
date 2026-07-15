package org.egov.pgr.util;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.jayway.jsonpath.JsonPath;
import lombok.extern.slf4j.Slf4j;
import org.egov.common.contract.request.RequestInfo;
import org.egov.common.utils.MultiStateInstanceUtil;
import org.egov.mdms.model.MasterDetail;
import org.egov.mdms.model.MdmsCriteria;
import org.egov.mdms.model.MdmsCriteriaReq;
import org.egov.mdms.model.ModuleDetail;
import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.repository.ServiceRequestRepository;
import org.egov.pgr.web.models.ComplaintTemplateTypeConfig;
import org.egov.pgr.web.models.ServiceRequest;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import org.egov.tracer.model.CustomException;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;

import static org.egov.pgr.util.PGRConstants.MDMS_MODULE_NAME;
import static org.egov.pgr.util.PGRConstants.MDMS_SERVICEDEF;
import static org.egov.pgr.util.PGRConstants.MDMS_COMMON_MASTERS_MODULE_NAME;
import static org.egov.pgr.util.PGRConstants.MDMS_DEPT_MASTER;
import static org.egov.pgr.util.PGRConstants.MDMS_DATA_JSONPATH;
import static org.egov.pgr.util.PGRConstants.MDMS_DATA_SLA_KEYWORD;
import static org.egov.pgr.util.PGRConstants.MDMS_DATA_SERVICE_CODE_KEYWORD;
import static org.egov.pgr.util.PGRConstants.MDMS_COMPLAINT_RELATED_TO_MAP;
import static org.egov.pgr.util.PGRConstants.MDMS_COMPLAINT_TEMPLATE_TYPE;
import static org.egov.pgr.util.PGRConstants.MDMS_COMPLAINT_SCHEMA;
import static org.egov.pgr.util.PGRConstants.MDMS_NOTIFICATION_ROUTING_MASTER;
import static org.egov.pgr.util.PGRConstants.MDMS_NOTIFICATION_TEMPLATE_MASTER;
import static org.egov.pgr.util.PGRConstants.MDMS_NOTIFICATION_ROUTING_JSONPATH;
import static org.egov.pgr.util.PGRConstants.MDMS_NOTIFICATION_TEMPLATE_JSONPATH;
import static org.egov.pgr.util.PGRConstants.MDMS_ALL_DEPARTMENTS_JSONPATH;

@Slf4j
@Component
public class MDMSUtils {

    // Only allow safe alphanumeric codes in JSONPath filter expressions to prevent injection.
    private static final Pattern SAFE_CODE_PATTERN = Pattern.compile("^[A-Za-z0-9_-]{1,50}$");

    private static void validateCodeForJsonPath(String code, String paramName) {
        if (code != null && !SAFE_CODE_PATTERN.matcher(code).matches())
            throw new CustomException("INVALID_INPUT",
                    paramName + " contains invalid characters: " + code);
    }

    // serviceCode -> SLA millis (from RAINMAKER-PGR.ComplaintHierarchy LEAF rows' slaHours),
    // cached per state-level tenant. Backs per-complaint-type SLA ordering of the inbox (issue
    // #432). Cache lives for the process lifetime — slaHours changes in MDMS need a
    // pgr-services restart to take effect, same staleness window the migration map had.
    private final Map<String, Map<String, Long>> serviceCodeToSlaCache = new ConcurrentHashMap<>();

    // Department CODE -> NAME, cached per CITY tenant (see getDepartmentCodeToNameMap javadoc for
    // why state-level keying would be wrong here). Backs EmployeeDepartmentScopeService, which
    // must filter on both forms since PGRService#getDepartmentFromMDMS stores the NAME whenever
    // resolvable, only falling back to the CODE on lookup failure. Same restart-to-refresh
    // staleness window as serviceCodeToSlaCache above — but ONLY for non-empty results (see
    // getDepartmentCodeToNameMap): an empty map is never cached, so a transient MDMS failure or
    // not-yet-seeded tenant is retried on the next call instead of being stuck empty until restart.
    private final Map<String, Map<String, String>> departmentCodeToNameCache = new ConcurrentHashMap<>();

    // Config-driven notification masters, cached per state-level tenant with a short TTL
    // (pgr.notification.mdms.cache.ttl.ms, default 60s). Configurator edits to
    // NotificationRouting/NotificationTemplate become visible within that window without a
    // pgr-services restart. Only NON-EMPTY results are cached, so a transient MDMS miss is
    // retried on the next event rather than caching an empty result; during an MDMS outage the
    // last-known non-empty entry is served stale (past its TTL) so notifications keep flowing
    // with the last good config instead of being dropped.
    private static final class TimedRows {
        final List<Object> rows;
        final long fetchedAt;
        TimedRows(List<Object> rows) { this.rows = rows; this.fetchedAt = System.currentTimeMillis(); }
        boolean fresh(long ttlMs) { return System.currentTimeMillis() - fetchedAt < ttlMs; }
    }
    private final Map<String, TimedRows> notificationRoutingCache = new ConcurrentHashMap<>();
    private final Map<String, TimedRows> notificationTemplateCache = new ConcurrentHashMap<>();

    /**
     * serviceCode -> SLA in millis, derived from MDMS RAINMAKER-PGR.ComplaintHierarchy leaf rows'
     * slaHours (interior nodes carry no slaHours and are skipped by the Number guard below).
     * Cached per state-level tenant. Returns an empty map (never null) on MDMS failure,
     * so callers can fall back to the uniform business-level SLA.
     */
    public Map<String, Long> getServiceCodeToSlaMillis(String tenantId) {
        String stateTenant = multiStateInstanceUtil.getStateLevelTenant(tenantId);
        return serviceCodeToSlaCache.computeIfAbsent(stateTenant, this::fetchServiceCodeToSlaMillis);
    }

    private Map<String, Long> fetchServiceCodeToSlaMillis(String stateTenant) {
        Map<String, Long> map = new LinkedHashMap<>();
        try {
            MdmsCriteriaReq req = getMDMSRequest(new RequestInfo(), stateTenant);
            Object result = serviceRequestRepository.fetchResult(getMdmsSearchUrl(), req);
            List<Map<String, Object>> defs = JsonPath.read(result, MDMS_DATA_JSONPATH);
            for (Map<String, Object> def : defs) {
                Object code = def.get(MDMS_DATA_SERVICE_CODE_KEYWORD);
                Object sla = def.get(MDMS_DATA_SLA_KEYWORD);
                if (code != null && sla instanceof Number)
                    map.put(code.toString(), TimeUnit.HOURS.toMillis(((Number) sla).longValue()));
            }
        } catch (Exception e) {
            log.error("Failed to load serviceCode->SLA map for tenant {}; inbox SLA sort will fall back "
                    + "to the business-level SLA", stateTenant, e);
        }
        return map;
    }

    /**
     * Department CODE -> NAME for every row in the common-masters Department master, cached per
     * CITY tenant (not state-level — a city's master can override the state's, so two cities
     * under the same state must never share a cache entry). Returns an empty map (never null) on
     * MDMS failure — that result is deliberately NOT cached (unlike a populated map), so a
     * transient MDMS blip or not-yet-seeded tenant is retried on the next call instead of being
     * stuck empty for the rest of the process lifetime.
     */
    public Map<String, String> getDepartmentCodeToNameMap(String tenantId) {
        Map<String, String> cached = departmentCodeToNameCache.get(tenantId);
        if (cached != null)
            return cached;

        Map<String, String> fetched = fetchDepartmentCodeToNameMap(tenantId);
        if (!fetched.isEmpty())
            departmentCodeToNameCache.put(tenantId, fetched);
        return fetched;
    }

    /** City tenant first (masters can be overridden per-city); state tenant as fallback. */
    private Map<String, String> fetchDepartmentCodeToNameMap(String tenantId) {
        Map<String, String> map = fetchDepartmentCodeToNameMapForTenant(tenantId);
        String stateTenant = multiStateInstanceUtil.getStateLevelTenant(tenantId);
        if (map.isEmpty() && !tenantId.equals(stateTenant))
            map = fetchDepartmentCodeToNameMapForTenant(stateTenant);
        return map;
    }

    private Map<String, String> fetchDepartmentCodeToNameMapForTenant(String tenantId) {
        Map<String, String> map = new LinkedHashMap<>();
        try {
            MdmsCriteriaReq req = getMDMSRequest(new RequestInfo(), tenantId);
            Object result = serviceRequestRepository.fetchResult(getMdmsSearchUrl(), req);
            List<Map<String, Object>> rows = JsonPath.read(result, MDMS_ALL_DEPARTMENTS_JSONPATH);
            for (Map<String, Object> row : rows) {
                Object code = row.get("code");
                Object name = row.get("name");
                if (code != null && name != null)
                    map.put(code.toString(), name.toString());
            }
        } catch (Exception e) {
            log.error("Failed to load department code->name map for tenant {} — department-scoped "
                    + "search will filter on the HRMS code only, missing complaints stored under the "
                    + "resolved department NAME", tenantId, e);
        }
        return map;
    }

    /**
     * Notification routing rows (RAINMAKER-PGR.NotificationRouting) for the tenant, cached per
     * state-level tenant with a short TTL (pgr.notification.mdms.cache.ttl.ms). Returns an empty
     * list (never null) on MDMS failure; callers DROP the event's notifications in that case —
     * there is no legacy fallback when the config-driven flag is on. During an MDMS outage a
     * last-known non-empty entry is served stale rather than dropping notifications.
     */
    public List<Object> getNotificationRouting(String tenantId) {
        String stateTenant = multiStateInstanceUtil.getStateLevelTenant(tenantId);
        long ttl = config.getNotificationMdmsCacheTtlMs();
        TimedRows cached = notificationRoutingCache.get(stateTenant);
        if (cached != null && cached.fresh(ttl)) return cached.rows;
        List<Object> fetched = fetchNotificationMaster(stateTenant,
                MDMS_NOTIFICATION_ROUTING_MASTER, MDMS_NOTIFICATION_ROUTING_JSONPATH);
        if (!fetched.isEmpty()) {
            notificationRoutingCache.put(stateTenant, new TimedRows(fetched));
            return fetched;
        }
        // Empty fetch = transient MDMS miss OR genuinely unseeded tenant. Never cache empties
        // (retry next event); serve a stale non-empty entry if we have one rather than dropping
        // notifications during an MDMS blip.
        return cached != null ? cached.rows : fetched;
    }

    /**
     * Notification template rows (RAINMAKER-PGR.NotificationTemplate) for the tenant, cached per
     * state-level tenant with a short TTL (pgr.notification.mdms.cache.ttl.ms). Returns an empty
     * list (never null) on MDMS failure; there is no legacy fallback when the config-driven flag
     * is on. During an MDMS outage a last-known non-empty entry is served stale.
     */
    public List<Object> getNotificationTemplates(String tenantId) {
        String stateTenant = multiStateInstanceUtil.getStateLevelTenant(tenantId);
        long ttl = config.getNotificationMdmsCacheTtlMs();
        TimedRows cached = notificationTemplateCache.get(stateTenant);
        if (cached != null && cached.fresh(ttl)) return cached.rows;
        List<Object> fetched = fetchNotificationMaster(stateTenant,
                MDMS_NOTIFICATION_TEMPLATE_MASTER, MDMS_NOTIFICATION_TEMPLATE_JSONPATH);
        if (!fetched.isEmpty()) {
            notificationTemplateCache.put(stateTenant, new TimedRows(fetched));
            return fetched;
        }
        // Empty fetch = transient MDMS miss OR genuinely unseeded tenant. Never cache empties
        // (retry next event); serve a stale non-empty entry if we have one rather than dropping
        // notifications during an MDMS blip.
        return cached != null ? cached.rows : fetched;
    }

    @SuppressWarnings("unchecked")
    private List<Object> fetchNotificationMaster(String stateTenant, String masterName, String jsonPath) {
        try {
            MdmsCriteriaReq req = getNotificationModuleRequest(new RequestInfo(), stateTenant, masterName);
            Object result = serviceRequestRepository.fetchResult(getMdmsSearchUrl(), req);
            List<Object> rows = JsonPath.read(result, jsonPath);
            return rows != null ? rows : Collections.emptyList();
        } catch (Exception e) {
            log.error("Failed to load notification master {} for tenant {} — there is NO legacy fallback "
                    + "when pgr.notification.config.driven=true: notifications for this tenant will be "
                    + "DROPPED (or served from a stale cache entry) until MDMS recovers or the tenant is seeded",
                    masterName, stateTenant, e);
            return Collections.emptyList();
        }
    }

    private MdmsCriteriaReq getNotificationModuleRequest(RequestInfo requestInfo, String tenantId, String masterName) {
        List<MasterDetail> masterDetails = new ArrayList<>();
        masterDetails.add(MasterDetail.builder().name(masterName).build());
        ModuleDetail moduleDetail = ModuleDetail.builder().masterDetails(masterDetails)
                .moduleName(MDMS_MODULE_NAME).build();
        MdmsCriteria mdmsCriteria = MdmsCriteria.builder()
                .moduleDetails(Collections.singletonList(moduleDetail)).tenantId(tenantId).build();
        return MdmsCriteriaReq.builder().mdmsCriteria(mdmsCriteria).requestInfo(requestInfo).build();
    }



    private PGRConfiguration config;

    private ServiceRequestRepository serviceRequestRepository;

    private ObjectMapper objectMapper;

    @Autowired
    private MultiStateInstanceUtil multiStateInstanceUtil;

    @Autowired
    public MDMSUtils(PGRConfiguration config, ServiceRequestRepository serviceRequestRepository,
                     ObjectMapper objectMapper) {
        this.config = config;
        this.serviceRequestRepository = serviceRequestRepository;
        this.objectMapper = objectMapper;
    }

    /**
     * Calls MDMS service to fetch pgr master data
     * @param request
     * @return
     */
    public Object mDMSCall(ServiceRequest request){
        RequestInfo requestInfo = request.getRequestInfo();
        String tenantId = request.getService().getTenantId();

        MdmsCriteriaReq mdmsCriteriaReq = getMDMSRequest(requestInfo, tenantId);
        Object result = serviceRequestRepository.fetchResult(getMdmsSearchUrl(), mdmsCriteriaReq);

        String stateTenant = multiStateInstanceUtil.getStateLevelTenant(tenantId);
        if (!stateTenant.equals(tenantId)) {
            try {
                List<?> serviceDefs = JsonPath.read(result, MDMS_DATA_JSONPATH);
                if (serviceDefs == null || serviceDefs.isEmpty()) {
                    mdmsCriteriaReq = getMDMSRequest(requestInfo, stateTenant);
                    result = serviceRequestRepository.fetchResult(getMdmsSearchUrl(), mdmsCriteriaReq);
                }
            } catch (Exception e) {
                mdmsCriteriaReq = getMDMSRequest(requestInfo, stateTenant);
                result = serviceRequestRepository.fetchResult(getMdmsSearchUrl(), mdmsCriteriaReq);
            }
        }

        return result;
    }


    /**
     * Returns mdms search criteria based on the tenantId
     * @param requestInfo
     * @param tenantId
     * @return
     */
    public MdmsCriteriaReq getMDMSRequest(RequestInfo requestInfo,String tenantId){
        List<ModuleDetail> pgrModuleRequest = getPGRModuleRequest();

        List<ModuleDetail> moduleDetails = new LinkedList<>();
        moduleDetails.addAll(pgrModuleRequest);

        List<MasterDetail> commonMasterDetails = new ArrayList<>();
        commonMasterDetails.add(MasterDetail.builder().name(MDMS_DEPT_MASTER).build());
        ModuleDetail commonModuleDtls = ModuleDetail.builder().masterDetails(commonMasterDetails)
                .moduleName(MDMS_COMMON_MASTERS_MODULE_NAME).build();
        moduleDetails.add(commonModuleDtls);

        MdmsCriteria mdmsCriteria = MdmsCriteria.builder().moduleDetails(moduleDetails).tenantId(tenantId)
                .build();

        MdmsCriteriaReq mdmsCriteriaReq = MdmsCriteriaReq.builder().mdmsCriteria(mdmsCriteria)
                .requestInfo(requestInfo).build();
        return mdmsCriteriaReq;
    }


    /**
     * Creates request to search serviceDef from MDMS
     * @return request to search UOM from MDMS
     */
    private List<ModuleDetail> getPGRModuleRequest() {

        // master details for TL module
        List<MasterDetail> pgrMasterDetails = new ArrayList<>();

        // filter to only get code field from master data
        final String filterCode = "$.[?(@.active==true)]";

        pgrMasterDetails.add(MasterDetail.builder().name(MDMS_SERVICEDEF).filter(filterCode).build());

        ModuleDetail pgrModuleDtls = ModuleDetail.builder().masterDetails(pgrMasterDetails)
                .moduleName(MDMS_MODULE_NAME).build();


        return Collections.singletonList(pgrModuleDtls);

    }


    /**
     * Returns the url for mdms search endpoint
     *
     * @return url for mdms search endpoint
     */
    public StringBuilder getMdmsSearchUrl() {
        return new StringBuilder().append(config.getMdmsHost()).append(config.getMdmsEndPoint());
    }

    /**
     * Validates that a caseRelatedTo code is active in the ComplaintRelatedToMap MDMS master.
     * Tries city tenant first, falls back to state tenant.
     */
    public boolean isValidCaseRelatedTo(RequestInfo requestInfo, String tenantId, String code) {
        if (code == null) return false;
        validateCodeForJsonPath(code, "caseRelatedTo");
        String stateTenant = multiStateInstanceUtil.getStateLevelTenant(tenantId);
        try {
            boolean valid = doIsValidCaseRelatedTo(requestInfo, tenantId, code);
            if (!valid && !tenantId.equals(stateTenant))
                valid = doIsValidCaseRelatedTo(requestInfo, stateTenant, code);
            return valid;
        } catch (Exception e) {
            log.error("Failed to validate caseRelatedTo='{}' for tenant '{}'", code, tenantId, e);
            return false;
        }
    }

    private boolean doIsValidCaseRelatedTo(RequestInfo requestInfo, String tenantId, String code) {
        try {
            MdmsCriteriaReq req = MdmsCriteriaReq.builder()
                    .requestInfo(requestInfo)
                    .mdmsCriteria(MdmsCriteria.builder()
                            .tenantId(tenantId)
                            .moduleDetails(List.of(ModuleDetail.builder()
                                    .moduleName(MDMS_MODULE_NAME)
                                    .masterDetails(List.of(MasterDetail.builder()
                                            .name(MDMS_COMPLAINT_RELATED_TO_MAP)
                                            .filter("$.[?(@.active==true && @.code=='" + code + "')]")
                                            .build()))
                                    .build()))
                            .build())
                    .build();
            Object result = serviceRequestRepository.fetchResult(getMdmsSearchUrl(), req);
            List<Object> hits = JsonPath.read(result, "$.MdmsRes.RAINMAKER-PGR." + MDMS_COMPLAINT_RELATED_TO_MAP);
            return hits != null && !hits.isEmpty();
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * Fetches and merges ComplaintTemplateType + ComplaintSchema for a given caseRelatedTo value.
     * Tries city tenant first; falls back to state tenant if city-level MDMS returns no result.
     */
    public ComplaintTemplateTypeConfig fetchComplaintTemplateTypeConfig(RequestInfo requestInfo,
                                                        String tenantId,
                                                        String caseRelatedTo) {
        if (caseRelatedTo == null) return null;
        validateCodeForJsonPath(caseRelatedTo, "caseRelatedTo");
        String stateTenant = multiStateInstanceUtil.getStateLevelTenant(tenantId);

        ComplaintTemplateTypeConfig result = doFetchComplaintTemplateTypeConfig(requestInfo, tenantId, caseRelatedTo);
        if (result == null && !tenantId.equals(stateTenant)) {
            log.debug("ComplaintTemplateTypeConfig not found for tenant '{}', retrying with state tenant '{}'",
                    tenantId, stateTenant);
            result = doFetchComplaintTemplateTypeConfig(requestInfo, stateTenant, caseRelatedTo);
        }
        return result;
    }

    private ComplaintTemplateTypeConfig doFetchComplaintTemplateTypeConfig(RequestInfo requestInfo,
                                                            String tenantId,
                                                            String caseRelatedTo) {
        try {
            List<MasterDetail> details = List.of(
                MasterDetail.builder()
                    .name(MDMS_COMPLAINT_TEMPLATE_TYPE)
                    .filter("$.[?(@.active==true && @.caseRelatedTo=='" + caseRelatedTo + "')]")
                    .build(),
                // ComplaintExtendedAttributeSchema rows carry no top-level "active" flag —
                // fetch unfiltered, same as the citizen/employee UI does, and match by
                // schemaRef below.
                MasterDetail.builder()
                    .name(MDMS_COMPLAINT_SCHEMA)
                    .build()
            );
            MdmsCriteriaReq req = MdmsCriteriaReq.builder()
                    .requestInfo(requestInfo)
                    .mdmsCriteria(MdmsCriteria.builder()
                            .tenantId(tenantId)
                            .moduleDetails(List.of(ModuleDetail.builder()
                                    .moduleName(MDMS_MODULE_NAME)
                                    .masterDetails(details)
                                    .build()))
                            .build())
                    .build();

            Object mdmsResult = serviceRequestRepository.fetchResult(getMdmsSearchUrl(), req);

            List<Object> rawTemplates = JsonPath.read(mdmsResult,
                    "$.MdmsRes.RAINMAKER-PGR." + MDMS_COMPLAINT_TEMPLATE_TYPE);
            if (rawTemplates == null || rawTemplates.isEmpty()) return null;

            ComplaintTemplateTypeConfig cfg = objectMapper.convertValue(
                    rawTemplates.get(0), ComplaintTemplateTypeConfig.class);

            if (cfg.getSchemaRef() != null) {
                try {
                    String safeSchemaRef = cfg.getSchemaRef().replace("'", "\\'");
                    String schemaPath = "$.MdmsRes.RAINMAKER-PGR." + MDMS_COMPLAINT_SCHEMA
                            + "[?(@.schemaRef=='" + safeSchemaRef + "')]";
                    List<Object> rawSchemas = JsonPath.read(mdmsResult, schemaPath);
                    if (rawSchemas != null && !rawSchemas.isEmpty()) {
                        Object schemaObj = ((Map<?, ?>) rawSchemas.get(0)).get("schema");
                        if (schemaObj instanceof Map) {
                            @SuppressWarnings("unchecked")
                            Map<String, Object> schema = (Map<String, Object>) schemaObj;
                            cfg.setXSecurity(asStringList(schema.get("x-security")));
                            cfg.setFields(parseFieldDefinitions(schema));
                        }
                    }
                } catch (Exception e) {
                    log.warn("ComplaintExtendedAttributeSchema '{}' not found for tenant '{}'", cfg.getSchemaRef(), tenantId);
                }
            }

            return cfg;
        } catch (Exception e) {
            log.error("Failed to fetch ComplaintTemplateTypeConfig for caseRelatedTo={} tenant={}", caseRelatedTo, tenantId, e);
            return null;
        }
    }

    /**
     * Converts a draft-07 JSON Schema's "properties" map (+ "required" array) into the
     * flat FieldDefinition list ExtendedAttributesValidationService/EncryptionDecryptionService
     * expect. Mirrors the transform the citizen/employee UI applies to the same MDMS row —
     * "mandatory" comes from membership in "required", "dataType" from "format"/"type", and
     * "label" falls back to the raw x-label-key (an i18n key, not resolved text) since the
     * backend has no localization context; this only surfaces in validation error messages.
     */
    @SuppressWarnings("unchecked")
    private List<ComplaintTemplateTypeConfig.FieldDefinition> parseFieldDefinitions(Map<String, Object> schema) {
        Object propertiesObj = schema.get("properties");
        if (!(propertiesObj instanceof Map)) return Collections.emptyList();

        Set<String> required = new HashSet<>(asStringList(schema.get("required")));
        List<ComplaintTemplateTypeConfig.FieldDefinition> fields = new ArrayList<>();

        ((Map<String, Object>) propertiesObj).forEach((fieldKey, rawProperty) -> {
            if (!(rawProperty instanceof Map)) return;
            Map<String, Object> property = (Map<String, Object>) rawProperty;

            ComplaintTemplateTypeConfig.FieldDefinition fd = new ComplaintTemplateTypeConfig.FieldDefinition();
            fd.setFieldKey(fieldKey);
            Object labelKey = property.get("x-label-key");
            fd.setLabel(labelKey != null ? labelKey.toString() : fieldKey);
            fd.setDataType("date".equals(property.get("format")) ? "date"
                    : property.get("type") != null ? property.get("type").toString() : "string");
            fd.setMandatory(required.contains(fieldKey));
            if (property.get("maxLength") instanceof Number)
                fd.setMaxLength(((Number) property.get("maxLength")).intValue());
            if (property.get("x-order") instanceof Number)
                fd.setOrder(((Number) property.get("x-order")).intValue());
            fields.add(fd);
        });
        return fields;
    }

    private List<String> asStringList(Object raw) {
        if (!(raw instanceof List)) return Collections.emptyList();
        List<String> out = new ArrayList<>();
        for (Object o : (List<?>) raw) out.add(String.valueOf(o));
        return out;
    }

}
