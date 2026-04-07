package org.egov.novubridge.service.provider;

import lombok.extern.slf4j.Slf4j;
import org.egov.novubridge.web.models.ResolvedProvider;
import org.egov.novubridge.web.models.ResolvedTemplate;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * WhatsApp Business API (Meta) provider strategy
 * Uses Meta's template.name and template.components format
 */
@Component
@Slf4j
public class WhatsAppBusinessApiProviderStrategy implements NovuProviderStrategy {
    
    @Override
    public String getProviderName() {
        return "whatsapp-business-api";
    }
    
    @Override
    public boolean supports(String providerName) {
        return "whatsapp-business-api".equalsIgnoreCase(providerName) || 
               "meta".equalsIgnoreCase(providerName) ||
               "whatsapp".equalsIgnoreCase(providerName);
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
        
        // Add sender number (phone number ID for WhatsApp Business API) from resolved provider
        if (StringUtils.hasText(resolvedProvider.getSenderNumber())) {
            config.put("from", resolvedProvider.getSenderNumber());
            log.debug("WhatsApp Business API: Using phone number ID from config: {}", resolvedProvider.getSenderNumber());
        }
        
        // Add WhatsApp Business API template configuration
        String contentSid = resolvedTemplate.getContentSid();
        if (StringUtils.hasText(contentSid)) {
            Map<String, Object> template = new HashMap<>();
            template.put("name", contentSid);
            
            // Add components (WhatsApp Business API format)
            if (contentVariables != null && !contentVariables.isEmpty()) {
                List<Map<String, Object>> components = new ArrayList<>();
                
                // Create body component with parameters
                Map<String, Object> bodyComponent = new HashMap<>();
                bodyComponent.put("type", "body");
                
                List<Map<String, Object>> parameters = new ArrayList<>();
                contentVariables.entrySet().stream()
                        .sorted(Map.Entry.comparingByKey()) // Sort by key to maintain order
                        .forEach(entry -> {
                            Map<String, Object> param = new HashMap<>();
                            param.put("type", "text");
                            param.put("text", entry.getValue());
                            parameters.add(param);
                        });
                
                if (!parameters.isEmpty()) {
                    bodyComponent.put("parameters", parameters);
                    components.add(bodyComponent);
                }
                
                template.put("components", components);
                log.debug("WhatsApp Business API: Using template components from paramOrder: {}", components);
            }
            
            config.put("template", template);
            log.debug("WhatsApp Business API: Using template name from config: {}", contentSid);
        }
        
        return config;
    }
    
    @Override
    public boolean isContentSidValid(String contentSid) {
        // WhatsApp Business API template names are typically lowercase with underscores
        return StringUtils.hasText(contentSid) && contentSid.matches("^[a-z0-9_]+$");
    }
    
    @Override
    public String[] getSupportedChannels() {
        return new String[]{"whatsapp"};
    }
}