package org.egov.config.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.egov.config.client.MdmsV2Client;
import org.egov.config.repository.ConfigDataRepository;
import org.egov.config.service.enrichment.ConfigDataEnricher;
import org.egov.config.service.validator.ConfigDataValidator;
import org.egov.config.utils.CustomException;
import org.egov.config.utils.EncryptionDecryptionUtil;
import org.egov.config.utils.FallbackUtil;
import org.egov.config.utils.ResponseUtil;
import org.egov.config.utils.SecurityFieldsUtil;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.egov.config.web.model.*;
import org.egov.config.web.model.RequestInfo;
import org.json.JSONObject;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

@Service
@Slf4j
@RequiredArgsConstructor
public class ConfigDataService {

    private final ConfigDataValidator validator;
    private final ConfigDataEnricher enricher;
    private final ConfigDataRepository repository;
    private final EncryptionDecryptionUtil encryptionDecryptionUtil;
    private final SecurityFieldsUtil securityFieldsUtil;
    private final MdmsV2Client mdmsV2Client;
    private final ObjectMapper objectMapper;

    @Value("${mdms.v2.validation.enabled:true}")
    private boolean schemaValidationEnabled;


    public ConfigData create(ConfigDataRequest request, String schemaCode) {
        request.getConfigData().setSchemaCode(schemaCode);

        JSONObject schema = validator.validateCreate(request);
        enricher.enrichCreate(request, schema);
        validator.checkDuplicate(request.getConfigData());

        repository.save(request.getConfigData());
        return request.getConfigData();
    }

    public ConfigData update(ConfigDataRequest request, String schemaCode) {
        request.getConfigData().setSchemaCode(schemaCode);

        JSONObject schema = validator.validateUpdate(request);
        enricher.enrichUpdate(request, schema);

        repository.update(request.getConfigData());
        return request.getConfigData();
    }

    public List<ConfigData> search(ConfigDataSearchRequest request) {
        log.info("ConfigDataService.search: Starting search with tenantId={}, schemaCode={}, criteria={}", 
                request.getCriteria().getTenantId(), request.getCriteria().getSchemaCode(), request.getCriteria());
        
        enricher.enrichSearchDefaults(request.getCriteria());
        log.debug("ConfigDataService.search: Search criteria enriched with defaults");
        
        List<ConfigData> results = repository.search(request.getCriteria());
        log.info("ConfigDataService.search: Repository returned {} raw results", results.size());
        
        List<ConfigData> decryptedResults = decryptConfigDataList(results, request.getRequestInfo());
        log.info("ConfigDataService.search: Completed search, returning {} decrypted results", decryptedResults.size());
        
        return decryptedResults;
    }

    public long count(ConfigDataCriteria criteria) {
        return repository.count(criteria);
    }

    public ConfigDataResolveResponse resolve(ConfigDataResolveRequest request) {
        ConfigDataResolveRequest.ResolveParams params = request.getResolveRequest();
        List<String> tenantChain = FallbackUtil.buildTenantChain(params.getTenantId());

        ConfigData result = repository.resolve(
                params.getSchemaCode(),
                params.getCriteria(),
                tenantChain);

        if (result == null) {
            throw new CustomException("CONFIG_NOT_RESOLVED",
                    "No config found for schemaCode=" + params.getSchemaCode()
                            + " tenantId=" + params.getTenantId()
                            + " criteria=" + params.getCriteria());
        }

        // Decrypt sensitive fields before returning
        ConfigData decryptedResult = decryptConfigData(result, request.getRequestInfo());

        return ConfigDataResolveResponse.builder()
                .responseInfo(ResponseUtil.createResponseInfo(request.getRequestInfo(), true))
                .configData(decryptedResult)
                .resolutionMeta(ConfigDataResolveResponse.ResolutionMeta.builder()
                        .matchedTenant(decryptedResult.getTenantId())
                        .build())
                .build();
    }

    /**
     * Decrypts sensitive fields in a single config data entry
     * IMPORTANT: This method mirrors the encryption logic in ConfigDataEnricher
     * - Both check: schema != null && securityFields.isNotEmpty()
     * - This ensures perfect encryption/decryption symmetry
     */
    private ConfigData decryptConfigData(ConfigData configData, RequestInfo requestInfo) {
        if (configData == null) {
            return configData;
        }

        try {
            // Always fetch schema for encryption/decryption - this is independent of validation
            JSONObject schema = mdmsV2Client.fetchSchemaDefinition(
                    configData.getTenantId(), 
                    configData.getSchemaCode());
            
            if (schema == null) {
                return configData;
            }

            Set<String> securityFields = securityFieldsUtil.extractSecurityFields(schema);
            if (securityFields.isEmpty()) {
                return configData;
            }

            // Decrypt sensitive fields maintaining correct field order
            JsonNode decryptedData = decryptSensitiveFields(configData.getData(), securityFields);
            configData.setData(decryptedData);
            
            return configData;

        } catch (CustomException e) {
            // Re-throw custom exceptions from EncryptionDecryptionUtil
            log.error("Encryption service error while decrypting config data for id={}: {}", configData.getId(), e.getMessage());
            throw e;
        } catch (RuntimeException e) {
            log.error("Runtime error while decrypting config data for id={}: {}", configData.getId(), e.getMessage());
            // Return original data in case of decryption failure to maintain service availability
            return configData;
        }
    }

