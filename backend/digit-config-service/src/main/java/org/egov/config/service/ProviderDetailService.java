package org.egov.config.service;

import lombok.RequiredArgsConstructor;
import org.egov.config.config.ApplicationConfig;
import org.egov.config.repository.ProviderDetailRepository;
import org.egov.config.utils.CustomException;
import org.egov.config.web.model.*;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class ProviderDetailService {

    private final ProviderDetailRepository repository;
    private final ApplicationConfig applicationConfig;

    public ProviderDetail create(ProviderDetailRequest request) {
        ProviderDetail entry = request.getProviderDetail();
        validateCreate(entry);
        enrichCreate(entry, request.getRequestInfo());
        repository.save(entry);
        return entry;
    }

    public ProviderDetail update(ProviderDetailRequest request) {
        ProviderDetail entry = request.getProviderDetail();
        if (entry.getId() == null || entry.getId().isBlank()) {
            throw new CustomException("INVALID_ID", "id is required for update");
        }
        List<ProviderDetail> existing = repository.search(ProviderDetailSearchCriteria.builder()
                .ids(List.of(entry.getId())).limit(1).offset(0).build());
        if (existing.isEmpty()) {
            throw new CustomException("PROVIDER_NOT_FOUND", "No provider detail found with id=" + entry.getId());
        }
        enrichUpdate(entry, request.getRequestInfo());
        repository.update(entry);
        return entry;
    }

    public List<ProviderDetail> search(ProviderDetailSearchRequest request) {
        enrichSearchDefaults(request.getCriteria());
        return repository.search(request.getCriteria());
    }

    public long count(ProviderDetailSearchCriteria criteria) {
        return repository.count(criteria);
    }

    private void validateCreate(ProviderDetail entry) {
        if (entry.getProviderName() == null || entry.getProviderName().isBlank()) {
            throw new CustomException("INVALID_PROVIDER_NAME", "providerName is required");
        }
        if (entry.getTenantId() == null || entry.getTenantId().isBlank()) {
            throw new CustomException("INVALID_TENANT_ID", "tenantId is required");
        }
        if (entry.getValue() == null) {
            throw new CustomException("INVALID_VALUE", "value is required");
        }
    }

    private void enrichCreate(ProviderDetail entry, RequestInfo requestInfo) {
        entry.setId(UUID.randomUUID().toString());
        if (entry.getEnabled() == null) {
            entry.setEnabled(true);
        }
        String userId = requestInfo.getUserInfo() != null ? requestInfo.getUserInfo().getUuid() : null;
        long now = System.currentTimeMillis();
        entry.setAuditDetails(AuditDetails.builder()
                .createdBy(userId).createdTime(now)
                .lastModifiedBy(userId).lastModifiedTime(now)
                .build());
    }

    private void enrichUpdate(ProviderDetail entry, RequestInfo requestInfo) {
        String userId = requestInfo.getUserInfo() != null ? requestInfo.getUserInfo().getUuid() : null;
        long now = System.currentTimeMillis();
        AuditDetails audit = entry.getAuditDetails();
        if (audit == null) {
            audit = AuditDetails.builder().build();
        }
        audit.setLastModifiedBy(userId);
        audit.setLastModifiedTime(now);
        entry.setAuditDetails(audit);
    }

    private void enrichSearchDefaults(ProviderDetailSearchCriteria criteria) {
        if (criteria.getLimit() == null) {
            criteria.setLimit(applicationConfig.getDefaultLimit());
        }
        if (criteria.getOffset() == null) {
            criteria.setOffset(applicationConfig.getDefaultOffset());
        }
    }
}
