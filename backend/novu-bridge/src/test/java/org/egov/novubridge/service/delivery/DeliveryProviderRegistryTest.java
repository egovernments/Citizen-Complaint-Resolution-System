package org.egov.novubridge.service.delivery;

import org.egov.novubridge.service.policy.ChannelPolicyClient;

import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.service.NovuClient;
import org.egov.novubridge.service.SmsCountryClient;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertSame;
import static org.mockito.Mockito.mock;

class DeliveryProviderRegistryTest {

    private final NovuBridgeConfiguration config = new NovuBridgeConfiguration();
    private final NovuDeliveryProvider novu = new NovuDeliveryProvider(mock(NovuClient.class), config);
    private final ChannelPolicyClient policy = new ChannelPolicyClient(null, config);
    private final SmsCountryDeliveryProvider smsCountry = new SmsCountryDeliveryProvider(mock(SmsCountryClient.class), policy);

    @Test
    void defaultsToNovuForEveryChannel() {
        config.setSmsProvider("");
        DeliveryProviderRegistry r = new DeliveryProviderRegistry(config, policy, novu, smsCountry);
        assertSame(novu, r.select("ke", "SMS"));
        assertSame(novu, r.select("ke", "EMAIL"));
        assertSame(novu, r.select("ke", "WHATSAPP"));
    }

    @Test
    void smscountryOnlyTakesTheSmsLeg() {
        config.setSmsProvider("smscountry");
        DeliveryProviderRegistry r = new DeliveryProviderRegistry(config, policy, novu, smsCountry);
        assertSame(smsCountry, r.select("ke", "SMS"));
        assertSame(smsCountry, r.select(null, "sms"));
        assertSame(novu, r.select("ke", "WHATSAPP"));
        assertSame(novu, r.select("ke", "EMAIL"));
    }

    @Test
    void fallsBackToNovuWhenTheDirectGatewayIsNotWired() {
        config.setSmsProvider("smscountry");
        DeliveryProviderRegistry r = new DeliveryProviderRegistry(config, policy, novu, null);
        assertSame(novu, r.select("ke", "SMS"));
    }
}
