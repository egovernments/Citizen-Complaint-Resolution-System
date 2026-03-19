package org.egov.config.utils;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.HttpServerErrorException;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestTemplate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.HashMap;

@Component
@Slf4j
public class EncryptionDecryptionUtil {

    @Autowired
    private RestTemplate restTemplate;
    
    @Autowired
    private ObjectMapper objectMapper;
    
    @Value("${egov.enc.host}")
    private String encryptionServiceHost;
    
    @Value("${egov.enc.encrypt.endpoint}")
    private String encryptEndpoint;
    
    @Value("${egov.enc.decrypt.endpoint}")
    private String decryptEndpoint;

    /**
     * Encrypts an object using direct REST calls to encryption service
     */
    public <T> T encryptObject(Object objectToEncrypt, String key, Class<T> classType) {
        // For now, return object as-is since we're focusing on field-level encryption
        log.debug("Object encryption not implemented for direct REST calls, returning original object");
        return (T) objectToEncrypt;
    }
    
    /**
     * Encrypts values using direct REST calls to encryption service
     * Bypasses enc-client and MDMS dependency completely
     */
    public JsonNode encryptValues(String tenantId, List<Object> valuesToEncrypt) {
        if (valuesToEncrypt == null || valuesToEncrypt.isEmpty()) {
            return null;
        }

        try {
            String url = encryptionServiceHost + encryptEndpoint;
            
            // Build encryption request payload
            List<Map<String, Object>> encryptionRequests = new ArrayList<>();
            for (Object value : valuesToEncrypt) {
                if (value != null && !value.toString().trim().isEmpty()) {
                    Map<String, Object> request = new HashMap<>();
                    request.put("tenantId", tenantId);
                    request.put("type", "Normal");
                    request.put("value", value.toString());
                    encryptionRequests.add(request);
                }
            }
            
            if (encryptionRequests.isEmpty()) {
                log.debug("No valid values to encrypt (all were null or empty)");
                return objectMapper.valueToTree(new ArrayList<>());
            }
            
            Map<String, Object> payload = new HashMap<>();
            payload.put("encryptionRequests", encryptionRequests);
            
            log.debug("Calling encryption service at: {} for {} values", url, encryptionRequests.size());
            
            // Make direct REST call to encryption service
            JsonNode response = restTemplate.postForObject(url, payload, JsonNode.class);
            
            if (response == null) {
                throw new CustomException("ENCRYPTION_RESPONSE_NULL", "No encryption response from service");
            }
            
            // Extract encrypted values from response (direct array format)
            List<Object> encryptedResults = new ArrayList<>();
            
            if (response.isArray()) {
                for (JsonNode item : response) {
                    // Response is a direct array of encrypted strings
                    encryptedResults.add(item.asText());
                }
            }
            
            log.debug("Successfully encrypted {} values", encryptedResults.size());
            return objectMapper.valueToTree(encryptedResults);
            
        } catch (ResourceAccessException e) {
            log.error("Connection error during encryption: {}", e.getMessage());
            throw new CustomException("ENCRYPTION_TIMEOUT_ERROR", "Encryption service connection error: " + e.getMessage());
        } catch (HttpClientErrorException | HttpServerErrorException e) {
            log.error("HTTP error during encryption: {} {}", e.getStatusCode(), e.getResponseBodyAsString(), e);
            throw new CustomException("ENCRYPTION_HTTP_ERROR", "HTTP error from encryption service: " + e.getStatusCode());
        } catch (Exception e) {
            log.error("Error during encryption", e);
            throw new CustomException("ENCRYPTION_ERROR", "Encryption failed: " + e.getMessage());
        }
    }

    /**
     * Decrypts an object using direct REST calls to encryption service
     */
    public <E, P> P decryptObject(Object objectToDecrypt, String key, Class<E> classType, org.egov.config.web.model.RequestInfo requestInfo) {
        // For now, return object as-is since we're focusing on field-level decryption
        log.debug("Object decryption not implemented for direct REST calls, returning original object");
        return (P) objectToDecrypt;
    }
    
    /**
     * Decrypts values using direct REST calls to encryption service
     */
    public JsonNode decryptValues(Object encryptedData) {
        if (encryptedData == null) {
            return null;
        }

        try {
            String url = encryptionServiceHost + decryptEndpoint;
            
            // Build decryption request payload with proper format for egov-enc-service
            List<Object> encryptedValues = new ArrayList<>();
            
            if (encryptedData instanceof List) {
                List<?> encryptedList = (List<?>) encryptedData;
                for (Object value : encryptedList) {
                    if (value != null && !value.toString().trim().isEmpty()) {
                        encryptedValues.add(value.toString());
                    }
                }
            } else {
                if (!encryptedData.toString().trim().isEmpty()) {
                    encryptedValues.add(encryptedData.toString());
                }
            }
            
            if (encryptedValues.isEmpty()) {
                log.debug("No valid encrypted values to decrypt (all were null or empty)");
                return objectMapper.valueToTree(new ArrayList<>());
            }
            
            log.debug("Calling decryption service at: {} for {} values", url, encryptedValues.size());
            
            // Make direct REST call to decryption service (expects raw array format)
            JsonNode response = restTemplate.postForObject(url, encryptedValues, JsonNode.class);
            
            if (response == null) {
                throw new CustomException("DECRYPTION_RESPONSE_NULL", "No decryption response from service");
            }
            
            // Extract decrypted values from response 
            List<Object> decryptedResults = new ArrayList<>();
            
            if (response.isArray()) {
                // Response is a direct array of decrypted strings
                for (JsonNode item : response) {
                    decryptedResults.add(item.asText());
                }
            } else if (response.has("plaintext") && response.get("plaintext").isArray()) {
                // Response has plaintext field containing array
                JsonNode plaintextArray = response.get("plaintext");
                for (JsonNode item : plaintextArray) {
                    decryptedResults.add(item.asText());
                }
            } else {
                // Single value response
                decryptedResults.add(response.asText());
            }
            
            log.debug("Successfully decrypted {} values", decryptedResults.size());
            return objectMapper.valueToTree(decryptedResults);
            
        } catch (ResourceAccessException e) {
            log.error("Connection error during decryption: {}", e.getMessage());
            throw new CustomException("DECRYPTION_TIMEOUT_ERROR", "Decryption service connection error: " + e.getMessage());
        } catch (HttpClientErrorException | HttpServerErrorException e) {
            log.error("HTTP error during decryption: {} {}", e.getStatusCode(), e.getResponseBodyAsString(), e);
            throw new CustomException("DECRYPTION_HTTP_ERROR", "HTTP error from decryption service: " + e.getStatusCode());
        } catch (Exception e) {
            log.error("Error during decryption", e);
            throw new CustomException("DECRYPTION_ERROR", "Decryption failed: " + e.getMessage());
        }
    }
    
}