package org.egov.pgr.service;

import static org.egov.pgr.util.PGRConstants.USERTYPE_CITIZEN;

import java.util.List;
import java.util.UUID;
import java.util.stream.Collectors;

import org.egov.common.contract.request.RequestInfo;
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

    @Autowired
    public EnrichmentService(PGRUtils utils, IdGenRepository idGenRepository, PGRConfiguration config, UserService userService) {
        this.utils = utils;
        this.idGenRepository = idGenRepository;
        this.config = config;
        this.userService = userService;
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

        scopeSearchCriteria(requestInfo, criteria);

        if(criteria.getLimit()==null)
            criteria.setLimit(config.getDefaultLimit());

        if(criteria.getOffset()==null)
            criteria.setOffset(config.getDefaultOffset());

        if(criteria.getLimit()!=null && criteria.getLimit() > config.getMaxLimit())
            criteria.setLimit(config.getMaxLimit());

    }

    /**
     * Derives the mobileNumber-lookup half of a search's userIds. Split out of
     * {@link #enrichSearchRequest} so the /_count path can apply the SAME scoping without also
     * picking up the pagination defaults — the count query wraps the search query including its
     * LIMIT, so defaulting the limit there would cap the returned count.
     *
     * <p>Record-level OWNERSHIP (a citizen may only see their own complaints) is no longer decided
     * here: it comes entirely from egov-accesscontrol's resolved scope ({@code citizenUuids}),
     * applied as a SQL predicate alongside everything else in {@code PGRQueryBuilder#applyScope}.
     * This method only ever narrows {@code userIds} to a mobileNumber's matching accounts — safe
     * regardless of who's asking, because that access-control ownership predicate is ANDed with it:
     * a citizen who submits someone else's mobileNumber gets an empty intersection, never their
     * complaints, and never a stranger's.
     *
     * @param requestInfo the authenticated principal
     * @param criteria the search criteria, mutated in place
     */
    public void scopeSearchCriteria(RequestInfo requestInfo, RequestSearchCriteria criteria){

        // userIds is the mobileNumber-lookup axis (`ser.accountId IN (userIds)`) and is derived here
        // from the search criteria — it is NEVER an input. RequestsApiController's @InitBinder already
        // disallows binding it (@JsonIgnore alone does NOT stop @ModelAttribute query-param binding),
        // so this is the service-layer backstop: any entry point added without that binder config
        // would otherwise let a client-supplied userIds ride straight into the clause. Clearing it
        // here keeps this axis true by construction rather than by convention.
        criteria.setUserIds(null);

        if (criteria.getMobileNumber() != null) {
            String tenantId = criteria.getTenantId();
            if (tenantId == null && requestInfo != null && requestInfo.getUserInfo() != null) {
                tenantId = requestInfo.getUserInfo().getTenantId();
            }
            if (tenantId != null) {
                userService.enrichUserIds(tenantId, criteria);
            }
        }
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
