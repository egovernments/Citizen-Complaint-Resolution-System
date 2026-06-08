package org.egov.pgr.util;

import org.egov.pgr.web.models.AuditDetails;
import org.egov.pgr.web.models.Service;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Component
public class PGRUtils {

    public AuditDetails getAuditDetails(String by, Service service, boolean isCreate) {
        long now = System.currentTimeMillis();
        if (isCreate) {
            return AuditDetails.builder()
                    .createdBy(by).lastModifiedBy(by)
                    .createdTime(now).lastModifiedTime(now)
                    .build();
        }
        return AuditDetails.builder()
                .createdBy(service.getAuditDetails().getCreatedBy())
                .lastModifiedBy(by)
                .createdTime(service.getAuditDetails().getCreatedTime())
                .lastModifiedTime(now)
                .build();
    }

    /**
     * In DIGIT 3.0 we use a single schema — no multi-state placeholder replacement needed.
     * Kept for compatibility with DashboardRepository queries.
     */
    public String replaceSchemaPlaceholder(String query, String tenantId) {
        return query;
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> deepMerge(Map<String, Object> existing, Map<String, Object> incoming) {
        for (Map.Entry<String, Object> entry : incoming.entrySet()) {
            String key = entry.getKey();
            Object newValue = entry.getValue();
            Object oldValue = existing.get(key);

            if (oldValue instanceof Map && newValue instanceof Map) {
                existing.put(key, deepMerge(
                        new HashMap<>((Map<String, Object>) oldValue),
                        (Map<String, Object>) newValue));
            } else if (oldValue instanceof List && newValue instanceof List) {
                List<Object> merged = new ArrayList<>((List<Object>) oldValue);
                merged.addAll((List<Object>) newValue);
                existing.put(key, merged);
            } else {
                existing.put(key, newValue);
            }
        }
        return existing;
    }

    public Map<String, Object> extractAdditionalDetails(Object additionalDetail) {
        Map<String, Object> result = new HashMap<>();
        if (additionalDetail instanceof Map<?, ?> map) {
            for (Map.Entry<?, ?> entry : map.entrySet()) {
                if (entry.getKey() instanceof String key) {
                    result.put(key, entry.getValue());
                }
            }
        }
        return result;
    }
}
