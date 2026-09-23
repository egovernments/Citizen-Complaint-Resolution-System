package org.egov.novubridge.service.delivery;

import org.egov.novubridge.service.NovuClient;
import org.egov.novubridge.web.models.Contact;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import java.util.HashMap;
import java.util.Map;

/**
 * Delivery through Novu. Owns the Novu/Twilio specifics: WhatsApp rides the Twilio {@code sms}
 * integration with a {@code whatsapp:+E164} recipient, an integration override and an approved
 * Content-template envelope.
 */
@Component
public class NovuDeliveryProvider implements DeliveryProvider {

    public static final String ID = "novu";
    private static final String NOVU_TRIGGER_FAILED = "NB_NOVU_TRIGGER_FAILED";

    private final NovuClient novuClient;

    public NovuDeliveryProvider(NovuClient novuClient) {
        this.novuClient = novuClient;
    }

    @Override
    public String id() {
        return ID;
    }

    @Override
    public DeliveryResult send(Dispatch d) {
        if (d.isTest()) {
            return sendTest(d);
        }
        Contact contact = d.getContact();
        if (isWhatsapp(d.getChannel()) && contact != null && StringUtils.hasText(contact.getPhone())) {
            contact = contact.toBuilder().phone(whatsappAddress(contact.getPhone())).build();
        }
        NovuClient.NovuResponse r = novuClient.identifyThenTrigger(
                d.getSubscriberId(), contact, d.getChannel(),
                d.getBody(), d.getSubject(), d.getTransactionId(), d.getData(),
                d.getTemplateId(), d.getContentVariables(),
                d.getIntegrationIdentifier(), d.getProviderType());
        return toResult(r, d.getIntegrationIdentifier());
    }

    /** Operator test-send: no subscriber upsert, caller-chosen workflow, otherwise the live route. */
    private DeliveryResult sendTest(Dispatch d) {
        Map<String, Object> payload = new HashMap<>();
        if (d.getData() != null) payload.putAll(d.getData());
        if (d.getBody() != null) payload.put("body", d.getBody());
        if (d.getSubject() != null) payload.put("subject", d.getSubject());
        Contact c = d.getContact();
        String phone = c != null ? c.getPhone() : null;
        String email = c != null ? c.getEmail() : null;

        boolean whatsapp = isWhatsapp(d.getChannel());
        Map<String, Object> overrides = whatsapp && StringUtils.hasText(d.getTemplateId())
                ? NovuClient.buildProviderTemplateOverrides(d.getTemplateId(), d.getContentVariables())
                : null;
        overrides = novuClient.applyWhatsappIntegrationOverride(overrides, d.getChannel());
        overrides = NovuClient.applyIntegrationOverride(overrides, d.getChannel(), d.getIntegrationIdentifier());
        if (!whatsapp) {
            overrides = NovuClient.applyGatewayBody(overrides, d.getProviderType(),
                    d.getTransactionId(), phone, d.getBody());
        }
        NovuClient.NovuResponse r = novuClient.trigger(d.getWorkflowOverride(), d.getSubscriberId(),
                whatsapp ? whatsappAddress(phone) : phone, email, payload, d.getTransactionId(), overrides);
        return toResult(r, d.getIntegrationIdentifier());
    }

    /**
     * The pinned integration is recorded on the result so the dispatch-log row says which provider
     * carried the message; it rides in the already-persisted provider response.
     */
    private static DeliveryResult toResult(NovuClient.NovuResponse r, String integrationIdentifier) {
        Integer sc = r != null ? r.getStatusCode() : null;
        Map<String, Object> raw = r != null ? r.getResponse() : null;
        if (StringUtils.hasText(integrationIdentifier)) {
            raw = raw == null ? new HashMap<>() : new HashMap<>(raw);
            raw.put("integrationIdentifier", integrationIdentifier);
        }
        boolean accepted = sc != null && sc >= 200 && sc < 300;
        if (!accepted) {
            return DeliveryResult.failed(NOVU_TRIGGER_FAILED, "Novu returned status " + sc, sc, raw);
        }
        Object ref = raw != null ? raw.get("transactionId") : null;
        return DeliveryResult.accepted(sc, ref != null ? ref.toString() : null, raw);
    }

    private static boolean isWhatsapp(String channel) {
        return "WHATSAPP".equalsIgnoreCase(channel);
    }

    /** Twilio wants {@code whatsapp:+<digits>}; stripping non-digits first makes this idempotent. */
    private static String whatsappAddress(String phone) {
        return "whatsapp:+" + (phone == null ? "" : phone.replaceAll("\\D", ""));
    }
}
