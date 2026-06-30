package org.egov.pgr.service;


import com.jayway.jsonpath.JsonPath;
import lombok.extern.slf4j.Slf4j;
import org.egov.common.contract.request.RequestInfo;
import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.producer.Producer;
import org.egov.pgr.repository.PGRRepository;
import org.egov.pgr.util.MDMSUtils;
import org.egov.pgr.util.PGRUtils;
import org.egov.pgr.validator.ServiceRequestValidator;
import org.egov.pgr.web.models.ComplaintTemplateTypeConfig;
import org.egov.pgr.web.models.ExtendedAttributes;
import org.egov.pgr.web.models.Service;
import org.egov.pgr.web.models.ServiceWrapper;
import org.egov.pgr.web.models.RequestSearchCriteria;
import org.egov.pgr.web.models.ServiceRequest;
import org.egov.tracer.model.CustomException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.util.CollectionUtils;

import java.util.*;

import static org.egov.pgr.util.PGRConstants.MDMS_DEPARTMENT_SEARCH;
import static org.egov.pgr.util.PGRConstants.MDMS_DEPARTMENT_NAME_SEARCH;
import static org.egov.pgr.util.PGRConstants.MDMS_SERVICENAME_SEARCH;
import static org.egov.pgr.util.PGRConstants.ROLE_CONFIDENTIAL_VIEWER;

import java.util.stream.Collectors;

@Slf4j
@org.springframework.stereotype.Service
public class PGRService {



    private EnrichmentService enrichmentService;

    private UserService userService;

    private WorkflowService workflowService;

    private ServiceRequestValidator serviceRequestValidator;

    private ServiceRequestValidator validator;

    private Producer producer;

    private PGRConfiguration config;

    private PGRRepository repository;

    private MDMSUtils mdmsUtils;

    private ComplaintDomainEventService complaintDomainEventService;

    private PGRUtils pgrUtils;

    private ExtendedAttributesValidationService extendedAttributesValidationService;

    private EncryptionDecryptionService encryptionDecryptionService;

    @Autowired
    public PGRService(EnrichmentService enrichmentService, UserService userService, WorkflowService workflowService,
                      ServiceRequestValidator serviceRequestValidator, ServiceRequestValidator validator, Producer producer,
                      PGRConfiguration config, PGRRepository repository, MDMSUtils mdmsUtils,
                      ComplaintDomainEventService complaintDomainEventService, PGRUtils pgrUtils,
                      ExtendedAttributesValidationService extendedAttributesValidationService,
                      EncryptionDecryptionService encryptionDecryptionService) {
        this.enrichmentService = enrichmentService;
        this.userService = userService;
        this.workflowService = workflowService;
        this.serviceRequestValidator = serviceRequestValidator;
        this.validator = validator;
        this.producer = producer;
        this.config = config;
        this.repository = repository;
        this.mdmsUtils = mdmsUtils;
        this.complaintDomainEventService = complaintDomainEventService;
        this.pgrUtils = pgrUtils;
        this.extendedAttributesValidationService = extendedAttributesValidationService;
        this.encryptionDecryptionService = encryptionDecryptionService;
    }


    /**
     * Creates a complaint in the system
     * @param request The service request containg the complaint information
     * @return
     */
	public ServiceRequest create(ServiceRequest request) {
		String tenantId = request.getService().getTenantId();
		String fromState = request.getService().getApplicationStatus();
		Object mdmsData = mdmsUtils.mDMSCall(request);
		validator.validateCreate(request, mdmsData);
		enrichmentService.enrichCreateRequest(request);
		workflowService.updateWorkflowStatus(request);

		Service service = request.getService();

		Map<String, Object> existing = pgrUtils.extractAdditionalDetails(service.getAdditionalDetail());
		Map<String, Object> backend = new HashMap<>();
		backend.put("department", getDepartmentFromMDMS(request, mdmsData));
		backend.put("serviceName", getServiceNameFromMDMS(request, mdmsData));
		Map<String, Object> merged = pgrUtils.deepMerge(existing, backend);
		service.setAdditionalDetail(merged);

		// Extended attributes: validate → encrypt → sync contact details to User Service
		ExtendedAttributes ext = service.getExtendedAttributes();
		ComplaintTemplateTypeConfig cfg = null;
		ExtendedAttributes plainExt = null;
		if (ext != null) {
			if (ext.getIsConfidential() == null) ext.setIsConfidential(false);
			cfg = mdmsUtils.fetchComplaintTemplateTypeConfig(
					request.getRequestInfo(), tenantId, ext.getCaseRelatedTo());
			if (cfg == null)
				throw new CustomException("INVALID_CASE_RELATED_TO",
						"No MDMS config found for caseRelatedTo: " + ext.getCaseRelatedTo());
			extendedAttributesValidationService.validate(ext, cfg, service);
			plainExt = ext.copy(); // snapshot before encrypt — avoids decrypt round-trip for response
			service.setExtendedAttributes(
					encryptionDecryptionService.encrypt(ext, cfg, tenantId));
			enrichmentService.enrichUserContactDetails(request);
		}

		complaintDomainEventService.publishWorkflowTransitionEvent(request, fromState);

		producer.push(tenantId, config.getCreateTopic(), request);
		producer.push(tenantId, config.getInboxCreateTopic(), request);

		if (plainExt != null)
			service.setExtendedAttributes(plainExt);

		return request;
	}


