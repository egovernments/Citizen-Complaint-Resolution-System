package org.egov.novubridge.service.core;

import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.web.models.NotificationEvent;
import org.egov.novubridge.web.models.Contact;
import org.egov.tracer.model.CustomException;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import java.time.Instant;
import java.util.*;

/**
 * Translates DIGIT core's {@code SMSRequest} (topic {@code egov.core.notification.sms}: user-otp
 * login OTPs, egov-user password resets) into the v1 envelope, {@code eventType CORE_SMS}.
 * Tolerant of the field names the various core images use; no phone or no message is
 * {@code NB_INVALID_CORE_SMS}.
 */
@Component
public class CoreSmsTranslator {

    public static final String EVENT_TYPE = "CORE_SMS";
    public static final String MODULE = "CORE";
    /** SMSRequest category DIGIT uses for marketing sends; the only core category that is not user-requested. */
    private static final String PROMOTION_CATEGORY = "PROMOTION";
    private static final List<String> PHONE_KEYS = List.of("mobileNumber", "mobile", "phone", "to");
    private static final List<String> MESSAGE_KEYS = List.of("message", "body", "text");
    private static final List<String> TENANT_KEYS = List.of("tenantId", "tenant");

    private final NovuBridgeConfiguration config;

    public CoreSmsTranslator(NovuBridgeConfiguration config) {
        this.config = config;
    }

    /**
     * Whether the consent gate must be skipped. A core SMS (OTP, password reset) is a transactional
     * message the recipient just asked for, often before they have an account or a userId, so the
     * consent check, which denies a blank userId, would lock them out of login. Promotions still
     * go through the gate.
     */
    public static boolean isConsentExempt(NotificationEvent event) {
        return event != null
                && EVENT_TYPE.equalsIgnoreCase(trim(event.getEventType()))
                && MODULE.equals(event.getModule())
                && event.getEventName() != null
                && event.getEventName().startsWith("CORE.SMS.")
                && !event.getEventName().equals("CORE.SMS." + PROMOTION_CATEGORY);
    }

    public NotificationEvent translate(Map<String, Object> sms) {
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
        return NotificationEvent.builder()
                .schemaVersion("1")
                .eventId(id)
                .eventType(EVENT_TYPE)
                .eventTime(Instant.now().toString())
                .producer("digit-core")
                .module(MODULE)
                .eventName("CORE.SMS." + (StringUtils.hasText(category) ? category.trim().toUpperCase(Locale.ROOT) : "GENERIC"))
                .entityType("SMS")
                .entityId(id)
                .tenantId(tenant)
                .channel("SMS")
                .subscriberId(tenant + ":" + phone)
                .contact(Contact.builder().type("CITIZEN").phone(phone).locale(config.getDefaultLocale()).build())
                .renderedBody(message)
                // SMSRequest has no producer-side id: every send is its own row (a resent OTP must not upsert over the last).
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

    private static String trim(String s) {
        return s == null ? null : s.trim();
    }
}
