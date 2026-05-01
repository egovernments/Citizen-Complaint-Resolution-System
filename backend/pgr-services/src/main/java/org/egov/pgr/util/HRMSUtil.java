package org.egov.pgr.util;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.jayway.jsonpath.JsonPath;
import lombok.extern.slf4j.Slf4j;
import org.apache.commons.lang3.StringUtils;
import org.egov.common.contract.request.RequestInfo;
import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.repository.ServiceRequestRepository;
import org.egov.pgr.web.models.RequestInfoWrapper;
import org.egov.tracer.model.CustomException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.util.CollectionUtils;

import java.util.Collections;
import java.util.List;

import static org.egov.pgr.util.PGRConstants.HRMS_DEPARTMENT_JSONPATH;
import static org.egov.pgr.util.PGRConstants.HRMS_REPORTING_TO_JSONPATH;

@Component
@Slf4j
public class HRMSUtil {


    private ServiceRequestRepository serviceRequestRepository;

    private PGRConfiguration config;


    @Autowired
    public HRMSUtil(ServiceRequestRepository serviceRequestRepository, PGRConfiguration config) {
        this.serviceRequestRepository = serviceRequestRepository;
        this.config = config;
    }

    /**
     * Gets the list of department for the given list of uuids of employees
     * @param uuids
     * @param requestInfo
     * @return
     */
    public List<String> getDepartment(List<String> uuids, RequestInfo requestInfo,String tenantId){

        StringBuilder url = getHRMSURI(uuids,tenantId);

        RequestInfoWrapper requestInfoWrapper = RequestInfoWrapper.builder().requestInfo(requestInfo).build();

        Object res = serviceRequestRepository.fetchResult(url, requestInfoWrapper);

        List<String> departments = null;

        try {
             departments = JsonPath.read(res, HRMS_DEPARTMENT_JSONPATH);
        }
        catch (Exception e){
            throw new CustomException("PARSING_ERROR","Failed to parse HRMS response");
        }

        if(CollectionUtils.isEmpty(departments))
            throw new CustomException("DEPARTMENT_NOT_FOUND","The Department of the user with uuid: "+uuids.toString()+" is not found");

        return departments;

    }

    /**
     * Given an employee UUID, find their supervisor's UUID from HRMS.
     * Reads assignments[*].reportingTo from the current assignment.
     * Returns null if no supervisor found.
     */
    public String getSupervisorUuid(String employeeUuid, RequestInfo requestInfo, String tenantId) {

        StringBuilder url = getHRMSURI(Collections.singletonList(employeeUuid), tenantId);

        RequestInfoWrapper requestInfoWrapper = RequestInfoWrapper.builder().requestInfo(requestInfo).build();

        Object res = serviceRequestRepository.fetchResult(url, requestInfoWrapper);

        if (res == null) {
            log.warn("HRMS returned null for employee UUID: {}", employeeUuid);
            return null;
        }

        try {
            List<String> reportingTo = JsonPath.read(res, HRMS_REPORTING_TO_JSONPATH);
            if (CollectionUtils.isEmpty(reportingTo)) {
                log.info("No reportingTo found for employee UUID: {}", employeeUuid);
                return null;
            }
            return reportingTo.get(0);
        } catch (Exception e) {
            log.warn("Failed to parse HRMS reportingTo for employee UUID: {}", employeeUuid, e);
            return null;
        }
    }

    /**
     * Builds HRMS search URL
     * @param uuids
     * @return
     */

    public StringBuilder getHRMSURI(List<String> uuids,String tenantId){

        StringBuilder builder = new StringBuilder(config.getHrmsHost());
        builder.append(config.getHrmsEndPoint());
        builder.append("?tenantId=");
        builder.append(tenantId);
        builder.append("&uuids=");
        builder.append(StringUtils.join(uuids, ","));

        return builder;
    }


}
