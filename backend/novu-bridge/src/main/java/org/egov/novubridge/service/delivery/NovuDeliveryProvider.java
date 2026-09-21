package org.egov.novubridge.service.delivery;

import lombok.extern.slf4j.Slf4j;
import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.service.NovuClient;
import org.egov.novubridge.web.models.Contact;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import java.util.HashMap;
import java.util.Map;

/**
 * Delivery through Novu. Owns the Novu-and-Twilio specifics the rest of the bridge must not
 * know about: WhatsApp rides the Twilio {@code sms} integration with a {@code whatsapp:+E164}
 * recipient, an explicit integration override, and an approved Content-template envelope.
 */
@Slf4j
@Component
public class NovuDeliveryProvider implements DeliveryProvider {

    public static final String ID = "novu";
    private static final String NOVU_TRIGGER_FAILED = "NB_NOVU_TRIGGER_FAILED";

    private final NovuClient novuClient;
    private final NovuBridgeConfiguration config;

    public NovuDeliveryProvider(NovuClient novuClient, NovuBridgeConfiguration config) {
        this.novuClient = novuClient;
        this.config = config;
    }

    @Override
    public String id() {
        return ID;
    }

    @Override
    public boolean supports(String channel) {
        return channel != null && (channel.equalsIgnoreCase("SMS")
                || channel.equalsIgnoreCase("WHATSAPP") || channel.equalsIgnoreCase("EMAIL"));
    }

    @Override
    public DeliveryResult send(Dispatch d) {
        if (d.isTest()) {
            return sendTest(d);
        }
        // Twilio requires the WhatsApp recipient as `whatsapp:+<E164 digits>`; PGR emits the bare
        // country-coded number. digitsOnly strips any pre-existing prefix, so this is idempotent.
        Contact contact = d.getContact();
        if (isWhatsapp(d.getChannel()) && contact != null && StringUtils.hasText(contact.getPhone())) {
            contact = Contact.builder()
                    .userId(contact.getUserId()).type(contact.getType()).name(contact.getName())
                    .phone("whatsapp:+" + digitsOnly(contact.getPhone()))
                    .email(contact.getEmail()).locale(contact.getLocale())
                    .build();
        }
        // Two call shapes on purpose. With no tenant-chosen provider the ORIGINAL overload runs
        // untouched, so every deployment without a `provider` on its NotificationChannel row
        // (bomet today) keeps byte-for-byte the behaviour it has now.
        NovuClient.NovuResponse r = StringUtils.hasText(d.getIntegrationIdentifier())
                ? novuClient.identifyThenTrigger(
                        d.getSubscriberId(), contact, d.getChannel(),
                        d.getBody(), d.getSubject(), d.getTransactionId(), d.getData(),
                        d.getTemplateId(), d.getContentVariables(),
                        d.getIntegrationIdentifier(), d.getProviderType())
                : novuClient.identifyThenTrigger(
                        d.getSubscriberId(), contact, d.getChannel(),
                        d.getBody(), d.getSubject(), d.getTransactionId(), d.getData(),
                        d.getTemplateId(), d.getContentVariables());
        return toResult(r, d.getIntegrationIdentifier());
    }

    /**
     * Operator test-send: no subscriber upsert, caller-chosen workflow, same WhatsApp
     * envelope + integration override as the live path so the test proves the real route.
     */
    private DeliveryResult sendTest(Dispatch d) {
        String workflow = StringUtils.hasText(d.getWorkflowOverride())
                ? d.getWorkflowOverride() : config.getNovuWorkflowId(d.getChannel());
        Map<String, Object> payload = new HashMap<>();
        if (d.getData() != null) payload.putAll(d.getData());
        if (d.getBody() != null) payload.put("body", d.getBody());
        if (d.getSubject() != null) payload.put("subject", d.getSubject());
        Contact c = d.getContact();
        String phone = c != null ? c.getPhone() : null;
        String email = c != null ? c.getEmail() : null;

        NovuClient.NovuResponse r;
        if (isWhatsapp(d.getChannel())) {
            Map<String, Object> overrides = StringUtils.hasText(d.getTemplateId())
                    ? NovuClient.buildProviderTemplateOverrides(d.getTemplateId(), d.getContentVariables())
                    : null;
            overrides = novuClient.applyWhatsappIntegrationOverride(overrides, d.getChannel());
            overrides = NovuClient.applyIntegrationOverride(overrides, d.getChannel(), d.getIntegrationIdentifier());
            r = novuClient.trigger(workflow, d.getSubscriberId(), "whatsapp:+" + digitsOnly(phone),
                    payload, d.getTransactionId(), overrides, null);
        } else if (StringUtils.hasText(d.getIntegrationIdentifier())) {
            // The operator asked to test ONE configured provider; pin it, exactly as live
            // dispatch does, so the test proves that provider and not whatever is primary.
            Map<String, Object> overrides =
                    NovuClient.applyIntegrationOverride(null, d.getChannel(), d.getIntegrationIdentifier());
            overrides = NovuClient.applyGatewayBody(overrides, d.getProviderType(),
                    d.getTransactionId(), phone, d.getBody());
            r = novuClient.trigger(workflow, d.getSubscriberId(), phone, payload,
                    d.getTransactionId(), overrides, null);
        } else {
            r = novuClient.trigger(workflow, d.getSubscriberId(), phone, email, payload, d.getTransactionId());
        }
        return toResult(r, d.getIntegrationIdentifier());
    }

    /**
     * @param integrationIdentifier the integration the trigger was pinned to, recorded on the
     *                              accepted result so the dispatch-log row says WHICH provider
     *                              carried the message — otherwise a per-tenant provider switch
     *                              is invisible afterwards. No new column: it rides in the
     *                              provider response that is already persisted as JSON.
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

    private static String digitsOnly(String value) {
        return value == null ? "" : value.replaceAll("\\D", "");
    }
}
