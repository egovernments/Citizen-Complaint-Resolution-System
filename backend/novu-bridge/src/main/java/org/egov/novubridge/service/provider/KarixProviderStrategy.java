package org.egov.novubridge.service.provider;

import lombok.extern.slf4j.Slf4j;
import org.egov.novubridge.web.models.ResolvedProvider;
import org.egov.novubridge.web.models.ResolvedTemplate;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import java.util.Collections;
import java.util.Map;

/**
 * Provider strategy for Karix WhatsApp Business API.
 *
 * Karix has no native Novu provider integration, so delivery is handled by a
 * step.custom() action in novu-bridge-endpoint rather than through Novu's
 * provider override mechanism. This strategy returns empty overrides; the actual
 * Karix API call is made inside the Novu workflow step.
 *
 * DispatchPipelineService detects "karix" and enriches the trigger payload with
 * credentials + routing data before calling Novu — keeping the Novu API trigger
 * path identical to Twilio/Vonage flows.
 */
@Component
@Slf4j
public class KarixProviderStrategy implements NovuProviderStrategy {

    @Override
    public String getProviderName() {
        return "karix";
    }

    @Override
    public boolean supports(String providerName) {
        return "karix".equalsIgnoreCase(providerName);
    }

    @Override
    public Map<String, Object> buildProviderConfig(ResolvedProvider resolvedProvider,
                                                   ResolvedTemplate resolvedTemplate,
                                                   Map<String, String> contentVariables) {
        // Karix delivery happens via step.custom() in the bridge endpoint.
        // No Novu provider overrides are needed.
        log.debug("Karix: skipping Novu provider overrides — delivery handled by bridge step.custom()");
        return Collections.emptyMap();
    }

    @Override
    public boolean isContentSidValid(String contentSid) {
        // Karix WhatsApp template names: lowercase letters, digits, underscores
        return StringUtils.hasText(contentSid) && contentSid.matches("^[a-z0-9_]+$");
    }

    @Override
    public String[] getSupportedChannels() {
        return new String[]{"whatsapp"};
    }
}
