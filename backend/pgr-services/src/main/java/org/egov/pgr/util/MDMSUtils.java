package org.egov.pgr.util;

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
import org.egov.pgr.web.models.ServiceRequest;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

import static org.egov.pgr.util.PGRConstants.MDMS_MODULE_NAME;
import static org.egov.pgr.util.PGRConstants.MDMS_SERVICEDEF;
import static org.egov.pgr.util.PGRConstants.MDMS_COMMON_MASTERS_MODULE_NAME;
import static org.egov.pgr.util.PGRConstants.MDMS_DEPT_MASTER;
import static org.egov.pgr.util.PGRConstants.MDMS_DATA_JSONPATH;
import static org.egov.pgr.util.PGRConstants.MDMS_DATA_SLA_KEYWORD;
import static org.egov.pgr.util.PGRConstants.MDMS_DATA_SERVICE_CODE_KEYWORD;

@Slf4j
@Component
public class MDMSUtils {

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

    @Autowired
    private MultiStateInstanceUtil multiStateInstanceUtil;

    @Autowired
    public MDMSUtils(PGRConfiguration config, ServiceRequestRepository serviceRequestRepository) {
        this.config = config;
        this.serviceRequestRepository = serviceRequestRepository;
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

}
