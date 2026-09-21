package org.egov.novubridge.config;

import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;

/**
 * Refuses to start on configuration that is guaranteed to fail every dispatch, and warns
 * loudly on combinations that usually mean a mistake. Before this, each of these was
 * discovered one FAILED/SKIPPED row at a time in production.
 */
@Slf4j
@Component
public class ConfigurationSanityCheck {

    private static final Set<String> PLACEHOLDER_KEYS = Set.of("test-api-key", "changeme", "");

    private final NovuBridgeConfiguration config;

    public ConfigurationSanityCheck(NovuBridgeConfiguration config) {
        this.config = config;
    }

    @PostConstruct
    public void verify() {
        List<String> fatal = new ArrayList<>();
        List<String> warn = new ArrayList<>();

        if (config.isSmsCountryDirect()
                && (!StringUtils.hasText(config.getSmsCountryUser()) || !StringUtils.hasText(config.getSmsCountryPassword()))) {
            fatal.add("novu.bridge.sms.provider=smscountry but novu.bridge.smscountry.user/password are blank — every SMS would fail");
        }
        if (Boolean.TRUE.equals(config.getPreferenceEnabled()) && !StringUtils.hasText(config.getPreferenceHost())) {
            fatal.add("novu.bridge.preference.enabled=true but novu.bridge.preference.host is blank — every consent check would fail");
        }
        if (Boolean.TRUE.equals(config.getChannelPolicyEnabled()) && !StringUtils.hasText(config.getMdmsHost())) {
            fatal.add("novu.bridge.channel.policy.enabled=true but novu.bridge.mdms.host is blank");
        }

        boolean anyEnvChannel = config.getChannelsEnabled() != null
                && config.getChannelsEnabled().stream().anyMatch(StringUtils::hasText);
        if (!anyEnvChannel && !Boolean.TRUE.equals(config.getChannelPolicyEnabled())) {
            warn.add("no channel is enabled anywhere (novu.bridge.channels.enabled is empty and the MDMS channel policy is off): every event will be SKIPPED/NB_NO_PROVIDER");
        }
        if (config.isChannelEnabled("WHATSAPP") && !StringUtils.hasText(config.getWhatsappIntegrationId())) {
            warn.add("WHATSAPP is enabled without novu.bridge.integration.id.whatsapp — triggers will use Novu's PRIMARY sms integration, which is usually the plain-SMS sender");
        }
        if (!StringUtils.hasText(config.getSmsCountryAdapterUrl())) {
            warn.add("novu.bridge.smscountry.adapter.url is blank — an SMSCountry provider added from the "
                    + "configurator would be created with no baseUrl and every send through it would fail");
        }
        if (config.getNovuApiKey() == null || PLACEHOLDER_KEYS.contains(config.getNovuApiKey().trim())) {
            warn.add("novu.api.key is a placeholder — Novu deliveries will be rejected until a real key is set");
        }
        if (Boolean.FALSE.equals(config.getProxyAuthEnabled())) {
            warn.add("novu.bridge.proxy.auth.enabled=false — the configurator proxy endpoints are unauthenticated");
        }

        warn.forEach(w -> log.warn("novu-bridge config: {}", w));
        if (!fatal.isEmpty()) {
            String message = "novu-bridge refuses to start:\n - " + String.join("\n - ", fatal);
            log.error(message);
            throw new IllegalStateException(message);
        }
    }
}