    /**
     * Decrypts sensitive fields in a list of config data entries
     */
    private List<ConfigData> decryptConfigDataList(List<ConfigData> configDataList, RequestInfo requestInfo) {
        if (configDataList == null || configDataList.isEmpty()) {
            log.debug("ConfigDataService.decryptConfigDataList: No config data to decrypt (null or empty)");
            return configDataList;
        }

        log.info("ConfigDataService.decryptConfigDataList: Starting decryption for {} config data entries", configDataList.size());
        List<ConfigData> decryptedList = new ArrayList<>();
        
        for (ConfigData configData : configDataList) {
            log.debug("ConfigDataService.decryptConfigDataList: Decrypting config data id={}, schemaCode={}", 
                    configData.getId(), configData.getSchemaCode());
            decryptedList.add(decryptConfigData(configData, requestInfo));
        }
        
        log.info("ConfigDataService.decryptConfigDataList: Completed decryption for {} entries", decryptedList.size());
        return decryptedList;
    }

    /**
     * Decrypts sensitive fields in the config data based on schema x-security markers
     * Maintains correct field order during encryption/decryption
     */
    private JsonNode decryptSensitiveFields(JsonNode data, Set<String> securityFields) {
        if (data == null || securityFields.isEmpty()) {
            return data;
        }

        try {
            log.debug("Found {} security fields for decryption: {}", securityFields.size(), securityFields);

            // Extract values to decrypt - maintain field order
            List<Object> encryptedValues = new ArrayList<>();
            List<String> fieldOrder = new ArrayList<>();
            
            for (String fieldPath : securityFields) {
                Object value = securityFieldsUtil.getValueAtPath(data, fieldPath);
                if (value != null) {
                    encryptedValues.add(value);
                    fieldOrder.add(fieldPath); // This maintains the order!
                }
            }
            
            if (encryptedValues.isEmpty()) {
                return data;
            }

            // Decrypt the values using EncryptionDecryptionUtil
            JsonNode decryptedValues = encryptionDecryptionUtil.decryptValues(encryptedValues);
            
            // Replace encrypted values with decrypted ones using correct field order
            return replaceWithDecryptedValuesInOrder(data, fieldOrder, decryptedValues);

        } catch (CustomException e) {
            // Re-throw custom exceptions from EncryptionDecryptionUtil
            log.error("Encryption service error while decrypting sensitive fields: {}", e.getMessage());
            throw e;
        } catch (RuntimeException e) {
            log.error("Runtime error while decrypting sensitive fields: {}", e.getMessage());
            // Return original data if decryption fails to maintain service availability
            return data;
        }
    }

    /**
     * Replaces encrypted values with decrypted values maintaining correct field order
     * Parses JSON-like strings back to objects when appropriate
     */
    private JsonNode replaceWithDecryptedValuesInOrder(JsonNode data, List<String> fieldOrder, JsonNode decryptedValues) {
        if (decryptedValues == null || !decryptedValues.isArray()) {
            return data;
        }

        try {
            JsonNode dataCopy = data.deepCopy();
            
            // Map back using the same order as encryption
            for (int i = 0; i < decryptedValues.size() && i < fieldOrder.size(); i++) {
                String fieldPath = fieldOrder.get(i);
                JsonNode decryptedValue = decryptedValues.get(i);
                
                // Check if the decrypted value should be parsed as JSON object
                JsonNode parsedValue = parseDecryptedValue(decryptedValue);
                securityFieldsUtil.setValueAtPath(dataCopy, fieldPath, parsedValue);
            }
            
            return dataCopy;
        } catch (IllegalArgumentException e) {
            log.error("Invalid argument while replacing decrypted values: {}", e.getMessage());
            return data;
        } catch (RuntimeException e) {
            log.error("Runtime error while replacing decrypted values: {}", e.getMessage());
            return data;
        }
    }
    
    /**
     * Parses decrypted values that should be JSON objects back from string format
     * Handles patterns like: {key1=value1, key2=value2} -> {"key1":"value1","key2":"value2"}
     */
    private JsonNode parseDecryptedValue(JsonNode decryptedValue) {
        if (decryptedValue == null || !decryptedValue.isTextual()) {
            return decryptedValue;
        }
        
        String textValue = decryptedValue.asText().trim();
        
        // Check if it looks like a serialized object: starts with { and ends with }
        if (textValue.startsWith("{") && textValue.endsWith("}")) {
            try {
                // Try to parse as JSON first (proper JSON format)
                return objectMapper.readTree(textValue);
            } catch (Exception jsonException) {
                // If JSON parsing fails, try to parse the Java toString() format
                try {
                    log.debug("Attempting to parse Java toString format: {}", textValue);
                    return parseJavaToStringFormat(textValue);
                } catch (Exception parseException) {
                    log.warn("Could not parse object-like string '{}', returning as-is: {}", 
                            textValue, parseException.getMessage());
                    return decryptedValue;
                }
            }
        }
        
        return decryptedValue;
    }
    
    /**
     * Parses Java toString() format like {key1=value1, key2=value2} into JSON object
     */
    private JsonNode parseJavaToStringFormat(String text) {
        try {
            // Remove outer braces
            String content = text.substring(1, text.length() - 1).trim();
            
            Map<String, Object> result = new HashMap<>();
            if (!content.isEmpty()) {
                // Split by comma, but be careful about values that might contain commas
                String[] pairs = content.split(",\\s*(?=[a-zA-Z_][a-zA-Z0-9_]*=)");
                
                for (String pair : pairs) {
                    String[] keyValue = pair.split("=", 2);
                    if (keyValue.length == 2) {
                        String key = keyValue[0].trim();
                        String value = keyValue[1].trim();
                        result.put(key, value);
                    }
                }
            }
            
            log.debug("Parsed Java toString format to object with {} keys", result.size());
            return objectMapper.valueToTree(result);
        } catch (Exception e) {
            log.error("Error parsing Java toString format: {}", e.getMessage());
            throw new RuntimeException("Failed to parse Java toString format", e);
        }
    }
}
