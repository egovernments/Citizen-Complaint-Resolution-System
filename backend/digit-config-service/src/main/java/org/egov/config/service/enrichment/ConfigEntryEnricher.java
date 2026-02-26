package org.egov.config.service.enrichment;

import lombok.RequiredArgsConstructor;
import org.egov.config.config.ApplicationConfig;
import org.egov.config.web.model.*;
import org.springframework.stereotype.Component;

import java.util.UUID;

@Component
@RequiredArgsConstructor
public class ConfigEntryEnricher {

    private final ApplicationConfig applicationConfig;

    public void enrichCreate(ConfigEntryCreateRequest request) {
        ConfigEntry entry = request.getEntry();
        RequestInfo requestInfo = request.getRequestInfo();

        entry.setId(UUID.randomUUID().toString());
        entry.setRevision(1);

        if (entry.getEnabled() == null) {
            entry.setEnabled(true);
        }

        String userId = requestInfo.getUserInfo() != null ? requestInfo.getUserInfo().getUuid() : null;
        long now = System.currentTimeMillis();
        entry.setAuditDetails(AuditDetails.builder()
                .createdBy(userId)
                .createdTime(now)
                .lastModifiedBy(userId)
                .lastModifiedTime(now)
                .build());
    }

    public void enrichUpdate(ConfigEntryUpdateRequest request) {
        ConfigEntry entry = request.getEntry();
        RequestInfo requestInfo = request.getRequestInfo();

        entry.setRevision(entry.getRevision() + 1);

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

    public void enrichSearchCriteria(ConfigEntrySearchCriteria criteria) {
        if (criteria.getLimit() == null) {
            criteria.setLimit(applicationConfig.getDefaultLimit());
        }
        if (criteria.getOffset() == null) {
            criteria.setOffset(applicationConfig.getDefaultOffset());
        }
    }
}
