package org.egov.pgr.web.controllers;

import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.egov.pgr.service.DashboardService;
import org.egov.pgr.service.PGRService;
import org.egov.pgr.util.PGRConstants;
import org.egov.pgr.web.models.*;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

import java.net.URI;
import java.util.*;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@RestController
@RequestMapping("/v2")
@RequiredArgsConstructor
@Slf4j
public class RequestsApiController {

    private final PGRService pgrService;
    private final DashboardService dashboardService;

    private static final Pattern REALM_PATTERN = Pattern.compile(".*/realms/([^/]+)/*$");

    // -------------------------------------------------------
    // CREATE
    // -------------------------------------------------------
    @PostMapping("/request/_create")
    public ResponseEntity<ServiceResponse> create(
            @Valid @RequestBody ServiceWrapper wrapper,
            @AuthenticationPrincipal Jwt jwt) {

        ServiceRequest request = buildServiceRequest(wrapper, jwt);
        ServiceRequest enriched = pgrService.create(request);

        ServiceResponse response = ServiceResponse.builder()
                .serviceWrappers(Collections.singletonList(
                        ServiceWrapper.builder()
                                .service(enriched.getService())
                                .workflow(enriched.getWorkflow())
                                .build()))
                .build();
        return new ResponseEntity<>(response, HttpStatus.OK);
    }

    // -------------------------------------------------------
    // UPDATE
    // -------------------------------------------------------
    @PostMapping("/request/_update")
    public ResponseEntity<ServiceResponse> update(
            @Valid @RequestBody ServiceWrapper wrapper,
            @AuthenticationPrincipal Jwt jwt) {

        ServiceRequest request = buildServiceRequest(wrapper, jwt);
        ServiceRequest enriched = pgrService.update(request);

        ServiceResponse response = ServiceResponse.builder()
                .serviceWrappers(Collections.singletonList(
                        ServiceWrapper.builder()
                                .service(enriched.getService())
                                .workflow(enriched.getWorkflow())
                                .build()))
                .build();
        return new ResponseEntity<>(response, HttpStatus.OK);
    }

    // -------------------------------------------------------
    // SEARCH
    // -------------------------------------------------------
    @PostMapping("/request/_search")
    public ResponseEntity<ServiceResponse> search(
            @RequestBody(required = false) RequestSearchCriteria criteria,
            @AuthenticationPrincipal Jwt jwt) {

        if (criteria == null) criteria = new RequestSearchCriteria();
        ServiceRequest request = buildContextRequest(jwt);

        List<ServiceWrapper> wrappers = pgrService.search(request, criteria);
        Map<String, Integer> dynamicData = pgrService.getDynamicData(criteria.getTenantId());

        ServiceResponse response = ServiceResponse.builder()
                .serviceWrappers(wrappers)
                .complaintsResolved(dynamicData.getOrDefault(PGRConstants.COMPLAINTS_RESOLVED, 0))
                .averageResolutionTime(dynamicData.getOrDefault(PGRConstants.AVERAGE_RESOLUTION_TIME, 0))
                .complaintTypes(pgrService.getComplaintTypes())
                .build();
        return new ResponseEntity<>(response, HttpStatus.OK);
    }

    // -------------------------------------------------------
    // PLAIN SEARCH (inter-service, no auth enrichment)
    // -------------------------------------------------------
    @PostMapping("/request/_plainsearch")
    public ResponseEntity<ServiceResponse> plainSearch(
            @RequestBody(required = false) RequestSearchCriteria criteria,
            @AuthenticationPrincipal Jwt jwt) {

        if (criteria == null) criteria = new RequestSearchCriteria();
        ServiceRequest request = buildContextRequest(jwt);

        List<ServiceWrapper> wrappers = pgrService.plainSearch(request, criteria);
        ServiceResponse response = ServiceResponse.builder()
                .serviceWrappers(wrappers)
                .build();
        return new ResponseEntity<>(response, HttpStatus.OK);
    }

    // -------------------------------------------------------
    // COUNT
    // -------------------------------------------------------
    @PostMapping("/request/_count")
    public ResponseEntity<CountResponse> count(
            @RequestBody(required = false) RequestSearchCriteria criteria,
            @AuthenticationPrincipal Jwt jwt) {

        if (criteria == null) criteria = new RequestSearchCriteria();
        ServiceRequest request = buildContextRequest(jwt);

        Integer count = pgrService.count(request, criteria);
        return new ResponseEntity<>(CountResponse.builder().count(count).build(), HttpStatus.OK);
    }

    // -------------------------------------------------------
    // DASHBOARD
    // -------------------------------------------------------
    @GetMapping("/dashboard")
    public ResponseEntity<DashboardResponse> dashboard(
            @RequestParam String tenantId,
            @RequestParam(required = false) Long fromDate,
            @RequestParam(required = false) Long toDate) {

        DashboardResponse response = dashboardService.getDashboardData(tenantId, fromDate, toDate);
        CacheControl cacheControl = CacheControl
                .maxAge(fromDate != null ? 30 : 60, TimeUnit.SECONDS)
                .cachePublic();
        return ResponseEntity.ok().cacheControl(cacheControl).body(response);
    }

    // -------------------------------------------------------
    // JWT helpers
    // -------------------------------------------------------
    private ServiceRequest buildServiceRequest(ServiceWrapper wrapper, Jwt jwt) {
        String tenantId = getTenantIdFromJwt(jwt);
        if (tenantId != null && wrapper.getService() != null) {
            wrapper.getService().setTenantId(tenantId);
        }
        return ServiceRequest.builder()
                .service(wrapper.getService())
                .workflow(wrapper.getWorkflow())
                .userId(getUserIdFromJwt(jwt))
                .tenantId(tenantId)
                .roles(getRolesFromJwt(jwt))
                .build();
    }

    private ServiceRequest buildContextRequest(Jwt jwt) {
        return ServiceRequest.builder()
                .userId(getUserIdFromJwt(jwt))
                .tenantId(getTenantIdFromJwt(jwt))
                .roles(getRolesFromJwt(jwt))
                .build();
    }

    private String getUserIdFromJwt(Jwt jwt) {
        if (jwt == null) return null;
        String sub = jwt.getSubject();
        return sub;
    }

    private String getTenantIdFromJwt(Jwt jwt) {
        if (jwt == null || jwt.getIssuer() == null) return null;
        String iss = jwt.getIssuer().toString();
        Matcher m = REALM_PATTERN.matcher(iss);
        if (m.matches()) return m.group(1);
        try {
            String path = URI.create(iss).getPath();
            Matcher m2 = REALM_PATTERN.matcher(path);
            if (m2.matches()) return m2.group(1);
        } catch (Exception ignored) {}
        return null;
    }

    @SuppressWarnings("unchecked")
    private List<String> getRolesFromJwt(Jwt jwt) {
        if (jwt == null) return Collections.emptyList();
        Map<String, Object> realmAccess = jwt.getClaim("realm_access");
        if (realmAccess == null) return Collections.emptyList();
        return (List<String>) realmAccess.getOrDefault("roles", Collections.emptyList());
    }
}
