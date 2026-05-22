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
 * Twilio provider strategy. Supports both Twilio SMS and Twilio WhatsApp
 * Business — the channel comes from ResolvedProvider.channel (set from
 * the TemplateBinding MDMS record / DispatchContext).
 *
 * SMS path uses the raw E.164 number as `from`.
 * WhatsApp path prefixes with `whatsapp:` (Twilio Programmable WhatsApp
 * convention) and optionally uses a Content Template SID.
 */
@Component
@Slf4j
public class TwilioProviderStrategy implements NovuProviderStrategy {

    private static final Pattern TWILIO_CONTENT_SID_PATTERN = Pattern.compile("^[Hh][Xx][a-fA-F0-9]{32}$");
    private static final String CHANNEL_WHATSAPP = "whatsapp";
    private static final String CHANNEL_SMS = "sms";
    private static final String WHATSAPP_PREFIX = "whatsapp:";
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

        // The sender format depends on the channel:
        //   sms      → raw +E.164 (e.g. +19789991227)
        //   whatsapp → whatsapp:+E.164 (Twilio Programmable WhatsApp)
        //
        // Previously this code unconditionally prepended `whatsapp:` —
        // breaking SMS delivery for any tenant configured with
        // channel="sms" in its TemplateBinding/ProviderDetail.
        if (StringUtils.hasText(resolvedProvider.getSenderNumber())) {
            String channel = resolvedProvider.getChannel();
            String senderNumber = resolvedProvider.getSenderNumber();

            if (CHANNEL_WHATSAPP.equalsIgnoreCase(channel)) {
                if (!senderNumber.startsWith(WHATSAPP_PREFIX)) {
                    senderNumber = WHATSAPP_PREFIX + senderNumber;
                    log.debug("Twilio[whatsapp]: added whatsapp: prefix to sender number: {}", senderNumber);
                }
            } else {
                // sms (default) or unknown channel — defensively strip
                // a `whatsapp:` prefix if it leaked in from MDMS data
                // so we don't accidentally route a non-WhatsApp send
                // through Twilio's WhatsApp pipeline.
                if (senderNumber.startsWith(WHATSAPP_PREFIX)) {
                    senderNumber = senderNumber.substring(WHATSAPP_PREFIX.length());
                    log.warn("Twilio[{}]: stripped whatsapp: prefix from sender number for non-WhatsApp channel: {}",
                            channel, senderNumber);
                }
            }
            config.put("from", senderNumber);
            log.debug("Twilio[{}]: using sender: {}", channel, senderNumber);
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