    /**
     * Searches the complaints in the system based on the given criteria
     * @param requestInfo The requestInfo of the search call
     * @param criteria The search criteria containg the params on which to search
     * @return
     */
    public List<ServiceWrapper> search(RequestInfo requestInfo, RequestSearchCriteria criteria){
        validator.validateSearch(requestInfo, criteria);

        enrichmentService.enrichSearchRequest(requestInfo, criteria);

        if(criteria.isEmpty())
            return new ArrayList<>();

        if(criteria.getMobileNumber()!=null && CollectionUtils.isEmpty(criteria.getUserIds()))
            return new ArrayList<>();

        if (criteria.getAssignee() != null) {
            String tenantId = criteria.getTenantId() != null ? criteria.getTenantId() : requestInfo.getUserInfo().getTenantId();
            Set<String> serviceRequestIds = workflowService.getServiceRequestIdsByAssignee(requestInfo, tenantId, criteria.getAssignee());
            if (serviceRequestIds.isEmpty()) {
                return new ArrayList<>();
            }
            criteria.setServiceRequestIds(serviceRequestIds);
        }

        criteria.setIsPlainSearch(false);

        List<ServiceWrapper> serviceWrappers = repository.getServiceWrappers(criteria);

        if(CollectionUtils.isEmpty(serviceWrappers))
            return new ArrayList<>();;

        userService.enrichUsers(serviceWrappers, requestInfo);
        List<ServiceWrapper> enrichedServiceWrappers = workflowService.enrichWorkflow(requestInfo,serviceWrappers);

        String tenantIdForMdms = criteria.getTenantId() != null
                ? criteria.getTenantId() : requestInfo.getUserInfo().getTenantId();
        Map<String, ComplaintTemplateTypeConfig> configCache = buildConfigCache(requestInfo, tenantIdForMdms, enrichedServiceWrappers);
        applyDecryptOrMask(enrichedServiceWrappers, requestInfo, configCache);

        Map<Long, List<ServiceWrapper>> sortedWrappers = new TreeMap<>(Collections.reverseOrder());
        for(ServiceWrapper svc : enrichedServiceWrappers){
            if(sortedWrappers.containsKey(svc.getService().getAuditDetails().getCreatedTime())){
                sortedWrappers.get(svc.getService().getAuditDetails().getCreatedTime()).add(svc);
            }else{
                List<ServiceWrapper> serviceWrapperList = new ArrayList<>();
                serviceWrapperList.add(svc);
                sortedWrappers.put(svc.getService().getAuditDetails().getCreatedTime(), serviceWrapperList);
            }
        }
        List<ServiceWrapper> sortedServiceWrappers = new ArrayList<>();
        for(Long createdTimeDesc : sortedWrappers.keySet()){
            sortedServiceWrappers.addAll(sortedWrappers.get(createdTimeDesc));
        }
        return sortedServiceWrappers;
    }


