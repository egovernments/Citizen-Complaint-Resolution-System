package org.egov.novubridge.service.delivery;

import lombok.extern.slf4j.Slf4j;
import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.service.policy.ChannelPolicyClient;
import org.springframework.lang.Nullable;
import org.springframework.stereotype.Component;

/** Picks the transport for a (tenant, channel). Unknown or unwired gateways fall back to Novu, never to silence. */
@Slf4j
@Component
public class DeliveryProviderRegistry {

    private final NovuBridgeConfiguration config;
    private final ChannelPolicyClient policy;
    private final NovuDeliveryProvider novu;
    private final SmsCountryDeliveryProvider smsCountry;

    public DeliveryProviderRegistry(NovuBridgeConfiguration config,
                                    ChannelPolicyClient policy,
                                    NovuDeliveryProvider novu,
                                    @Nullable SmsCountryDeliveryProvider smsCountry) {
        this.config = config;
        this.policy = policy;
        this.novu = novu;
        this.smsCountry = smsCountry;
    }

    /** Bypasses policy: for a caller that named a Novu integration, which a direct gateway would ignore. */
    public DeliveryProvider novu() {
        return novu;
    }

    public DeliveryProvider select(@Nullable String tenantId, String channel) {
        // A pinned provider is a Novu integration by construction (even SMSCountry, via our adapter),
        // so it outranks `gateway`.
        String provider = policy.provider(tenantId, channel);
        if (provider != null) {
            return novu;
        }
        String gateway = policy.gateway(tenantId, channel);
        if (SmsCountryDeliveryProvider.ID.equals(gateway)) {
            if (smsCountry != null && smsCountry.supports(channel)) {
                return smsCountry;
            }
            log.warn("Gateway '{}' requested for tenant {} channel {} but it is not wired or does not carry that channel; using Novu",
                    gateway, tenantId, channel);
        } else if (!NovuDeliveryProvider.ID.equals(gateway)) {
            log.warn("Unknown gateway '{}' for tenant {} channel {}; using Novu", gateway, tenantId, channel);
        }
        return novu;
    }
}
