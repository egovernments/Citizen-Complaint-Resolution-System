package org.egov.pgr.web.controllers;


import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.egov.common.contract.response.ResponseInfo;
import org.egov.pgr.service.DashboardService;
import org.egov.pgr.service.PGRService;
import org.egov.pgr.service.VisibilityService;
import org.springframework.web.bind.annotation.RequestParam;
import org.egov.pgr.util.PGRConstants;
import org.egov.pgr.util.ResponseInfoFactory;
import org.egov.pgr.web.models.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.*;

import java.io.IOException;
import java.util.*;
import java.util.concurrent.TimeUnit;

import javax.validation.Valid;

//@javax.annotation.Generated(value = "org.egov.codegen.SpringBootCodegen", date = "2020-07-15T11:35:33.568+05:30")

@Controller
@RequestMapping("/v2")
@Slf4j
public class RequestsApiController{

    private final ObjectMapper objectMapper;

    private PGRService pgrService;

    private ResponseInfoFactory responseInfoFactory;

    private DashboardService dashboardService;

    private VisibilityService visibilityService;

    @Autowired
    public RequestsApiController(ObjectMapper objectMapper, PGRService pgrService,
                                 ResponseInfoFactory responseInfoFactory, DashboardService dashboardService,
                                 VisibilityService visibilityService) {
        this.objectMapper = objectMapper;
        this.pgrService = pgrService;
        this.responseInfoFactory = responseInfoFactory;
        this.dashboardService = dashboardService;
        this.visibilityService = visibilityService;
    }


    @RequestMapping(value="/request/_create", method = RequestMethod.POST)
    public ResponseEntity<ServiceResponse> requestsCreatePost(@Valid @RequestBody ServiceRequest request) throws IOException {
        ServiceRequest enrichedReq = pgrService.create(request);
        ResponseInfo responseInfo = responseInfoFactory.createResponseInfoFromRequestInfo(request.getRequestInfo(), true);
        ServiceWrapper serviceWrapper = ServiceWrapper.builder().service(enrichedReq.getService()).workflow(enrichedReq.getWorkflow()).build();
        ServiceResponse response = ServiceResponse.builder().responseInfo(responseInfo).serviceWrappers(Collections.singletonList(serviceWrapper)).build();
        return new ResponseEntity<>(response, HttpStatus.OK);

    }

    @RequestMapping(value="/request/_search", method = RequestMethod.POST)
    public ResponseEntity<ServiceResponse> requestsSearchPost(@Valid @RequestBody RequestInfoWrapper requestInfoWrapper,
                                                              @Valid @ModelAttribute RequestSearchCriteria criteria) {
    	
    	String tenantId = criteria.getTenantId();
        List<ServiceWrapper> serviceWrappers = pgrService.search(requestInfoWrapper.getRequestInfo(), criteria);
        Map<String,Integer> dynamicData = pgrService.getDynamicData(tenantId);
        
        int complaintsResolved = dynamicData.get(PGRConstants.COMPLAINTS_RESOLVED);
	    int averageResolutionTime = dynamicData.get(PGRConstants.AVERAGE_RESOLUTION_TIME);
	    int complaintTypes = pgrService.getComplaintTypes();
        
        ResponseInfo responseInfo = responseInfoFactory.createResponseInfoFromRequestInfo(requestInfoWrapper.getRequestInfo(), true);
        ServiceResponse response = ServiceResponse.builder().responseInfo(responseInfo).serviceWrappers(serviceWrappers).complaintsResolved(complaintsResolved)
        		.averageResolutionTime(averageResolutionTime).complaintTypes(complaintTypes).build();
        return new ResponseEntity<>(response, HttpStatus.OK);

    }

