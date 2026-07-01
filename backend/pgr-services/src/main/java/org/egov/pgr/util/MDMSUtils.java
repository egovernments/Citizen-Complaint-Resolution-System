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
                MasterDetail.builder()
                    .name(MDMS_COMPLAINT_SCHEMA)
                    .filter("$.[?(@.active==true)]")
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
                            + "[?(@.name=='" + safeSchemaRef + "')]";
                    List<Object> rawSchemas = JsonPath.read(mdmsResult, schemaPath);
                    if (rawSchemas != null && !rawSchemas.isEmpty()) {
                        ComplaintTemplateTypeConfig schema = objectMapper.convertValue(
                                rawSchemas.get(0), ComplaintTemplateTypeConfig.class);
                        cfg.setXSecurity(schema.getXSecurity());
                        cfg.setFields(schema.getFields());
                    }
                } catch (Exception e) {
                    log.warn("ComplaintSchema '{}' not found for tenant '{}'", cfg.getSchemaRef(), tenantId);
                }
            }

            return cfg;
        } catch (Exception e) {
            log.error("Failed to fetch ComplaintTemplateTypeConfig for caseRelatedTo={} tenant={}", caseRelatedTo, tenantId, e);
            return null;
        }
    }

}
