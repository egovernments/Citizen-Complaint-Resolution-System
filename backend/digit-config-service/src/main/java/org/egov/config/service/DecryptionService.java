package org.egov.config.service;

import com.fasterxml.jackson.databind.JsonNode;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.egov.config.client.CryptoClient;
import org.egov.config.client.MdmsV2Client;
import org.egov.config.utils.SecurityFieldsUtil;
import org.egov.config.web.model.ConfigData;
import org.json.JSONObject;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.util.*;

@Service
@Slf4j
@RequiredArgsConstructor
public class DecryptionService {

    private final SecurityFieldsUtil securityFieldsUtil;
    private final CryptoClient cryptoClient;
    private final MdmsV2Client mdmsV2Client;

    @Value("${crypto.service.enabled:true}")
    private boolean encryptionEnabled;

    @Value("${mdms.v2.validation.enabled:true}")
    private boolean schemaValidationEnabled;

    /**
     * Decrypts sensitive fields in a single config data entry
     */
    public ConfigData decryptConfigData(ConfigData configData) {
        if (!encryptionEnabled || !schemaValidationEnabled || configData == null) {
            return configData;
        }

        try {
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

            JsonNode decryptedData = decryptSensitiveFields(
                    configData.getData(), 
                    securityFields);
            
            configData.setData(decryptedData);
            return configData;

        } catch (Exception e) {
            log.error("Failed to decrypt config data for id={}: {}", configData.getId(), e.getMessage());
            // Return original data in case of decryption failure
            return configData;
        }
    }

    /**
     * Decrypts sensitive fields in a list of config data entries
     */
    public List<ConfigData> decryptConfigDataList(List<ConfigData> configDataList) {
        if (!encryptionEnabled || !schemaValidationEnabled || configDataList == null || configDataList.isEmpty()) {
            return configDataList;
        }

        List<ConfigData> decryptedList = new ArrayList<>();
        for (ConfigData configData : configDataList) {
            decryptedList.add(decryptConfigData(configData));
        }
        
        return decryptedList;
    }

    /**
     * Decrypts sensitive fields in the config data based on schema x-security markers
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
                    fieldOrder.add(fieldPath);
                }
            }
            
            if (encryptedValues.isEmpty()) {
                return data;
            }

            // Decrypt the values
            JsonNode decryptedValues = cryptoClient.decryptValues(encryptedValues);
            
            // Replace encrypted values with decrypted ones using correct field order
            return replaceWithDecryptedValuesInOrder(data, fieldOrder, decryptedValues);

        } catch (Exception e) {
            log.error("Failed to decrypt sensitive fields: {}", e.getMessage());
            // Return original data if decryption fails
            return data;
        }
    }

    /**
     * Replaces encrypted values with decrypted values maintaining correct field order
     */
    private JsonNode replaceWithDecryptedValuesInOrder(JsonNode data, List<String> fieldOrder, JsonNode decryptedValues) {
        if (decryptedValues == null || !decryptedValues.isArray()) {
            return data;
        }

        try {
            JsonNode dataCopy = data.deepCopy();
            
            for (int i = 0; i < decryptedValues.size() && i < fieldOrder.size(); i++) {
                String fieldPath = fieldOrder.get(i);
                JsonNode decryptedValue = decryptedValues.get(i);
                securityFieldsUtil.setValueAtPath(dataCopy, fieldPath, decryptedValue);
            }
            
            return dataCopy;
        } catch (Exception e) {
            log.error("Failed to replace decrypted values in order: {}", e.getMessage());
            return data;
        }
    }
}