    @RequestMapping(value = "request/_plainsearch", method = RequestMethod.POST)
    public ResponseEntity<ServiceResponse> requestsPlainSearchPost(@Valid @RequestBody RequestInfoWrapper requestInfoWrapper, @Valid @ModelAttribute RequestSearchCriteria requestSearchCriteria) {
        List<ServiceWrapper> serviceWrappers = pgrService.plainSearch(requestInfoWrapper.getRequestInfo(), requestSearchCriteria);
        ResponseInfo responseInfo = responseInfoFactory.createResponseInfoFromRequestInfo(requestInfoWrapper.getRequestInfo(), true);
        ServiceResponse response = ServiceResponse.builder().responseInfo(responseInfo).serviceWrappers(serviceWrappers).build();
        return new ResponseEntity<>(response, HttpStatus.OK);

    }

    @RequestMapping(value="/request/_update", method = RequestMethod.POST)
    public ResponseEntity<ServiceResponse> requestsUpdatePost(@Valid @RequestBody ServiceRequest request) throws IOException {
        ServiceRequest enrichedReq = pgrService.update(request);
        ServiceWrapper serviceWrapper = ServiceWrapper.builder().service(enrichedReq.getService()).workflow(enrichedReq.getWorkflow()).build();
        ResponseInfo responseInfo = responseInfoFactory.createResponseInfoFromRequestInfo(request.getRequestInfo(), true);
        ServiceResponse response = ServiceResponse.builder().responseInfo(responseInfo).serviceWrappers(Collections.singletonList(serviceWrapper)).build();
        return new ResponseEntity<>(response, HttpStatus.OK);
    }

    @RequestMapping(value="/request/_count", method = RequestMethod.POST)
    public ResponseEntity<CountResponse> requestsCountPost(@Valid @RequestBody RequestInfoWrapper requestInfoWrapper,
                                                           @Valid @ModelAttribute RequestSearchCriteria criteria) {
        Integer count = pgrService.count(requestInfoWrapper.getRequestInfo(), criteria);
        ResponseInfo responseInfo = responseInfoFactory.createResponseInfoFromRequestInfo(requestInfoWrapper.getRequestInfo(), true);
        CountResponse response = CountResponse.builder().responseInfo(responseInfo).count(count).build();
        return new ResponseEntity<>(response, HttpStatus.OK);

    }

    /**
     * Visibility-aware inbox search (Visibility V1 Step-2, design §4.1): same
     * criteria surface as /request/_search plus a `tab` param; the visibility
     * scope (MY = assignee-me, ALL = reportee subtree + unassigned queues,
     * with tenant-wide fallback) is resolved server-side before the search.
     */
    @RequestMapping(value="/request/inbox/_search", method = RequestMethod.POST)
    public ResponseEntity<ServiceResponse> inboxSearchPost(@Valid @RequestBody RequestInfoWrapper requestInfoWrapper,
                                                           @Valid @ModelAttribute RequestSearchCriteria criteria,
                                                           @RequestParam(value = "tab", defaultValue = "MY") String tab) {
        visibilityService.resolve(requestInfoWrapper.getRequestInfo(), criteria, tab);
        return requestsSearchPost(requestInfoWrapper, criteria);
    }

    @RequestMapping(value="/request/inbox/_count", method = RequestMethod.POST)
    public ResponseEntity<CountResponse> inboxCountPost(@Valid @RequestBody RequestInfoWrapper requestInfoWrapper,
                                                        @Valid @ModelAttribute RequestSearchCriteria criteria,
                                                        @RequestParam(value = "tab", defaultValue = "MY") String tab) {
        visibilityService.resolve(requestInfoWrapper.getRequestInfo(), criteria, tab);
        return requestsCountPost(requestInfoWrapper, criteria);
    }

    @GetMapping("/dashboard")
    public ResponseEntity<DashboardResponse> dashboard(
            @RequestParam String tenantId,
            @RequestParam(required = false) Long fromDate,
            @RequestParam(required = false) Long toDate) {
        DashboardResponse response = dashboardService.getDashboardData(tenantId, fromDate, toDate);
        CacheControl cacheControl = CacheControl
                .maxAge(fromDate != null ? 30 : 60, TimeUnit.SECONDS)
                .cachePublic();
        return ResponseEntity.ok()
                .cacheControl(cacheControl)
                .body(response);
    }

}
