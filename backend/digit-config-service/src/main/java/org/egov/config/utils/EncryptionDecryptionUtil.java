package org.egov.config.utils;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.egov.encryption.EncryptionService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.HttpServerErrorException;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClientException;
import com.fasterxml.jackson.core.JsonProcessingException;
import java.net.SocketTimeoutException;
import java.net.ConnectException;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

@Component
@Slf4j
public class EncryptionDecryptionUtil {

    private EncryptionService encryptionService;
    
    @Autowired
    private ObjectMapper objectMapper;
    
    @Value("${state.level.tenant.id}")
    private String stateLevelTenantId;
    
    public EncryptionDecryptionUtil(@Autowired(required = false) EncryptionService encryptionService) {
        this.encryptionService = encryptionService;
    }

    /**
     * Encrypts an object using the enc-client library
     */
    public <T> T encryptObject(Object objectToEncrypt, String key, Class<T> classType) {
        try {
            if (objectToEncrypt == null) {
                return null;
            }
            T encryptedObject = encryptionService.encryptJson(objectToEncrypt, key, stateLevelTenantId, classType);
            if (encryptedObject == null) {
                throw new CustomException("ENCRYPTION_NULL_ERROR", "Null object found on performing encryption");
            }
            return encryptedObject;
        } catch (ResourceAccessException | SocketTimeoutException | ConnectException e) {
            log.error("Timeout or connection error occurred while encrypting", e);
            throw new CustomException("ENCRYPTION_TIMEOUT_ERROR", "Encryption service timeout or connection error");
        } catch (HttpClientErrorException | HttpServerErrorException e) {
            log.error("HTTP error occurred while encrypting: {} {}", e.getStatusCode(), e.getResponseBodyAsString(), e);
            throw new CustomException("ENCRYPTION_HTTP_ERROR", "HTTP error from encryption service: " + e.getStatusCode());
        } catch (JsonProcessingException e) {
            log.error("JSON processing error occurred while encrypting", e);
            throw new CustomException("ENCRYPTION_JSON_ERROR", "JSON processing error during encryption");
        } catch (IOException e) {
            log.error("IO error occurred while encrypting", e);
            throw new CustomException("ENCRYPTION_IO_ERROR", "IO error during encryption process");
        } catch (RestClientException e) {
            log.error("REST client error occurred while encrypting", e);
            throw new CustomException("ENCRYPTION_CLIENT_ERROR", "REST client error during encryption");
        }
    }
    
    /**
     * Encrypts values using the enc-client library - for bulk operations
     * Uses single API call to encrypt multiple values efficiently
     */
    public JsonNode encryptValues(String tenantId, List<Object> valuesToEncrypt) {
        if (valuesToEncrypt == null || valuesToEncrypt.isEmpty()) {
            return null;
        }

        if (encryptionService == null) {
            log.warn("EncryptionService not available, skipping encryption");
            return null;
        }

        try {
            // Use bulk encryption - single API call for all values
            List<Object> encryptedResults = encryptionService.encryptJson(valuesToEncrypt, "Config", tenantId, List.class);
            
            if (encryptedResults == null) {
                throw new CustomException("BULK_ENCRYPTION_NULL_ERROR", "Null result from bulk encryption");
            }
            
            return objectMapper.valueToTree(encryptedResults);
            
        } catch (ResourceAccessException | SocketTimeoutException | ConnectException e) {
            log.error("Timeout or connection error during bulk encryption: {}", e.getMessage());
            throw new CustomException("ENCRYPTION_TIMEOUT_ERROR", "Encryption service timeout during bulk operation");
        } catch (HttpClientErrorException | HttpServerErrorException e) {
            log.error("HTTP error during bulk encryption: {} {}", e.getStatusCode(), e.getResponseBodyAsString(), e);
            throw new CustomException("ENCRYPTION_HTTP_ERROR", "HTTP error from encryption service during bulk operation: " + e.getStatusCode());
        } catch (JsonProcessingException e) {
            log.error("JSON processing error during bulk encryption", e);
            throw new CustomException("ENCRYPTION_JSON_ERROR", "JSON processing error during bulk encryption");
        } catch (IOException e) {
            log.error("IO error during bulk encryption", e);
            throw new CustomException("ENCRYPTION_IO_ERROR", "IO error during bulk encryption process");
        } catch (RestClientException e) {
            log.error("REST client error during bulk encryption", e);
            throw new CustomException("ENCRYPTION_CLIENT_ERROR", "REST client error during bulk encryption");
        }
    }

