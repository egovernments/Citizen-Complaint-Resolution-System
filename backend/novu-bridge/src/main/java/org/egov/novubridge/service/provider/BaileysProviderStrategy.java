package org.egov.novubridge.service.provider;

import lombok.extern.slf4j.Slf4j;
import org.egov.novubridge.web.models.ResolvedProvider;
import org.egov.novubridge.web.models.ResolvedTemplate;
import org.springframework.stereotype.Component;

import java.util.Collections;
import java.util.Map;

/**
 * Baileys WhatsApp provider strategy. Novu has no Baileys integration, so the
 * actual delivery happens out-of-band via {@code BaileysSendClient}; this
 * strategy exists so provider selection resolves to {@code providerName=baileys}
 * for WHATSAPP without colliding with {@link WhatsAppBusinessApiProviderStrategy}
 * (which handles the Meta/Twilio approved-template path).
 *
 * Messages are free-form (no contentSid), so {@link #buildProviderConfig} is a
 * no-op and {@link #isContentSidValid} always returns true.
 */
@Component
@Slf4j
public class BaileysProviderStrategy implements NovuProviderStrategy {

    @Override
    public String getProviderName() {
        return "baileys";
    }

    @Override
    public boolean supports(String providerName) {
        return "baileys".equalsIgnoreCase(providerName)
                || "baileys-whatsapp".equalsIgnoreCase(providerName);
    }

    @Override
    public Map<String, Object> buildProviderConfig(ResolvedProvider resolvedProvider,
                                                   ResolvedTemplate resolvedTemplate,
                                                   Map<String, String> contentVariables) {
        // Delivery is out-of-band HTTP to the Baileys send-service; no Novu overrides.
        return Collections.emptyMap();
    }

    @Override
    public boolean isContentSidValid(String contentSid) {
        // Free-form WhatsApp: no template/contentSid requirement.
        return true;
    }

    @Override
    public String[] getSupportedChannels() {
        return new String[]{"whatsapp"};
    }
}
