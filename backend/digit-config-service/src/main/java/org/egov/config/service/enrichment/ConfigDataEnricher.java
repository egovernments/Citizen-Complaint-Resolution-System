package org.egov.config.service.enrichment;

import lombok.RequiredArgsConstructor;
import org.egov.config.config.ApplicationConfig;
import org.egov.config.utils.UniqueIdentifierUtil;
import org.egov.config.web.model.*;
import org.json.JSONObject;
import org.springframework.stereotype.Component;

import java.util.UUID;

@Component
@RequiredArgsConstructor
public class ConfigDataEnricher {

    private final ApplicationConfig applicationConfig;

    public void enrichCreate(ConfigDataRequest request, JSONObject schema) {
        ConfigData entry = request.getConfigData();

        entry.setId(UUID.randomUUID().toString());

        if (entry.getIsActive() == null) {
            entry.setIsActive(true);
        }

        if (schema != null) {
            entry.setUniqueIdentifier(
                    UniqueIdentifierUtil.computeFromSchema(schema, entry.getData()));
        }

        String userId = resolveUserId(request.getRequestInfo());
        long now = System.currentTimeMillis();
        entry.setAuditDetails(AuditDetails.builder()
                .createdBy(userId)
                .createdTime(now)
                .lastModifiedBy(userId)
                .lastModifiedTime(now)
                .build());
    }

    public void enrichUpdate(ConfigDataRequest request) {
        ConfigData entry = request.getConfigData();

        String userId = resolveUserId(request.getRequestInfo());
        long now = System.currentTimeMillis();

        AuditDetails audit = entry.getAuditDetails();
        if (audit == null) {
            audit = AuditDetails.builder().build();
        }
        audit.setLastModifiedBy(userId);
        audit.setLastModifiedTime(now);
        entry.setAuditDetails(audit);
    }

    public void enrichSearchDefaults(ConfigDataCriteria criteria) {
        if (criteria.getLimit() == null) {
            criteria.setLimit(applicationConfig.getDefaultLimit());
        }
        if (criteria.getOffset() == null) {
            criteria.setOffset(applicationConfig.getDefaultOffset());
        }
    }

    private String resolveUserId(RequestInfo requestInfo) {
        if (requestInfo != null && requestInfo.getUserInfo() != null) {
            return requestInfo.getUserInfo().getUuid();
        }
        return null;
    }
}
