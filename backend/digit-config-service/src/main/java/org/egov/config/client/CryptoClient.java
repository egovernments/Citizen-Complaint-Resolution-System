package org.egov.config.client;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.egov.config.utils.CustomException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

@Component
@Slf4j
@RequiredArgsConstructor
public class CryptoClient {

    private final RestTemplate restTemplate;
    private final ObjectMapper objectMapper;

    @Value("${crypto.service.host:http://egov-enc-service:8080}")
    private String cryptoHost;

    @Value("${crypto.service.encrypt.path:/crypto/v1/_encrypt}")
    private String encryptPath;

    @Value("${crypto.service.decrypt.path:/crypto/v1/_decrypt}")
    private String decryptPath;

    /**
     * Encrypts values using the crypto service
     */
    public JsonNode encryptValues(String tenantId, List<Object> valuesToEncrypt) {
        if (valuesToEncrypt == null || valuesToEncrypt.isEmpty()) {
            return null;
        }

        if (cryptoHost == null || cryptoHost.isBlank()) {
            log.warn("Crypto service host not configured, skipping encryption");
            return null;
        }

        try {
            String url = cryptoHost + encryptPath;
            List<Map<String, Object>> encryptionRequests = new ArrayList<>();

            for (Object value : valuesToEncrypt) {
                encryptionRequests.add(Map.of(
                        "tenantId", tenantId,
                        "type", "Normal", // Default type, can be made configurable
                        "value", value
                ));
            }

            Map<String, Object> request = Map.of("encryptionRequests", encryptionRequests);
            JsonNode response = restTemplate.postForObject(url, request, JsonNode.class);

            if (response == null || !response.isArray()) {
                throw new CustomException("ENCRYPTION_FAILED", "Invalid response from encryption service");
            }

            return response;
        } catch (Exception e) {
            log.error("Failed to encrypt values: {}", e.getMessage());
            throw new CustomException("ENCRYPTION_FAILED", "Could not encrypt sensitive data: " + e.getMessage());
        }
    }

    /**
     * Decrypts values using the crypto service
     */
    public JsonNode decryptValues(Object encryptedData) {
        if (encryptedData == null) {
            return null;
        }

        if (cryptoHost == null || cryptoHost.isBlank()) {
            log.warn("Crypto service host not configured, skipping decryption");
            return null;
        }

        try {
            String url = cryptoHost + decryptPath;
            JsonNode response = restTemplate.postForObject(url, encryptedData, JsonNode.class);

            if (response == null) {
                throw new CustomException("DECRYPTION_FAILED", "Invalid response from decryption service");
            }

            return response;
        } catch (Exception e) {
            log.error("Failed to decrypt values: {}", e.getMessage());
            throw new CustomException("DECRYPTION_FAILED", "Could not decrypt sensitive data: " + e.getMessage());
        }
    }
}