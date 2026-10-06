package org.egov.novubridge.service.delivery;

import org.egov.novubridge.service.policy.ChannelPolicyClient;

import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.service.NovuClient;
import org.egov.novubridge.service.SmsCountryClient;
import org.egov.novubridge.web.models.Contact;
import org.junit.jupiter.api.Test;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/** The gateway's own codes reach the pipeline verbatim — never a borrowed Novu code. */
class SmsCountryDeliveryProviderTest {

    private final SmsCountryClient client = mock(SmsCountryClient.class);
    private final NovuBridgeConfiguration config = new NovuBridgeConfiguration();
    private final SmsCountryDeliveryProvider provider = new SmsCountryDeliveryProvider(client, new ChannelPolicyClient(null, config));

    private Dispatch sms() {
        return Dispatch.builder().channel("SMS").subscriberId("ke:uuid-1")
                .contact(Contact.builder().phone("+254712345678").build())
                .body("hello").transactionId("txn-1").build();
    }

    @Test
    void supportsSmsOnly() {
        assertTrue(provider.supports("SMS"));
        assertTrue(provider.supports("sms"));
        assertFalse(provider.supports("EMAIL"));
        assertFalse(provider.supports("WHATSAPP"));
        assertEquals("smscountry", provider.id());
    }

    @Test
    void queuedResponseIsAcceptedWithTheJobIdAsReference() {
        NovuClient.NovuResponse ok = new NovuClient.NovuResponse();
        ok.setStatusCode(200); ok.setResponse(Map.of("jobId", "4689046446", "accepted", true));
        when(client.send(eq("+254712345678"), eq("hello"), eq("txn-1"), any())).thenReturn(ok);

        DeliveryResult r = provider.send(sms());
        assertTrue(r.isAccepted());
        assertEquals("4689046446", r.getProviderRef());
        assertNull(r.getProviderCode());
    }

    @Test
    void rejectionCarriesTheGatewaysOwnCode() {
        NovuClient.NovuResponse bad = new NovuClient.NovuResponse();
        bad.setStatusCode(502); bad.setResponse(Map.of("error", "NB_SMSCOUNTRY_REJECTED", "message", "Invalid Sender ID"));
        when(client.send(anyString(), anyString(), anyString(), any())).thenReturn(bad);

        DeliveryResult r = provider.send(sms());
        assertFalse(r.isAccepted());
        assertEquals("NB_SMSCOUNTRY_REJECTED", r.getProviderCode());
        assertEquals("Invalid Sender ID", r.getProviderMessage());
        assertEquals(502, r.getStatusCode());
    }
}
