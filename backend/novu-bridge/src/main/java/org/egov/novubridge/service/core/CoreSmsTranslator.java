package org.egov.novubridge.service.core;

import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.web.models.ComplaintsDomainEvent;
import org.egov.novubridge.web.models.Contact;
import org.egov.tracer.model.CustomException;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import java.time.Instant;
import java.util.*;

/**
 * The ONE compatibility translator for DIGIT core's SMS topic ({@code egov.core.notification.sms}).
 * Core services we don't control (user-otp for login OTPs, egov-user for password resets, …)
 * publish an {@code SMSRequest} there; this turns it into the bridge's v1 envelope
 * ({@code eventType CORE_SMS}) so it flows through the same gates, provider selection and
 * dispatch log as everything else. The topic is the contract — not the shape of the fields —
 * which is why this lives here and not as a sniffing branch in the pipeline.
 *
 * <p>Tolerant of the field names the various core images use ({@code mobileNumber}/{@code mobile},
 * {@code message}/{@code body}); anything without a phone and a message is
 * {@code NB_INVALID_CORE_SMS}. Verify the deployed image's {@code SMSRequest} against this list
 * before relying on {@code category}/{@code tenantId}.
 */
@Component
public class CoreSmsTranslator {

    public static final String EVENT_TYPE = "CORE_SMS";
    private static final List<String> PHONE_KEYS = List.of("mobileNumber", "mobile", "phone", "to");
    private static final List<String> MESSAGE_KEYS = List.of("message", "body", "text");
    private static final List<String> TENANT_KEYS = List.of("tenantId", "tenant");

    private final NovuBridgeConfiguration config;

    public CoreSmsTranslator(NovuBridgeConfiguration config) {
        this.config = config;
    }

    public ComplaintsDomainEvent translate(Map<String, Object> sms) {
        if (sms == null) throw new CustomException("NB_INVALID_CORE_SMS", "empty SMSRequest");
        String mobile = first(sms, PHONE_KEYS);
        String message = first(sms, MESSAGE_KEYS);
        if (!StringUtils.hasText(mobile) || !StringUtils.hasText(message)) {
            throw new CustomException("NB_INVALID_CORE_SMS", "SMSRequest needs mobileNumber and message");
        }
        String tenant = first(sms, TENANT_KEYS);
        if (!StringUtils.hasText(tenant)) tenant = config.getCoreSmsDefaultTenant();
        if (!StringUtils.hasText(tenant)) {
            throw new CustomException("NB_INVALID_CORE_SMS",
                    "SMSRequest carries no tenantId and novu.bridge.core.sms.default.tenant is blank");
        }
        String category = first(sms, List.of("category"));
        String phone = toE164(mobile, config.getCoreSmsCountryCode());
        String id = UUID.randomUUID().toString();
        Map<String, Object> data = new LinkedHashMap<>();
        if (StringUtils.hasText(category)) data.put("category", category);
        if (sms.get("expiryTime") != null) data.put("expiryTime", sms.get("expiryTime"));
        return ComplaintsDomainEvent.builder()
                .schemaVersion("1")
                .eventId(id)
                .eventType(EVENT_TYPE)
                .eventTime(Instant.now().toString())
                .producer("digit-core")
                .module("CORE")
                .eventName("CORE.SMS." + (StringUtils.hasText(category) ? category.trim().toUpperCase(Locale.ROOT) : "GENERIC"))
                .entityType("SMS")
                .entityId(id)
                .tenantId(tenant)
                .channel("SMS")
                .subscriberId(tenant + ":" + phone)
                .contact(Contact.builder().type("CITIZEN").phone(phone).locale(config.getDefaultLocale()).build())
                .renderedBody(message)
                // No producer-side id exists on SMSRequest: every send is its own row (a resent OTP
                // must not upsert over the previous one).
                .transactionId("CORE:" + tenant + ":" + phone + ":" + id)
                .data(data)
                .build();
    }

    /** '+' numbers pass through; otherwise prepend the configured country code, dropping national leading zeros. */
    static String toE164(String mobile, String countryCode) {
        String m = mobile.trim();
        if (m.startsWith("+")) return "+" + m.substring(1).replaceAll("\\D", "");
        String digits = m.replaceAll("\\D", "");
        if (!StringUtils.hasText(countryCode)) return digits;
        return countryCode.trim() + digits.replaceFirst("^0+", "");
    }

    private static String first(Map<String, Object> m, List<String> keys) {
        for (String k : keys) {
            Object v = m.get(k);
            if (v != null && StringUtils.hasText(v.toString())) return v.toString();
        }
        return null;
    }
}
