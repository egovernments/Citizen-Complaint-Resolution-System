package org.egov.novubridge.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.service.provider.NovuProviderStrategyFactory;
import org.egov.novubridge.service.provider.TwilioProviderStrategy;
import org.egov.novubridge.web.models.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mock;
import org.mockito.MockitoAnnotations;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.client.RestTemplate;

import java.util.*;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

@Slf4j
public class ProviderAgnosticTest {

    private NovuClient novuClient;
    private NovuBridgeConfiguration config;
    
    @Mock
    private NovuProviderStrategyFactory providerStrategyFactory;
    
    @Mock
    private TwilioProviderStrategy twilioStrategy;
    
    @Mock
    private RestTemplate restTemplate;

    @BeforeEach
    void setUp() {
        MockitoAnnotations.openMocks(this);
        
        config = new NovuBridgeConfiguration();
        config.setNovuBaseUrl("https://api.novu.co");
        config.setNovuApiKey("test_api_key_here");
        
        // Mock the strategy factory to return Twilio strategy
        when(providerStrategyFactory.getStrategy(any(ResolvedProvider.class))).thenReturn(twilioStrategy);
        
        // Mock Twilio strategy to return proper config
        Map<String, Object> mockConfig = new HashMap<>();
        mockConfig.put("credentials", Map.of("accountSid", "ACXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX", "authToken", "test_token"));
        mockConfig.put("from", "whatsapp:+1234567890");
        when(twilioStrategy.buildProviderConfig(any(), any(), any())).thenReturn(mockConfig);
        
        // Mock RestTemplate to return successful response
        Map<String, Object> mockResponse = Map.of("data", Map.of("transactionId", "mock-tx-id"));
        ResponseEntity<Map> responseEntity = new ResponseEntity<>(mockResponse, HttpStatus.OK);
        when(restTemplate.exchange(any(String.class), eq(HttpMethod.POST), any(HttpEntity.class), eq(Map.class)))
            .thenReturn(responseEntity);
        
        novuClient = new NovuClient(restTemplate, config, providerStrategyFactory);
    }

    @Test
    public void testTwilioWhatsAppTrigger() throws Exception {
        // Test data from your message
        String tenantId = "pg.citya";
        String eventId = "4d7516f9-9ded-4df3-a1e6-ff38776f8787";

        // Parse the provider credentials JSON from your config data
        String credentialsJson = "{\"apiUrl\": \"https://api.twilio.com/2010-04-01\", \"channel\": \"WHATSAPP\", \"authToken\": \"test_auth_token_here\", \"accountSid\": \"ACXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX\", \"novuApiKey\": \"test_novu_api_key_here\", \"providerName\": \"twilio\", \"whatsappNumber\": \"+1234567890\"}";

        ObjectMapper mapper = new ObjectMapper();
        Map<String, Object> credentials = mapper.readValue(credentialsJson, Map.class);

        // Extract Novu API key and WhatsApp number from credentials
        String novuApiKey = (String) credentials.get("novuApiKey");
        String whatsappNumber = (String) credentials.get("whatsappNumber");

        // Clean credentials for Novu (remove non-credential fields)
        Map<String, Object> cleanCredentials = new HashMap<>();
        cleanCredentials.put("accountSid", credentials.get("accountSid"));
        cleanCredentials.put("authToken", credentials.get("authToken"));

        // Use the real workflow from your config data
        String templateKey = "complaints-workflow-reject";
        String subscriberId = tenantId + ":" + "test-user-uuid";
        String whatsappPhone = "whatsapp:+917061170992"; // Your phone number for testing

        // Create test payload with the required variables from your template config
        Map<String, Object> payload = new HashMap<>();
        payload.put("complaintNo", "PGR/2024/000123");
        payload.put("serviceName", "Water Supply");
        payload.put("submittedDate", "2024-12-30");
        payload.put("comment", "Complaint has been rejected due to insufficient information");

        log.info("Testing Twilio WhatsApp trigger with:");
        log.info("Template: {}", templateKey);
        log.info("Subscriber: {}", subscriberId);
        log.info("Phone: {}", whatsappPhone);
        log.info("Credentials: accountSid={}, authToken=[REDACTED]", credentials.get("accountSid"));
        log.info("Payload: {}", payload);

        try {
            // Test the direct provider credential pass-through
            NovuClient.NovuResponse response = novuClient.triggerWithProviderCredentials(
                templateKey,
                subscriberId,
                whatsappPhone,
                payload,
                eventId,
                "twilio",
                cleanCredentials,
                "+1234567890", // senderNumber
                "HX1234567890abcdef1234567890abcdef", // contentSid
                null, // contentVariables
                novuApiKey
            );

            log.info("Novu Response - Status: {}, Body: {}",
                response.getStatusCode(), response.getResponse());

            // Check if response indicates success
            if (response.getStatusCode() >= 200 && response.getStatusCode() < 300) {
                log.info("✅ Test trigger successful!");

                // Log transaction details if available
                if (response.getResponse() != null && response.getResponse().containsKey("data")) {
                    Map<String, Object> data = (Map<String, Object>) response.getResponse().get("data");
                    if (data.containsKey("transactionId")) {
                        log.info("Transaction ID: {}", data.get("transactionId"));
                    }
                }
            } else {
                log.warn("❌ Test trigger failed with status: {}", response.getStatusCode());
            }

        } catch (Exception e) {
            log.error("🔥 Test trigger exception: {}", e.getMessage(), e);

            // Check if it's a configuration/authentication issue
            if (e.getMessage().contains("Unauthorized") || e.getMessage().contains("401")) {
                log.warn("💡 Check Novu API key configuration");
            } else if (e.getMessage().contains("template") || e.getMessage().contains("workflow")) {
                log.warn("💡 Template '{}' may not exist in Novu workspace", templateKey);
            }

            throw e;
        }
    }

    @Test
    public void testProviderConfigurationFormat() {
        // Test that provider configuration matches expected format
        String credentialsJson = "{\"apiUrl\": \"https://api.twilio.com/2010-04-01\", \"channel\": \"WHATSAPP\", \"authToken\": \"test_auth_token_here\", \"accountSid\": \"ACXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX\", \"novuApiKey\": \"test_novu_api_key_here\", \"providerName\": \"twilio\", \"whatsappNumber\": \"+1234567890\"}";

        try {
            ObjectMapper mapper = new ObjectMapper();
            Map<String, Object> config = mapper.readValue(credentialsJson, Map.class);

            // Validate expected Twilio fields
            assert config.containsKey("accountSid") : "Missing accountSid";
            assert config.containsKey("authToken") : "Missing authToken";
            assert config.containsKey("providerName") : "Missing providerName";
            assert "twilio".equals(config.get("providerName")) : "Wrong provider name";

            log.info("✅ Provider configuration format is valid");
            log.info("AccountSid: {}", config.get("accountSid"));
            log.info("Provider: {}", config.get("providerName"));
            log.info("WhatsApp Number: {}", config.get("whatsappNumber"));

        } catch (Exception e) {
            log.error("❌ Provider configuration format invalid: {}", e.getMessage());
            throw new RuntimeException(e);
        }
    }
}