    /**
     * Decrypts an object using the enc-client library
     */
    public <E, P> P decryptObject(Object objectToDecrypt, String key, Class<E> classType, org.egov.config.web.model.RequestInfo requestInfo) {
        try {
            if (objectToDecrypt == null) {
                return null;
            }
            
            // For config service, use null RequestInfo as we don't need user-specific decryption logic
            // The schema-based security fields determine what needs to be decrypted
            @SuppressWarnings("unchecked")
            P decryptedObject = (P) encryptionService.decryptJson(null, objectToDecrypt, key != null ? key : "Config", "ConfigDecryption", classType);
            if (decryptedObject == null) {
                throw new CustomException("DECRYPTION_NULL_ERROR", "Null object found on performing decryption");
            }
            
            return decryptedObject;
        } catch (ResourceAccessException | SocketTimeoutException | ConnectException e) {
            log.error("Timeout or connection error occurred while decrypting", e);
            throw new CustomException("DECRYPTION_TIMEOUT_ERROR", "Decryption service timeout or connection error");
        } catch (HttpClientErrorException | HttpServerErrorException e) {
            log.error("HTTP error occurred while decrypting: {} {}", e.getStatusCode(), e.getResponseBodyAsString(), e);
            throw new CustomException("DECRYPTION_HTTP_ERROR", "HTTP error from decryption service: " + e.getStatusCode());
        } catch (JsonProcessingException e) {
            log.error("JSON processing error occurred while decrypting", e);
            throw new CustomException("DECRYPTION_JSON_ERROR", "JSON processing error during decryption");
        } catch (IOException e) {
            log.error("IO error occurred while decrypting", e);
            throw new CustomException("DECRYPTION_IO_ERROR", "IO error during decryption process");
        } catch (RestClientException e) {
            log.error("REST client error occurred while decrypting", e);
            throw new CustomException("DECRYPTION_CLIENT_ERROR", "REST client error during decryption");
        }
    }
    
    /**
     * Decrypts values using the enc-client library - for bulk operations
     */
    public JsonNode decryptValues(Object encryptedData) {
        if (encryptedData == null) {
            return null;
        }

        if (encryptionService == null) {
            log.warn("EncryptionService not available, skipping decryption");
            return null;
        }

        try {
            if (encryptedData instanceof List) {
                // Use bulk decryption - single API call for all values
                List<?> encryptedList = (List<?>) encryptedData;
                List<Object> decryptedResults = encryptionService.decryptJson(null, encryptedList, "Config", "ConfigDecryption", List.class);
                
                if (decryptedResults == null) {
                    throw new CustomException("BULK_DECRYPTION_NULL_ERROR", "Null result from bulk decryption");
                }
                
                return objectMapper.valueToTree(decryptedResults);
            } else {
                Object decryptedValue = encryptionService.decryptJson(null, encryptedData, "Config", "ConfigDecryption", Object.class);
                return objectMapper.valueToTree(decryptedValue);
            }
        } catch (ResourceAccessException | SocketTimeoutException | ConnectException e) {
            log.error("Timeout or connection error during bulk decryption: {}", e.getMessage());
            throw new CustomException("DECRYPTION_TIMEOUT_ERROR", "Decryption service timeout during bulk operation");
        } catch (HttpClientErrorException | HttpServerErrorException e) {
            log.error("HTTP error during bulk decryption: {} {}", e.getStatusCode(), e.getResponseBodyAsString(), e);
            throw new CustomException("DECRYPTION_HTTP_ERROR", "HTTP error from decryption service during bulk operation: " + e.getStatusCode());
        } catch (JsonProcessingException e) {
            log.error("JSON processing error during bulk decryption", e);
            throw new CustomException("DECRYPTION_JSON_ERROR", "JSON processing error during bulk decryption");
        } catch (IOException e) {
            log.error("IO error during bulk decryption", e);
            throw new CustomException("DECRYPTION_IO_ERROR", "IO error during bulk decryption process");
        } catch (RestClientException e) {
            log.error("REST client error during bulk decryption", e);
            throw new CustomException("DECRYPTION_CLIENT_ERROR", "REST client error during bulk decryption");
        }
    }
    
}