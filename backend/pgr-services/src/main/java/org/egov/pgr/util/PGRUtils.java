package org.egov.pgr.util;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.egov.common.utils.MultiStateInstanceUtil;
import org.egov.pgr.web.models.AuditDetails;
import org.egov.pgr.web.models.Service;
import org.egov.tracer.model.CustomException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

@Component
public class PGRUtils {


    private MultiStateInstanceUtil multiStateInstanceUtil;

    private ObjectMapper objectMapper;

    @Autowired
    public PGRUtils(MultiStateInstanceUtil multiStateInstanceUtil, ObjectMapper objectMapper) {
        this.multiStateInstanceUtil = multiStateInstanceUtil;
        this.objectMapper = objectMapper;
    }

    /**
     * Method to return auditDetails for create/update flows
     *
     * @param by
     * @param isCreate
     * @return AuditDetails
     */
    public AuditDetails getAuditDetails(String by, Service service, Boolean isCreate) {
        Long time = System.currentTimeMillis();
        if(isCreate)
            return AuditDetails.builder().createdBy(by).lastModifiedBy(by).createdTime(time).lastModifiedTime(time).build();
        else
            return AuditDetails.builder().createdBy(service.getAuditDetails().getCreatedBy()).lastModifiedBy(by)
                    .createdTime(service.getAuditDetails().getCreatedTime()).lastModifiedTime(time).build();
    }

    /**
     * Method to fetch the state name from the tenantId
     *
     * @param query
     * @param tenantId
     * @return
     */
    public String replaceSchemaPlaceholder(String query, String tenantId) {

        String finalQuery = null;

        try {
            finalQuery = multiStateInstanceUtil.replaceSchemaPlaceholder(query, tenantId);
        }
        catch (Exception e){
            throw new CustomException("INVALID_TENANTID","Invalid tenantId: "+tenantId);
        }
        return finalQuery;
    }
    
    @SuppressWarnings({ "unused", "unchecked" })
	public Map<String, Object> deepMerge(Map<String, Object> existing, Map<String, Object> incoming) {
        for (Map.Entry<String, Object> entry : incoming.entrySet()) {
            String key = entry.getKey();
            Object newValue = entry.getValue();
            Object oldValue = existing.get(key);

            if (oldValue instanceof Map && newValue instanceof Map) {
                // Recursive merge for nested objects
                Map<String, Object> mergedChild = deepMerge(
                        new HashMap<>((Map<String, Object>) oldValue),
                        (Map<String, Object>) newValue
                );
                existing.put(key, mergedChild);

            } else if (oldValue instanceof List && newValue instanceof List) {
                // Merge arrays (append strategy)
                List<Object> mergedList = new ArrayList<>((List<Object>) oldValue);
                mergedList.addAll((List<Object>) newValue);
                existing.put(key, mergedList);

            } else {
                // Override for primitive / different types
                existing.put(key, newValue);
            }
        }
        return existing;
    }
    
    public Map<String, Object> extractAdditionalDetails(Object additionalDetail) {
        if (additionalDetail == null) {
            return new HashMap<>();
        }

        if (additionalDetail instanceof Map<?, ?> map) {
            Map<String, Object> result = new HashMap<>();
            for (Map.Entry<?, ?> entry : map.entrySet()) {
                if (entry.getKey() instanceof String key) {
                    result.put(key, entry.getValue());
                }
            }
            return result;
        }

        // Handle JsonNode (returned by PGRRowMapper from DB reads) and any other non-Map type.
        try {
            @SuppressWarnings("unchecked")
            Map<String, Object> converted = objectMapper.convertValue(additionalDetail, Map.class);
            return converted != null ? new HashMap<>(converted) : new HashMap<>();
        } catch (Exception e) {
            return new HashMap<>();
        }
    }

}
