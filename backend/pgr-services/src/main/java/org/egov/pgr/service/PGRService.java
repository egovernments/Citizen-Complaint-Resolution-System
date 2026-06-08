package org.egov.pgr.service;

import com.jayway.jsonpath.JsonPath;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.digit.services.registry.RegistryClient;
import org.digit.services.registry.model.RegistryDataResponse;
import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.util.PGRUtils;
import org.egov.pgr.validator.ServiceRequestValidator;
import org.egov.pgr.web.models.*;
import org.springframework.util.CollectionUtils;

import java.util.*;

@Slf4j
@org.springframework.stereotype.Service
@RequiredArgsConstructor
public class PGRService {

    private final EnrichmentService enrichmentService;
    private final UserService userService;
    private final WorkflowService workflowService;
    private final ServiceRequestValidator validator;
    private final RegistryService registryService;
    private final PGRConfiguration config;
    private final PGRUtils pgrUtils;
    private final ComplaintDomainEventService complaintDomainEventService;
    private final RegistryClient registryClient;

    public ServiceRequest create(ServiceRequest request) {
        String fromState = request.getService().getApplicationStatus();

        validator.validateCreate(request);
        enrichmentService.enrichCreateRequest(request);

        enrichServiceCodeMetadata(request);

        workflowService.updateWorkflowStatus(request);
        complaintDomainEventService.publishWorkflowTransitionEvent(request, fromState);

        registryService.save(request.getService());
        return request;
    }

    public List<ServiceWrapper> search(ServiceRequest request, RequestSearchCriteria criteria) {
        validator.validateSearch(request, criteria);
        enrichmentService.enrichSearchRequest(request, criteria);

        if (criteria.isEmpty()) return new ArrayList<>();
        if (criteria.getMobileNumber() != null && CollectionUtils.isEmpty(criteria.getUserIds()))
            return new ArrayList<>();

        criteria.setIsPlainSearch(false);
        List<Service> services = registryService.search(criteria);

        if (CollectionUtils.isEmpty(services)) return new ArrayList<>();

        List<ServiceWrapper> wrappers = new ArrayList<>();
        for (Service svc : services) {
            wrappers.add(ServiceWrapper.builder().service(svc).workflow(new Workflow()).build());
        }

        userService.enrichUsers(wrappers);
        workflowService.enrichWorkflow(wrappers);

        wrappers.sort((a, b) -> {
            long ta = a.getService().getAuditDetails() != null ? a.getService().getAuditDetails().getCreatedTime() : 0;
            long tb = b.getService().getAuditDetails() != null ? b.getService().getAuditDetails().getCreatedTime() : 0;
            return Long.compare(tb, ta);
        });

        return wrappers;
    }

    public ServiceRequest update(ServiceRequest request) {
        String fromState = request.getService().getApplicationStatus();

        validator.validateUpdate(request);
        enrichmentService.enrichUpdateRequest(request);

        enrichServiceCodeMetadata(request);

        workflowService.updateWorkflowStatus(request);
        complaintDomainEventService.publishWorkflowTransitionEvent(request, fromState);

        registryService.update(request.getService());
        return request;
    }

    public Integer count(ServiceRequest request, RequestSearchCriteria criteria) {
        criteria.setIsPlainSearch(false);
        return registryService.count(criteria);
    }

    public List<ServiceWrapper> plainSearch(ServiceRequest request, RequestSearchCriteria criteria) {
        validator.validatePlainSearch(criteria);
        criteria.setIsPlainSearch(true);

        if (criteria.getLimit() == null) criteria.setLimit(config.getDefaultLimit());
        if (criteria.getOffset() == null) criteria.setOffset(config.getDefaultOffset());
        if (criteria.getLimit() > config.getMaxLimit()) criteria.setLimit(config.getMaxLimit());

        List<Service> services = registryService.search(criteria);
        if (CollectionUtils.isEmpty(services)) return new ArrayList<>();

        List<ServiceWrapper> wrappers = new ArrayList<>();
        for (Service svc : services) {
            wrappers.add(ServiceWrapper.builder().service(svc).workflow(new Workflow()).build());
        }

        userService.enrichUsers(wrappers);
        workflowService.enrichWorkflow(wrappers);

        wrappers.sort((a, b) -> {
            long ta = a.getService().getAuditDetails() != null ? a.getService().getAuditDetails().getCreatedTime() : 0;
            long tb = b.getService().getAuditDetails() != null ? b.getService().getAuditDetails().getCreatedTime() : 0;
            return Long.compare(tb, ta);
        });

        return wrappers;
    }

    public Map<String, Integer> getDynamicData(String tenantId) {
        RequestSearchCriteria resolved = RequestSearchCriteria.builder()
                .tenantId(tenantId)
                .applicationStatus(Set.of("RESOLVED"))
                .build();
        int resolvedCount = registryService.count(resolved);
        return Map.of("complaintsResolved", resolvedCount, "averageResolutionTime", 0);
    }

    public int getComplaintTypes() {
        return Integer.parseInt(config.getComplaintTypes());
    }

    /**
     * Pulls serviceName and department from Registry service-category schema
     * and merges them into additionalDetail, matching the old MDMS lookup behaviour.
     */
    @SuppressWarnings("unchecked")
    private void enrichServiceCodeMetadata(ServiceRequest request) {
        String serviceCode = request.getService().getServiceCode();
        try {
            RegistryDataResponse response = registryClient.searchRegistryData(
                    config.getRegistryServiceCategorySchemaCode(), "code", serviceCode);

            if (response == null || !Boolean.TRUE.equals(response.getSuccess()) || response.getData() == null)
                return;

            String json = response.getData().toString();
            List<String> names = JsonPath.read(json, "$[0].data.name");
            List<String> departments = JsonPath.read(json, "$[0].data.department");

            Map<String, Object> existing = pgrUtils.extractAdditionalDetails(request.getService().getAdditionalDetail());
            Map<String, Object> backend = new HashMap<>();
            if (!CollectionUtils.isEmpty(names)) backend.put("serviceName", names.get(0));
            if (!CollectionUtils.isEmpty(departments)) backend.put("department", departments.get(0));
            request.getService().setAdditionalDetail(pgrUtils.deepMerge(existing, backend));
        } catch (Exception e) {
            log.warn("Could not enrich serviceCode metadata for {}: {}", serviceCode, e.getMessage());
        }
    }
}
