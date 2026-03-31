package org.egov.config.utils;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.json.JSONObject;
import org.springframework.stereotype.Component;

import java.util.*;

@Component
@Slf4j
@RequiredArgsConstructor
public class SecurityFieldsUtil {

    private final ObjectMapper objectMapper;

    /**
     * Extracts field paths that are marked with x-security from a JSON schema
     * x-security works like x-unique - as an array at schema level listing field names
     */
    public Set<String> extractSecurityFields(JSONObject schema) {
        Set<String> securityFields = new LinkedHashSet<>(); // Preserve insertion order
        if (schema == null) {
            return securityFields;
        }

        try {
            JsonNode schemaNode = objectMapper.readTree(schema.toString());
            
            // Look for x-security array at schema root level (like x-unique)
            if (schemaNode.has("x-security")) {
                JsonNode xSecurity = schemaNode.get("x-security");
                if (xSecurity.isArray()) {
                    for (JsonNode fieldNode : xSecurity) {
                        if (fieldNode.isTextual()) {
                            securityFields.add(fieldNode.asText());
                        }
                    }
                }
            }
        } catch (Exception e) {
            log.error("Failed to parse schema for security fields: {}", e.getMessage());
        }

        return securityFields;
    }

    /**
     * Extracts values from data that correspond to security fields and prepares them for encryption
     */
    public Map<String, Object> extractSecurityValues(JsonNode data, Set<String> securityFields) {
        Map<String, Object> securityValues = new HashMap<>();
        
        for (String fieldPath : securityFields) {
            Object value = getValueAtPath(data, fieldPath);
            if (value != null) {
                securityValues.put(fieldPath, value);
            }
        }
        
        return securityValues;
    }

    /**
     * Replaces security field values in data with encrypted values
     * CRITICAL: Uses List to preserve field order for correct value mapping
     */
    public JsonNode replaceWithEncryptedValues(JsonNode originalData, List<String> securityFields, 
                                               JsonNode encryptedValues) {
        if (encryptedValues == null || !encryptedValues.isArray()) {
            return originalData;
        }

        try {
            JsonNode dataCopy = originalData.deepCopy();
            
            // Use indexed iteration to maintain field order
            for (int i = 0; i < Math.min(encryptedValues.size(), securityFields.size()); i++) {
                String fieldPath = securityFields.get(i);
                JsonNode encryptedValue = encryptedValues.get(i);
                setValueAtPath(dataCopy, fieldPath, encryptedValue);
            }
            
            return dataCopy;
        } catch (IllegalArgumentException e) {
            log.error("Invalid argument while replacing encrypted values: {}", e.getMessage());
            throw new CustomException("ENCRYPTION_REPLACE_ERROR", "Invalid argument during encrypted value replacement");
        } catch (RuntimeException e) {
            log.error("Runtime error while replacing encrypted values: {}", e.getMessage());
            throw new CustomException("ENCRYPTION_REPLACE_ERROR", "Runtime error during encrypted value replacement");
        }
    }

    /**
     * Replaces encrypted field values in data with decrypted values
     * CRITICAL: Uses List to preserve field order for correct value mapping
     */
    public JsonNode replaceWithDecryptedValues(JsonNode encryptedData, List<String> securityFields,
                                               JsonNode decryptedValues) {
        if (decryptedValues == null) {
            return encryptedData;
        }

        try {
            JsonNode dataCopy = encryptedData.deepCopy();
            
            if (decryptedValues.isArray()) {
                // Use indexed iteration to maintain field order
                for (int i = 0; i < Math.min(decryptedValues.size(), securityFields.size()); i++) {
                    String fieldPath = securityFields.get(i);
                    JsonNode decryptedValue = decryptedValues.get(i);
                    setValueAtPath(dataCopy, fieldPath, decryptedValue);
                }
            } else {
                // Handle object-based decrypted response
                replaceDecryptedValuesRecursive(dataCopy, "", decryptedValues);
            }
            
            return dataCopy;
        } catch (IllegalArgumentException e) {
            log.error("Invalid argument while replacing decrypted values: {}", e.getMessage());
            // For decryption, return original encrypted data on failure to maintain service availability
            return encryptedData;
        } catch (RuntimeException e) {
            log.error("Runtime error while replacing decrypted values: {}", e.getMessage());
            // For decryption, return original encrypted data on failure to maintain service availability
            return encryptedData;
        }
    }


    public Object getValueAtPath(JsonNode data, String path) {
        if (data == null || path == null || path.isEmpty()) {
            return null;
        }

        String[] pathParts = path.split("\\.");
        JsonNode current = data;

        for (String part : pathParts) {
            if (current == null) {
                return null;
            }

            if (part.endsWith("[*]")) {
                // Handle array case - for now, return the whole array
                String arrayField = part.substring(0, part.length() - 3);
                current = current.get(arrayField);
                if (current != null && current.isArray()) {
                    return objectMapper.convertValue(current, Object.class);
                }
                return null;
            } else {
                current = current.get(part);
            }
        }

        if (current == null) {
            return null;
        }

        return objectMapper.convertValue(current, Object.class);
    }

    /**
     * Sets a value at the specified path in JSON data
     * SAFETY: Prevents ClassCastException by checking node types before casting
     * LIMITATION: Cannot traverse through array nodes in the path
     */
    public void setValueAtPath(JsonNode data, String path, JsonNode newValue) {
        if (data == null || path == null || path.isEmpty() || !data.isObject()) {
            return;
        }

        String[] pathParts = path.split("\\.");
        ObjectNode current = (ObjectNode) data;

        for (int i = 0; i < pathParts.length - 1; i++) {
            String part = pathParts[i];
            JsonNode next = current.get(part);
            
            if (next == null || !next.isObject()) {
                // Check if existing node is an array - don't overwrite arrays destructively
                if (next != null && next.isArray()) {
                    log.warn("Cannot traverse through array node at path '{}'. Skipping setValueAtPath for: {}", part, path);
                    return;
                }
                // Safe to create object node
                current.set(part, objectMapper.createObjectNode());
                next = current.get(part);
            }
            
            // Safe cast - we've ensured next is an ObjectNode
            current = (ObjectNode) next;
        }

        String finalField = pathParts[pathParts.length - 1];
        if (finalField.endsWith("[*]")) {
            // Handle array case
            String arrayField = finalField.substring(0, finalField.length() - 3);
            current.set(arrayField, newValue);
        } else {
            current.set(finalField, newValue);
        }
    }

    private void replaceDecryptedValuesRecursive(JsonNode data, String currentPath, JsonNode decryptedValues) {
        if (data == null || !data.isObject() || decryptedValues == null) {
            return;
        }

        ObjectNode dataObject = (ObjectNode) data;
        
        dataObject.fieldNames().forEachRemaining(fieldName -> {
            JsonNode fieldValue = dataObject.get(fieldName);
            
            if (decryptedValues.has(fieldName)) {
                JsonNode decryptedField = decryptedValues.get(fieldName);
                if (decryptedField.isObject() && fieldValue.isObject()) {
                    replaceDecryptedValuesRecursive(fieldValue, currentPath + "." + fieldName, decryptedField);
                } else {
                    dataObject.set(fieldName, decryptedField);
                }
            } else if (fieldValue.isObject()) {
                replaceDecryptedValuesRecursive(fieldValue, currentPath + "." + fieldName, decryptedValues);
            }
        });
    }
}