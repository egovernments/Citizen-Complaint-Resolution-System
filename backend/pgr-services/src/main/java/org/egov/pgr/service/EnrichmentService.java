package org.egov.pgr.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.digit.services.idgen.IdGenClient;
import org.digit.services.idgen.model.IdGenGenerateRequest;
import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.web.models.AuditDetails;
import org.egov.pgr.web.models.RequestSearchCriteria;
import org.egov.pgr.web.models.Service;
import org.egov.pgr.web.models.ServiceRequest;
import org.springframework.util.CollectionUtils;
import org.springframework.util.ObjectUtils;
import org.springframework.util.StringUtils;

import java.util.Map;
import java.util.UUID;

import static org.egov.pgr.util.PGRConstants.USERTYPE_CITIZEN;

@Slf4j
@org.springframework.stereotype.Service
@RequiredArgsConstructor
public class EnrichmentService {

    private final IdGenClient idGenClient;
    private final PGRConfiguration config;
    private final UserService userService;

    public void enrichCreateRequest(ServiceRequest request) {
        Service service = request.getService();
        String userId = request.getUserId();
        String userType = resolveUserType(request);

        // Citizen filing their own complaint — accountId = their own UUID
        if (USERTYPE_CITIZEN.equalsIgnoreCase(userType) && StringUtils.hasText(userId)) {
            service.setAccountId(userId);
        }

        // Resolve / create individual record for the citizen
        userService.callUserService(request);

        // Fall back: set accountId from citizen object if still empty
        if (ObjectUtils.isEmpty(service.getAccountId()) && service.getCitizen() != null) {
            service.setAccountId(service.getCitizen().getUuid());
        }

        // Audit details
        service.setAuditDetails(buildAuditDetails(userId, true));
        service.setId(UUID.randomUUID().toString());
        service.setActive(true);

        // IDs for address and documents
        if (service.getAddress() != null) {
            service.getAddress().setId(UUID.randomUUID().toString());
            service.getAddress().setTenantId(service.getTenantId());
        }

        if (!CollectionUtils.isEmpty(service.getDocuments())) {
            service.getDocuments().forEach(doc -> {
                if (ObjectUtils.isEmpty(doc.getId())) {
                    doc.setId(UUID.randomUUID().toString());
                }
            });
        }

        if (request.getWorkflow() != null && !CollectionUtils.isEmpty(request.getWorkflow().getVerificationDocuments())) {
            request.getWorkflow().getVerificationDocuments().forEach(doc -> {
                if (ObjectUtils.isEmpty(doc.getId())) {
                    doc.setId(UUID.randomUUID().toString());
                }
            });
        }

        // Generate service request ID via IdGen
        String serviceRequestId = generateServiceRequestId();
        service.setServiceRequestId(serviceRequestId);
    }

    public void enrichUpdateRequest(ServiceRequest request) {
        Service service = request.getService();
        String userId = request.getUserId();

        // Update lastModified only
        AuditDetails existing = service.getAuditDetails();
        AuditDetails updated = AuditDetails.builder()
                .createdBy(existing != null ? existing.getCreatedBy() : userId)
                .createdTime(existing != null ? existing.getCreatedTime() : System.currentTimeMillis())
                .lastModifiedBy(userId)
                .lastModifiedTime(System.currentTimeMillis())
                .build();
        service.setAuditDetails(updated);

        // Assign IDs to any new documents added during update
        if (!CollectionUtils.isEmpty(service.getDocuments())) {
            service.getDocuments().forEach(doc -> {
                if (ObjectUtils.isEmpty(doc.getId())) {
                    doc.setId(UUID.randomUUID().toString());
                }
            });
        }

        userService.callUserService(request);
    }

    public void enrichSearchRequest(ServiceRequest request, RequestSearchCriteria criteria) {
        String userType = resolveUserType(request);
        String userId = request.getUserId();

        // Default search for citizen: use their own mobile number
        if (criteria.isEmpty() && USERTYPE_CITIZEN.equalsIgnoreCase(userType)) {
            criteria.setAccountId(userId);
        }

        String tenantId = criteria.getTenantId() != null ? criteria.getTenantId() : request.getTenantId();

        if (StringUtils.hasText(criteria.getMobileNumber())) {
            userService.enrichUserIds(tenantId, criteria);
        }

        if (criteria.getLimit() == null) criteria.setLimit(config.getDefaultLimit());
        if (criteria.getOffset() == null) criteria.setOffset(config.getDefaultOffset());
        if (criteria.getLimit() > config.getMaxLimit()) criteria.setLimit(config.getMaxLimit());
    }

    private String generateServiceRequestId() {
        IdGenGenerateRequest idGenRequest = IdGenGenerateRequest.builder()
                .templateCode(config.getIdGenTemplateCode())
                .variables(Map.of("ORG", "pgr"))
                .build();
        return idGenClient.generateId(idGenRequest);
    }

    private AuditDetails buildAuditDetails(String userId, boolean isCreate) {
        long now = System.currentTimeMillis();
        return AuditDetails.builder()
                .createdBy(userId)
                .createdTime(now)
                .lastModifiedBy(userId)
                .lastModifiedTime(now)
                .build();
    }

    private String resolveUserType(ServiceRequest request) {
        if (request.getRoles() == null) return "CITIZEN";
        boolean isEmployee = request.getRoles().stream()
                .anyMatch(r -> r.equalsIgnoreCase("EMPLOYEE") || r.equalsIgnoreCase("GRO_EMPLOYEE")
                        || r.equalsIgnoreCase("DGRO"));
        return isEmployee ? "EMPLOYEE" : "CITIZEN";
    }
}
