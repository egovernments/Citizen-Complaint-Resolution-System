package org.egov.novubridge.service.delivery;

import org.egov.novubridge.service.NovuClient;
import org.egov.novubridge.service.SmsCountryClient;
import org.egov.novubridge.service.policy.ChannelPolicyClient;
import org.egov.novubridge.web.models.Contact;
import org.springframework.stereotype.Component;

import java.util.Map;

/**
 * SMS straight to SMSCountry's legacy bulk API, bypassing Novu. SMS only. The same route is
 * used for live dispatches and operator test-sends, so a test exercises production's path.
 */
@Component
public class SmsCountryDeliveryProvider implements DeliveryProvider {

    public static final String ID = "smscountry";

    private final SmsCountryClient client;
    private final ChannelPolicyClient policy;

    public SmsCountryDeliveryProvider(SmsCountryClient client, ChannelPolicyClient policy) {
        this.client = client;
        this.policy = policy;
    }

    @Override
    public String id() {
        return ID;
    }

    @Override
    public boolean supports(String channel) {
        return "SMS".equalsIgnoreCase(channel);
    }

    @Override
    public DeliveryResult send(Dispatch d) {
        Contact c = d.getContact();
        String senderId = policy.senderId(d.getTenantId(), d.getChannel());
        NovuClient.NovuResponse r = client.send(c != null ? c.getPhone() : null, d.getBody(), d.getTransactionId(), senderId);
        Map<String, Object> raw = r.getResponse();
        if (r.getStatusCode() != null && r.getStatusCode() >= 200 && r.getStatusCode() < 300) {
            Object jobId = raw != null ? raw.get("jobId") : null;
            return DeliveryResult.accepted(r.getStatusCode(), jobId != null ? jobId.toString() : null, raw);
        }
        String code = raw != null && raw.get("error") != null ? raw.get("error").toString() : "NB_SMSCOUNTRY_REJECTED";
        String message = raw != null && raw.get("message") != null ? raw.get("message").toString() : "SMSCountry rejected the message";
        return DeliveryResult.failed(code, message, r.getStatusCode(), raw);
    }
}
