package org.egov.pgr.web.controllers;


import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.egov.common.contract.response.ResponseInfo;
import org.egov.pgr.service.DashboardService;
import org.egov.pgr.service.DashboardTenantGuard;
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

import jakarta.validation.Valid;

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

    private DashboardTenantGuard dashboardTenantGuard;

    @Autowired
    public RequestsApiController(ObjectMapper objectMapper, PGRService pgrService,
                                 ResponseInfoFactory responseInfoFactory, DashboardService dashboardService,
                                 VisibilityService visibilityService, DashboardTenantGuard dashboardTenantGuard) {
        this.objectMapper = objectMapper;
        this.pgrService = pgrService;
        this.responseInfoFactory = responseInfoFactory;
        this.dashboardService = dashboardService;
        this.visibilityService = visibilityService;
        this.dashboardTenantGuard = dashboardTenantGuard;
    }

    /**
     * RequestSearchCriteria's internal fields (visibility predicate, workflow
     * pre-resolution, plain-search flag) are populated server-side only.
     * `@JsonIgnore` does not stop `@ModelAttribute` query-param binding, so
     * disallow them explicitly — a client-supplied `visibilityIds` would
     * otherwise ride into the visibility OR-predicate.
     */
    @InitBinder
    public void disallowInternalCriteriaFields(org.springframework.web.bind.WebDataBinder binder) {
        binder.setDisallowedFields("visibilityIds*", "visibilityUnassignedStates*",
                "serviceRequestIds*", "userIds*", "isPlainSearch*",
                "createdTimeBefore*", "serviceRequestIdBefore*");
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
     * criteria surface as /request/_search plus a `scope` filter param
     * (MINE = assignee-me, TEAM = reportee subtree + unassigned queues, with
     * tenant-wide fallback) resolved server-side before the search. The values
     * are machine enums, not display strings — the UI localizes its own labels.
     */
    @RequestMapping(value="/request/inbox/_search", method = RequestMethod.POST)
    public ResponseEntity<ServiceResponse> inboxSearchPost(@Valid @RequestBody RequestInfoWrapper requestInfoWrapper,
                                                           @Valid @ModelAttribute RequestSearchCriteria criteria,
                                                           @RequestParam(value = "scope", defaultValue = "MINE") String scope) {
        visibilityService.resolve(requestInfoWrapper.getRequestInfo(), criteria, scope);
        return requestsSearchPost(requestInfoWrapper, criteria);
    }

    @RequestMapping(value="/request/inbox/_count", method = RequestMethod.POST)
    public ResponseEntity<CountResponse> inboxCountPost(@Valid @RequestBody RequestInfoWrapper requestInfoWrapper,
                                                        @Valid @ModelAttribute RequestSearchCriteria criteria,
                                                        @RequestParam(value = "scope", defaultValue = "MINE") String scope) {
        visibilityService.resolve(requestInfoWrapper.getRequestInfo(), criteria, scope);
        return requestsCountPost(requestInfoWrapper, criteria);
    }

    /**
     * Legacy PGR dashboard aggregates. The requested tenant is authorized against the caller's
     * own tenant (see {@link DashboardTenantGuard}); the token is read from the same places the
     * gateway reads it for a GET. The credential-free public dashboard is a separate surface
     * ({@code /v2/analytics/public/*}) and is unaffected.
     *
     * <p>The response is per caller now, so it is {@code private}: a shared cache must not hand
     * one tenant's aggregates to another caller asking for the same URL. A refused request
     * throws before any Cache-Control is set.
     */
    @GetMapping("/dashboard")
    public ResponseEntity<DashboardResponse> dashboard(
            @RequestParam String tenantId,
            @RequestParam(required = false) Long fromDate,
            @RequestParam(required = false) Long toDate,
            @RequestHeader(value = "auth-token", required = false) String authTokenHeader,
            @RequestParam(value = "access_token", required = false) String accessToken) {
        String authToken = authTokenHeader != null && !authTokenHeader.isBlank() ? authTokenHeader : accessToken;
        dashboardTenantGuard.requireAuthorizedTenant(authToken, tenantId);
        DashboardResponse response = dashboardService.getDashboardData(tenantId, fromDate, toDate);
        CacheControl cacheControl = CacheControl
                .maxAge(fromDate != null ? 30 : 60, TimeUnit.SECONDS)
                .cachePrivate();
        return ResponseEntity.ok()
                .cacheControl(cacheControl)
                .body(response);
    }

}
