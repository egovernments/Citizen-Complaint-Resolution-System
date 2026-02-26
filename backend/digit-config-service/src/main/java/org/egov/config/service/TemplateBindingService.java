package org.egov.config.service;

import lombok.RequiredArgsConstructor;
import org.egov.config.config.ApplicationConfig;
import org.egov.config.repository.TemplateBindingRepository;
import org.egov.config.utils.CustomException;
import org.egov.config.utils.ResponseUtil;
import org.egov.config.web.model.*;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class TemplateBindingService {

    private final TemplateBindingRepository repository;
    private final ApplicationConfig applicationConfig;

    public TemplateBinding create(TemplateBindingRequest request) {
        TemplateBinding entry = request.getTemplateBinding();
        validateCreate(entry);
        enrichCreate(entry, request.getRequestInfo());
        repository.save(entry);
        return entry;
    }

    public TemplateBinding update(TemplateBindingRequest request) {
        TemplateBinding entry = request.getTemplateBinding();
        if (entry.getId() == null || entry.getId().isBlank()) {
            throw new CustomException("INVALID_ID", "id is required for update");
        }
        List<TemplateBinding> existing = repository.search(TemplateBindingSearchCriteria.builder()
                .ids(List.of(entry.getId())).limit(1).offset(0).build());
        if (existing.isEmpty()) {
            throw new CustomException("BINDING_NOT_FOUND", "No template binding found with id=" + entry.getId());
        }
        enrichUpdate(entry, request.getRequestInfo());
        repository.update(entry);
        return entry;
    }

    public List<TemplateBinding> search(TemplateBindingSearchRequest request) {
        enrichSearchDefaults(request.getCriteria());
        return repository.search(request.getCriteria());
    }

    public long count(TemplateBindingSearchCriteria criteria) {
        return repository.count(criteria);
    }

    public TemplateBindingResponse resolve(TemplateBindingResolveRequest request) {
        TemplateBindingResolveRequest.ResolveParams params = request.getResolveRequest();
        List<String> tenantChain = buildTenantChain(params.getTenantId());

        TemplateBinding binding = repository.resolve(params.getEventName(), tenantChain);
        if (binding == null) {
            throw new CustomException("BINDING_NOT_RESOLVED",
                    "No template binding found for eventName=" + params.getEventName()
                            + " tenantId=" + params.getTenantId());
        }

        return TemplateBindingResponse.builder()
                .responseInfo(ResponseUtil.createResponseInfo(request.getRequestInfo(), true))
                .templateBinding(binding)
                .build();
    }

    private void validateCreate(TemplateBinding entry) {
        if (entry.getTemplateId() == null || entry.getTemplateId().isBlank()) {
            throw new CustomException("INVALID_TEMPLATE_ID", "templateId is required");
        }
        if (entry.getProviderId() == null || entry.getProviderId().isBlank()) {
            throw new CustomException("INVALID_PROVIDER_ID", "providerId is required");
        }
        if (entry.getEventName() == null || entry.getEventName().isBlank()) {
            throw new CustomException("INVALID_EVENT_NAME", "eventName is required");
        }
        if (entry.getTenantId() == null || entry.getTenantId().isBlank()) {
            throw new CustomException("INVALID_TENANT_ID", "tenantId is required");
        }
    }

    private void enrichCreate(TemplateBinding entry, RequestInfo requestInfo) {
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

    private void enrichUpdate(TemplateBinding entry, RequestInfo requestInfo) {
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

    private void enrichSearchDefaults(TemplateBindingSearchCriteria criteria) {
        if (criteria.getLimit() == null) {
            criteria.setLimit(applicationConfig.getDefaultLimit());
        }
        if (criteria.getOffset() == null) {
            criteria.setOffset(applicationConfig.getDefaultOffset());
        }
    }

    private List<String> buildTenantChain(String tenantId) {
        List<String> chain = new ArrayList<>();
        if (tenantId != null) {
            chain.add(tenantId);
            String t = tenantId;
            while (t.contains(".")) {
                t = t.substring(0, t.lastIndexOf('.'));
                chain.add(t);
            }
        }
        chain.add("*");
        return chain;
    }
}
