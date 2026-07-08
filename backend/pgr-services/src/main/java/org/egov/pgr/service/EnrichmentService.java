package org.egov.pgr.service;

import static org.egov.pgr.util.PGRConstants.USERTYPE_CITIZEN;

import java.util.Collections;
import java.util.List;
import java.util.UUID;
import java.util.stream.Collectors;

import org.egov.common.contract.request.RequestInfo;
import org.egov.pgr.analytics.PrincipalScopeResolver;
import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.repository.IdGenRepository;
import org.egov.pgr.util.PGRUtils;
import org.egov.pgr.web.models.AuditDetails;
import org.egov.pgr.web.models.ExtendedAttributes;
import org.egov.pgr.web.models.RequestSearchCriteria;
import org.egov.pgr.web.models.Service;
import org.egov.pgr.web.models.ServiceRequest;
import org.egov.pgr.web.models.Workflow;
import org.egov.pgr.web.models.Idgen.IdResponse;
import org.egov.tracer.model.CustomException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.util.CollectionUtils;
import org.springframework.util.ObjectUtils;

@org.springframework.stereotype.Service
public class EnrichmentService {


    private PGRUtils utils;

    private IdGenRepository idGenRepository;

    private PGRConfiguration config;

    private UserService userService;

    private PrincipalScopeResolver principalScopeResolver;

    @Autowired
    public EnrichmentService(PGRUtils utils, IdGenRepository idGenRepository, PGRConfiguration config, UserService userService, PrincipalScopeResolver principalScopeResolver) {
        this.utils = utils;
        this.idGenRepository = idGenRepository;
        this.config = config;
        this.userService = userService;
        this.principalScopeResolver = principalScopeResolver;
    }


    /**
     * Enriches the create request with auditDetails. uuids and custom ids from idGen service
     * @param serviceRequest The create request
     */
    public void enrichCreateRequest(ServiceRequest serviceRequest){

        RequestInfo requestInfo = serviceRequest.getRequestInfo();
        Service service = serviceRequest.getService();
        Workflow workflow = serviceRequest.getWorkflow();
        String tenantId = service.getTenantId();

        // Enrich accountId of the logged in citizen
        if(requestInfo.getUserInfo().getType().equalsIgnoreCase(USERTYPE_CITIZEN))
            serviceRequest.getService().setAccountId(requestInfo.getUserInfo().getUuid());

        userService.callUserService(serviceRequest);


        AuditDetails auditDetails = utils.getAuditDetails(requestInfo.getUserInfo().getUuid(), service,true);

        service.setAuditDetails(auditDetails);
        service.setId(UUID.randomUUID().toString());
        service.getAddress().setId(UUID.randomUUID().toString());
        service.getAddress().setTenantId(tenantId);
        service.setActive(true);

        if(workflow.getVerificationDocuments()!=null){
            workflow.getVerificationDocuments().forEach(document -> {
                document.setId(UUID.randomUUID().toString());
            });
        }

        // Enrich service-level documents
        if(service.getDocuments()!=null){
            service.getDocuments().forEach(document -> {
                document.setId(UUID.randomUUID().toString());
            });
        }

        if(ObjectUtils.isEmpty(service.getAccountId()))
            service.setAccountId(service.getCitizen().getUuid());

        List<String> customIds = getIdList(requestInfo,tenantId,config.getServiceRequestIdGenName(),config.getServiceRequestIdGenFormat(),1);

        service.setServiceRequestId(customIds.get(0));


    }


    /**
     * Enriches the update request (updates the lastModifiedTime in auditDetails0
     * @param serviceRequest The update request
     */
    public void enrichUpdateRequest(ServiceRequest serviceRequest){

        RequestInfo requestInfo = serviceRequest.getRequestInfo();
        Service service = serviceRequest.getService();
        AuditDetails auditDetails = utils.getAuditDetails(requestInfo.getUserInfo().getUuid(), service,false);

        service.setAuditDetails(auditDetails);

        // Enrich new service-level documents added during update
        if(service.getDocuments()!=null){
            service.getDocuments().forEach(document -> {
                if(ObjectUtils.isEmpty(document.getId())){
                    document.setId(UUID.randomUUID().toString());
                }
            });
        }

        userService.callUserService(serviceRequest);
    }

    /**
     * Enriches the search criteria in case of default search and enriches the userIds from mobileNumber in case of seach based on mobileNumber.
     * Also sets the default limit and offset if none is provided
     * @param requestInfo
     * @param criteria
     */
    public void enrichSearchRequest(RequestInfo requestInfo, RequestSearchCriteria criteria){

        // CCRS #1071: a pure citizen may only see their OWN complaints. The query builder scopes
        // results with `ser.accountId IN (userIds)`, so force userIds to the authenticated uuid and
        // drop any client-supplied mobileNumber. Without this a citizen could search by another
        // user's mobileNumber (reading their complaints — an IDOR) or omit all filters and read
        // every complaint (unscoped). Employees / internal principals are unaffected and may still
        // look up complaints by mobileNumber.
        if (principalScopeResolver.isPureCitizen(requestInfo)) {
            criteria.setUserIds(Collections.singleton(requestInfo.getUserInfo().getUuid()));
            criteria.setMobileNumber(null);
        } else if (criteria.getMobileNumber() != null) {
            String tenantId = (criteria.getTenantId()!=null) ? criteria.getTenantId() : requestInfo.getUserInfo().getTenantId();
            userService.enrichUserIds(tenantId, criteria);
        }

        if(criteria.getLimit()==null)
            criteria.setLimit(config.getDefaultLimit());

        if(criteria.getOffset()==null)
            criteria.setOffset(config.getDefaultOffset());

        if(criteria.getLimit()!=null && criteria.getLimit() > config.getMaxLimit())
            criteria.setLimit(config.getMaxLimit());

    }


    public void enrichUserContactDetails(ServiceRequest request) {
        ExtendedAttributes ext = request.getService().getExtendedAttributes();
        if (ext == null) return;

        String email   = ext.getEmail();
        String address = ext.getComplainantAddress();

        // Null out fields that route to User Service — must not be written to the JSONB column
        ext.setEmail(null);
        ext.setComplainantAddress(null);

        if (email == null && address == null) return;

        userService.updateUserContactDetails(
                request.getService().getAccountId(),
                email,
                address,
                request.getService().getTenantId(),
                request.getRequestInfo());
    }


    /**
     * Returns a list of numbers generated from idgen
     *
     * @param requestInfo RequestInfo from the request
     * @param tenantId    tenantId of the city
     * @param idKey       code of the field defined in application properties for which ids are generated for
     * @param idformat    format in which ids are to be generated
     * @param count       Number of ids to be generated
     * @return List of ids generated using idGen service
     */
    private List<String> getIdList(RequestInfo requestInfo, String tenantId, String idKey,
                                   String idformat, int count) {
        List<IdResponse> idResponses = idGenRepository.getId(requestInfo, tenantId, idKey, idformat, count).getIdResponses();

        if (CollectionUtils.isEmpty(idResponses))
            throw new CustomException("IDGEN ERROR", "No ids returned from idgen Service");

        return idResponses.stream()
                .map(IdResponse::getId).collect(Collectors.toList());
    }


}
