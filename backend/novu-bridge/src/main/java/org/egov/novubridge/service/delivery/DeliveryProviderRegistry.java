package org.egov.novubridge.service.delivery;

import lombok.extern.slf4j.Slf4j;
import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.service.policy.ChannelPolicyClient;
import org.springframework.lang.Nullable;
import org.springframework.stereotype.Component;

/**
 * Picks the {@link DeliveryProvider} for a (tenant, channel) from the tenant's channel policy
 * ({@code gateway} on the MDMS NotificationChannel row; env {@code novu.bridge.sms.provider}
 * as the fallback). Unknown or unwired gateways fall back to Novu with a warning — never to
 * silence.
 */
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

    /**
     * The Novu transport, bypassing policy selection. For callers that have already named one
     * Novu integration explicitly (the configurator's test-send): a direct gateway would
     * ignore that choice and quietly test something else.
     */
    public DeliveryProvider novu() {
        return novu;
    }

    public DeliveryProvider select(@Nullable String tenantId, String channel) {
        // A provider chosen in the configurator is a Novu integration by construction — even
        // the SMSCountry one, which is a generic-sms integration pointing back at this
        // service's adapter. It therefore outranks `gateway`, which only ever named a
        // bridge-internal transport. No provider chosen → the original gateway logic, verbatim.
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