    /**
     * Updates the complaint (used to forward the complaint from one application status to another)
     * @param request The request containing the complaint to be updated
     * @return
     */
    public ServiceRequest update(ServiceRequest request){
        String tenantId = request.getService().getTenantId();
        String fromState = request.getService().getApplicationStatus();
        Object mdmsData = mdmsUtils.mDMSCall(request);
        validator.validateUpdate(request, mdmsData);
        enrichmentService.enrichUpdateRequest(request);
        workflowService.updateWorkflowStatus(request);

        Service updateService = request.getService();
		Map<String, Object> existing = pgrUtils.extractAdditionalDetails(updateService.getAdditionalDetail());
		Map<String, Object> backend = new HashMap<>();
		backend.put("department", getDepartmentFromMDMS(request, mdmsData));
		backend.put("serviceName", getServiceNameFromMDMS(request, mdmsData));
		Map<String, Object> merged = pgrUtils.deepMerge(existing, backend);
		updateService.setAdditionalDetail(merged);

		// Extended attributes: validate → re-encrypt → sync contact details to User Service
		ExtendedAttributes updatedExt = updateService.getExtendedAttributes();
		ComplaintTemplateTypeConfig cfg = null;
		ExtendedAttributes plainExt = null;
		if (updatedExt != null) {
			if (updatedExt.getIsConfidential() == null) updatedExt.setIsConfidential(false);
			cfg = mdmsUtils.fetchComplaintTemplateTypeConfig(
					request.getRequestInfo(), tenantId, updatedExt.getCaseRelatedTo());
			if (cfg == null)
				throw new CustomException("INVALID_CASE_RELATED_TO",
						"No MDMS config found for caseRelatedTo: " + updatedExt.getCaseRelatedTo());
			extendedAttributesValidationService.validate(updatedExt, cfg, updateService);
			plainExt = updatedExt.copy(); // snapshot before encrypt — avoids decrypt round-trip for response
			updateService.setExtendedAttributes(
					encryptionDecryptionService.encrypt(updatedExt, cfg, tenantId));
			enrichmentService.enrichUserContactDetails(request);
		}

        complaintDomainEventService.publishWorkflowTransitionEvent(request, fromState);
        producer.push(tenantId, config.getUpdateTopic(), request);
        producer.push(tenantId, config.getInboxUpdateTopic(), request);

		if (plainExt != null)
			updateService.setExtendedAttributes(plainExt);

        return request;
    }

    /**
     * Returns the total number of comaplaints matching the given criteria
     * @param requestInfo The requestInfo of the search call
     * @param criteria The search criteria containg the params for which count is required
     * @return
     */
    public Integer count(RequestInfo requestInfo, RequestSearchCriteria criteria){
        criteria.setIsPlainSearch(false);
        Integer count = repository.getCount(criteria);
        return count;
    }


    public List<ServiceWrapper> plainSearch(RequestInfo requestInfo, RequestSearchCriteria criteria) {
        validator.validatePlainSearch(criteria);

        criteria.setIsPlainSearch(true);

        if(criteria.getLimit()==null)
            criteria.setLimit(config.getDefaultLimit());

        if(criteria.getOffset()==null)
            criteria.setOffset(config.getDefaultOffset());

        if(criteria.getLimit()!=null && criteria.getLimit() > config.getMaxLimit())
            criteria.setLimit(config.getMaxLimit());

        List<ServiceWrapper> serviceWrappers = repository.getServiceWrappers(criteria);

        if(CollectionUtils.isEmpty(serviceWrappers)){
            return new ArrayList<>();
        }

        userService.enrichUsers(serviceWrappers, requestInfo);
        List<ServiceWrapper> enrichedServiceWrappers = workflowService.enrichWorkflow(requestInfo, serviceWrappers);

        String tenantIdForMdms = criteria.getTenantId() != null ? criteria.getTenantId()
                : (requestInfo.getUserInfo() != null ? requestInfo.getUserInfo().getTenantId() : null);
        Map<String, ComplaintTemplateTypeConfig> configCache = buildConfigCache(requestInfo, tenantIdForMdms, enrichedServiceWrappers);
        applyDecryptOrMask(enrichedServiceWrappers, requestInfo, configCache);

        Map<Long, List<ServiceWrapper>> sortedWrappers = new TreeMap<>(Collections.reverseOrder());
        for(ServiceWrapper svc : enrichedServiceWrappers){
            if(sortedWrappers.containsKey(svc.getService().getAuditDetails().getCreatedTime())){
                sortedWrappers.get(svc.getService().getAuditDetails().getCreatedTime()).add(svc);
            }else{
                List<ServiceWrapper> serviceWrapperList = new ArrayList<>();
                serviceWrapperList.add(svc);
                sortedWrappers.put(svc.getService().getAuditDetails().getCreatedTime(), serviceWrapperList);
            }
        }
        List<ServiceWrapper> sortedServiceWrappers = new ArrayList<>();
        for(Long createdTimeDesc : sortedWrappers.keySet()){
            sortedServiceWrappers.addAll(sortedWrappers.get(createdTimeDesc));
        }
        return sortedServiceWrappers;
    }


	public Map<String, Integer> getDynamicData(String tenantId) {
		
		Map<String,Integer> dynamicData = repository.fetchDynamicData(tenantId);

		return dynamicData;
	}


	public int getComplaintTypes() {
		
		return Integer.valueOf(config.getComplaintTypes());
	}

    private boolean hasAnyRole(RequestInfo requestInfo, List<String> roleCodes) {
        if (requestInfo == null || requestInfo.getUserInfo() == null
                || requestInfo.getUserInfo().getRoles() == null) return false;
        return requestInfo.getUserInfo().getRoles().stream()
                .anyMatch(r -> roleCodes.contains(r.getCode()));
    }

