package org.egov.novubridge.service.delivery;

import org.egov.novubridge.service.NovuClient;
import org.egov.novubridge.service.account.NovuAccount;
import org.egov.novubridge.util.Values;
import org.egov.novubridge.web.models.Contact;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import java.util.HashMap;
import java.util.Map;

/**
 * Delivery through Novu. Owns the Novu/Twilio specifics: WhatsApp rides the Twilio {@code sms}
 * integration with a {@code whatsapp:+E164} recipient, an integration override and an approved
 * Content-template envelope. A {@link Dispatch#getNovuAccount() tenant account} sends through that
 * tenant's own Novu organization; none, through the shared account exactly as before #2203.
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
        NovuClient.NovuResponse r = d.getNovuAccount() == null
                ? novuClient.identifyThenTrigger(
                        d.getSubscriberId(), contact, d.getChannel(),
                        d.getBody(), d.getSubject(), d.getTransactionId(), d.getData(),
                        d.getTemplateId(), d.getContentVariables(),
                        d.getIntegrationIdentifier())
                : novuClient.identifyThenTrigger(d.getNovuAccount(),
                        d.getSubscriberId(), contact, d.getChannel(),
                        d.getBody(), d.getSubject(), d.getTransactionId(), d.getData(),
                        d.getTemplateId(), d.getContentVariables(),
                        d.getIntegrationIdentifier());
        return toResult(r, d.getIntegrationIdentifier(), d.getNovuAccount());
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
        if (d.getNovuAccount() == null) {
            // The deployment-wide WhatsApp pin names an integration of the shared account only.
            overrides = novuClient.applyWhatsappIntegrationOverride(overrides, d.getChannel());
        }
        overrides = NovuClient.applyIntegrationOverride(overrides, d.getChannel(), d.getIntegrationIdentifier());
        String to = whatsapp ? whatsappAddress(phone) : phone;
        NovuClient.NovuResponse r = d.getNovuAccount() == null
                ? novuClient.trigger(d.getWorkflowOverride(), d.getSubscriberId(), to, email, payload,
                        d.getTransactionId(), overrides)
                : novuClient.trigger(d.getNovuAccount(), d.getWorkflowOverride(), d.getSubscriberId(), to, email,
                        payload, d.getTransactionId(), overrides);
        return toResult(r, d.getIntegrationIdentifier(), d.getNovuAccount());
    }

    /**
     * The pinned integration is recorded on the result so the dispatch-log row says which provider
     * carried the message; it rides in the already-persisted provider response.
     */
    private static DeliveryResult toResult(NovuClient.NovuResponse r, String integrationIdentifier, NovuAccount account) {
        Integer sc = r != null ? r.getStatusCode() : null;
        Map<String, Object> raw = r != null ? r.getResponse() : null;
        if (StringUtils.hasText(integrationIdentifier)) {
            raw = raw == null ? new HashMap<>() : new HashMap<>(raw);
            raw.put("integrationIdentifier", integrationIdentifier);
        }
        if (account != null) {
            // The Logs screen shows which Novu account carried it; absent = the shared one.
            raw = raw == null ? new HashMap<>() : new HashMap<>(raw);
            raw.put("novuAccount", NovuAccount.label(account));
        }
        boolean accepted = sc != null && sc >= 200 && sc < 300;
        if (!accepted) {
            return DeliveryResult.failed(NOVU_TRIGGER_FAILED, "Novu returned status " + sc, sc, raw);
        }
        // The trigger answers {"data":{"acknowledged":…,"transactionId":…}}.
        Object ref = Values.unwrapData(raw).get("transactionId");
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
