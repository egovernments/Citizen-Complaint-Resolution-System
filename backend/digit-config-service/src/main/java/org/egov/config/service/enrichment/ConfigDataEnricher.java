package org.egov.config.service.enrichment;

import com.fasterxml.jackson.databind.JsonNode;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.egov.config.client.CryptoClient;
import org.egov.config.config.ApplicationConfig;
import org.egov.config.utils.CustomException;
import org.egov.config.utils.SecurityFieldsUtil;
import org.egov.config.utils.UniqueIdentifierUtil;
import org.egov.config.web.model.*;
import org.json.JSONObject;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

@Component
@Slf4j
@RequiredArgsConstructor
public class ConfigDataEnricher {

    private final ApplicationConfig applicationConfig;
    private final SecurityFieldsUtil securityFieldsUtil;
    private final CryptoClient cryptoClient;

    @Value("${crypto.service.enabled:true}")
    private boolean encryptionEnabled;

    public void enrichCreate(ConfigDataRequest request, JSONObject schema) {
        ConfigData entry = request.getConfigData();

        entry.setId(UUID.randomUUID().toString());

        if (entry.getIsActive() == null) {
            entry.setIsActive(true);
        }

        // Compute unique identifier BEFORE encryption (using original data)
        if (schema != null) {
            entry.setUniqueIdentifier(
                    UniqueIdentifierUtil.computeFromSchema(schema, entry.getData()));
        } else if (entry.getUniqueIdentifier() == null || entry.getUniqueIdentifier().isBlank()) {
            throw new CustomException("MISSING_UNIQUE_IDENTIFIER",
                    "uniqueIdentifier is required when schema validation is disabled");
        }

        // Handle encryption AFTER unique identifier computation
        if (encryptionEnabled && schema != null) {
            entry.setData(encryptSensitiveFields(entry.getData(), entry.getTenantId(), schema));
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

    public void enrichUpdate(ConfigDataRequest request, JSONObject schema) {
        ConfigData entry = request.getConfigData();

        // Handle encryption before audit details
        if (encryptionEnabled && schema != null && entry.getData() != null) {
            entry.setData(encryptSensitiveFields(entry.getData(), entry.getTenantId(), schema));
        }

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

    /**
     * Encrypts sensitive fields in the config data based on schema x-security markers
     */
    private JsonNode encryptSensitiveFields(JsonNode data, String tenantId, JSONObject schema) {
        if (data == null || schema == null) {
            return data;
        }

        try {
            // Extract fields marked with x-security
            Set<String> securityFields = securityFieldsUtil.extractSecurityFields(schema);
            if (securityFields.isEmpty()) {
                return data;
            }

            log.debug("Found {} security fields for encryption: {}", securityFields.size(), securityFields);

            // Extract values to encrypt - maintain field order
            List<Object> valuesToEncrypt = new ArrayList<>();
            List<String> fieldOrder = new ArrayList<>();
            
            for (String fieldPath : securityFields) {
                Object value = securityFieldsUtil.getValueAtPath(data, fieldPath);
                if (value != null) {
                    valuesToEncrypt.add(value);
                    fieldOrder.add(fieldPath);
                }
            }
            
            if (valuesToEncrypt.isEmpty()) {
                return data;
            }

            // Encrypt the values
            JsonNode encryptedValues = cryptoClient.encryptValues(tenantId, valuesToEncrypt);
            
            // Replace original values with encrypted ones using correct field order
            return replaceWithEncryptedValuesInOrder(data, fieldOrder, encryptedValues);

        } catch (Exception e) {
            log.error("Failed to encrypt sensitive fields: {}", e.getMessage());
            throw new CustomException("ENCRYPTION_FAILED", 
                    "Failed to encrypt sensitive data: " + e.getMessage());
        }
    }

    /**
     * Replaces original values with encrypted values maintaining correct field order
     */
    private JsonNode replaceWithEncryptedValuesInOrder(JsonNode data, List<String> fieldOrder, JsonNode encryptedValues) {
        if (encryptedValues == null || !encryptedValues.isArray()) {
            return data;
        }

        try {
            JsonNode dataCopy = data.deepCopy();
            
            for (int i = 0; i < encryptedValues.size() && i < fieldOrder.size(); i++) {
                String fieldPath = fieldOrder.get(i);
                JsonNode encryptedValue = encryptedValues.get(i);
                securityFieldsUtil.setValueAtPath(dataCopy, fieldPath, encryptedValue);
            }
            
            return dataCopy;
        } catch (Exception e) {
            log.error("Failed to replace encrypted values in order: {}", e.getMessage());
            return data;
        }
    }
}
