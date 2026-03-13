package org.egov.novubridge.service.provider;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.extern.slf4j.Slf4j;
import org.egov.novubridge.web.models.ResolvedProvider;
import org.egov.novubridge.web.models.ResolvedTemplate;
import org.egov.tracer.model.CustomException;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import java.util.HashMap;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * Twilio provider strategy for WhatsApp Business API
 * Uses Twilio's contentSid and contentVariables format
 */
@Component
@Slf4j
public class TwilioProviderStrategy implements NovuProviderStrategy {
    
    private static final Pattern TWILIO_CONTENT_SID_PATTERN = Pattern.compile("^[Hh][Xx][a-fA-F0-9]{32}$");
    private final ObjectMapper objectMapper = new ObjectMapper();
    
    @Override
    public String getProviderName() {
        return "twilio";
    }
    
    @Override
    public boolean supports(String providerName) {
        return "twilio".equalsIgnoreCase(providerName);
    }
    
    @Override
    public Map<String, Object> buildProviderConfig(ResolvedProvider resolvedProvider,
                                                  ResolvedTemplate resolvedTemplate,
                                                  Map<String, String> contentVariables) {
        Map<String, Object> config = new HashMap<>();
        
        // Add credentials from resolved provider
        if (resolvedProvider.getCredentials() != null && !resolvedProvider.getCredentials().isEmpty()) {
            config.put("credentials", resolvedProvider.getCredentials());
        }
        
        // Add sender number from resolved provider
        if (StringUtils.hasText(resolvedProvider.getSenderNumber())) {
            config.put("from", resolvedProvider.getSenderNumber());
            log.debug("Twilio: Using senderNumber from config: {}", resolvedProvider.getSenderNumber());
        }
        
        // Add Twilio-specific template configuration using _passthrough
        String contentSid = resolvedTemplate.getContentSid();
        if (StringUtils.hasText(contentSid)) {
            Map<String, Object> body = new HashMap<>();
            body.put("contentSid", contentSid);
            
            // Add contentVariables as JSON string (Twilio requirement)
            if (contentVariables != null && !contentVariables.isEmpty()) {
                try {
                    String cvJson = objectMapper.writeValueAsString(contentVariables);
                    body.put("contentVariables", cvJson);
                    log.debug("Twilio: Using contentVariables from paramOrder: {}", contentVariables);
                } catch (Exception e) {
                    throw new CustomException("NB_TWILIO_CONTENT_VARS_SERIALIZE", 
                            "Failed to serialize contentVariables for Twilio: " + e.getMessage());
                }
            }
            
            Map<String, Object> passthrough = new HashMap<>();
            passthrough.put("body", body);
            config.put("_passthrough", passthrough);
            
            log.debug("Twilio: Using contentSid from template: {}", contentSid);
        }
        
        return config;
    }
    
    @Override
    public boolean isContentSidValid(String contentSid) {
        if (!StringUtils.hasText(contentSid)) {
            return false;
        }
        return TWILIO_CONTENT_SID_PATTERN.matcher(contentSid).matches();
    }
    
    @Override
    public String[] getSupportedChannels() {
        return new String[]{"whatsapp", "sms"};
    }
}