    /** Fetches ComplaintTemplateTypeConfig per distinct caseRelatedTo in the result set. */
    private Map<String, ComplaintTemplateTypeConfig> buildConfigCache(
            RequestInfo requestInfo, String tenantId, List<ServiceWrapper> wrappers) {
        if (tenantId == null) return Collections.emptyMap();
        Set<String> categoryTypes = wrappers.stream()
                .map(w -> w.getService().getExtendedAttributes())
                .filter(Objects::nonNull)
                .map(ExtendedAttributes::getCaseRelatedTo)
                .filter(Objects::nonNull)
                .collect(Collectors.toSet());
        Map<String, ComplaintTemplateTypeConfig> cache = new HashMap<>();
        for (String cat : categoryTypes) {
            ComplaintTemplateTypeConfig cfg = mdmsUtils.fetchComplaintTemplateTypeConfig(requestInfo, tenantId, cat);
            if (cfg != null) cache.put(cat, cfg);
        }
        return cache;
    }

    /**
     * Decrypts or masks extendedAttributes for each wrapper.
     * All-or-nothing: confidential + no viewer role → maskAll. Creator always decrypts.
     * If MDMS config is gone for a confidential complaint, mask to avoid leaking ciphertext.
     */
    private void applyDecryptOrMask(List<ServiceWrapper> wrappers, RequestInfo requestInfo,
                                     Map<String, ComplaintTemplateTypeConfig> configCache) {
        String callerUuid = requestInfo.getUserInfo() != null ? requestInfo.getUserInfo().getUuid() : null;
        for (ServiceWrapper wrapper : wrappers) {
            Service svc = wrapper.getService();
            if (svc.getExtendedAttributes() == null) continue;
            ComplaintTemplateTypeConfig cfg = configCache.get(svc.getExtendedAttributes().getCaseRelatedTo());
            if (cfg == null) {
                if (svc.getExtendedAttributes().getIsConfidentialSafe())
                    encryptionDecryptionService.maskAll(svc.getExtendedAttributes());
                continue;
            }
            List<String> viewerRoles = !CollectionUtils.isEmpty(cfg.getAllowedViewerRoles())
                    ? cfg.getAllowedViewerRoles() : List.of(ROLE_CONFIDENTIAL_VIEWER);
            boolean isCreator = callerUuid != null && callerUuid.equals(svc.getAccountId());
            if (svc.getExtendedAttributes().getIsConfidentialSafe() && !isCreator
                    && !hasAnyRole(requestInfo, viewerRoles)) {
                encryptionDecryptionService.maskAll(svc.getExtendedAttributes());
            } else {
                encryptionDecryptionService.decrypt(svc.getExtendedAttributes(), cfg);
            }
        }
    }

    private String getDepartmentFromMDMS(ServiceRequest request, Object mdmsData) {

        String serviceCode = request.getService().getServiceCode();
        String jsonPath = MDMS_DEPARTMENT_SEARCH.replace("{SERVICEDEF}", serviceCode);

        try {
            List<String> departmentCodeList = JsonPath.read(mdmsData, jsonPath);

            if (departmentCodeList == null || departmentCodeList.isEmpty()) {
                log.warn("No department found in MDMS for service: {}. Defaulting to NA.", serviceCode);
                return "NA";
            }

            String departmentCode = departmentCodeList.get(0);
            String nameJsonPath = MDMS_DEPARTMENT_NAME_SEARCH.replace("{CODE}", departmentCode);

            try {
                List<String> departmentNameList = JsonPath.read(mdmsData, nameJsonPath);
                if (departmentNameList != null && !departmentNameList.isEmpty()) {
                    return departmentNameList.get(0);
                }
            } catch (Exception e) {
                log.warn("Failed to parse MDMS response for department name lookup, code: {}. Falling back to code.", departmentCode, e);
            }

            return departmentCode;
        } catch (Exception e) {
            log.warn("Failed to parse MDMS response for department lookup, service: {}. Defaulting to NA.", serviceCode, e);
            return "NA";
        }
    }

    private String getServiceNameFromMDMS(ServiceRequest request, Object mdmsData) {

        String serviceCode = request.getService().getServiceCode();
        String jsonPath = MDMS_SERVICENAME_SEARCH.replace("{SERVICEDEF}", serviceCode);

        try {
            List<String> names = JsonPath.read(mdmsData, jsonPath);

            if (names == null || names.isEmpty()) {
                log.warn("No service name found in MDMS for service: {}. Falling back to serviceCode.", serviceCode);
                return serviceCode;
            }

            return names.get(0);
        } catch (Exception e) {
            log.warn("Failed to parse MDMS response for service name lookup, service: {}. Falling back to serviceCode.", serviceCode, e);
            return serviceCode;
        }
    }

}
