package org.egov.novubridge.service.core;

import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.util.PiiMask;
import org.egov.novubridge.web.models.NotificationEvent;
import org.egov.novubridge.web.models.Contact;
import org.egov.tracer.model.CustomException;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

import java.nio.charset.StandardCharsets;
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
    /** The only category whose {@code expiryTime} is honoured, as in egov-notification-sms. */
    private static final String OTP_CATEGORY = "OTP";
    private static final List<String> PHONE_KEYS = List.of("mobileNumber", "mobile", "phone", "to");
    private static final List<String> MESSAGE_KEYS = List.of("message", "body", "text");
    private static final List<String> TENANT_KEYS = List.of("tenantId", "tenant");
    /** What a DLQ copy drops: the text is the OTP, the reset link or the temporary password. */
    private static final Set<String> DLQ_TEXT_KEYS = Set.of("message", "body", "text", "renderedBody", "subject",
            "contentVariables");
    /** What a DLQ copy masks: phone numbers and the ids that can embed one. */
    private static final Set<String> DLQ_MASKED_KEYS = Set.of("mobileNumber", "mobile", "phone", "to", "email",
            "subscriberId", "transactionId");
    /** Shortest national mobile number read as "already carries the country code" (KE/MZ 9, IN 10). */
    private static final int MIN_NATIONAL_DIGITS = 9;

    private final NovuBridgeConfiguration config;

    public CoreSmsTranslator(NovuBridgeConfiguration config) {
        this.config = config;
    }

    /**
     * Whether the consent gate must be skipped. A core SMS (OTP, password reset) is a transactional
     * message the recipient just asked for, often before they have an account or a userId, so the
     * consent check, which denies a blank userId, would lock them out of login. Promotions still
     * go through the gate.
     *
     * <p>Every field read here is one any producer can write, so this is only ever asked about an
     * envelope {@code CoreSmsConsumer} translated itself
     * ({@code DispatchPipelineService#processCoreSms}); an envelope that merely says
     * {@code CORE_SMS}, from a shared topic or {@code /dispatch/_dry-run}, is gated like any other.
     */
    public static boolean isConsentExempt(NotificationEvent event) {
        return event != null
                && EVENT_TYPE.equalsIgnoreCase(trim(event.getEventType()))
                && MODULE.equals(event.getModule())
                && event.getEventName() != null
                && event.getEventName().startsWith("CORE.SMS.")
                && !event.getEventName().equals("CORE.SMS." + PROMOTION_CATEGORY);
    }

    /**
     * How long ago this OTP expired, in ms, or -1 when it has not (or cannot be judged). The check
     * egov-notification-sms made before sending ("OTP Expired"), with its semantics: only
     * {@code category OTP}; {@code expiryTime} is epoch MILLISECONDS, set by user-otp to
     * now + {@code expiry.time.for.otp}. An absent or non-numeric expiryTime never expires anything.
     */
    public static long expiredForMs(Map<String, Object> sms, long nowMillis) {
        if (sms == null || !OTP_CATEGORY.equalsIgnoreCase(trim(String.valueOf(sms.get("category"))))) {
            return -1;
        }
        Object raw = sms.get("expiryTime");
        long expiry;
        if (raw instanceof Number n) {
            expiry = n.longValue();
        } else if (raw instanceof CharSequence s && s.toString().trim().matches("\\d+")) {
            expiry = Long.parseLong(s.toString().trim());
        } else {
            return -1;
        }
        return expiry < nowMillis ? nowMillis - expiry : -1;
    }

    /**
     * Where one core SMS record sits on the broker: the same on every redelivery of that record and
     * different for every real send, which is what the replay guard needs. The record timestamp is
     * there so a topic deleted and recreated (offsets restart at 0) cannot collide with ledger rows
     * written before it, and suppress a new OTP as "already SENT".
     */
    public static String recordKey(String topic, int partition, long offset, long timestamp) {
        return topic + "-" + partition + "@" + offset + "/" + timestamp;
    }

    /**
     * @param recordKey {@link #recordKey} of the Kafka record: eventId and transactionId are derived
     *                  from it (a name-based UUID), so a redelivered record is recognised as the
     *                  send it already was, and neither id carries the phone number
     */
    public NotificationEvent translate(Map<String, Object> sms, String recordKey) {
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
        String id = UUID.nameUUIDFromBytes((EVENT_TYPE + ":" + recordKey).getBytes(StandardCharsets.UTF_8)).toString();
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
                // SMSRequest has no producer-side id, so the record's own position stands in: every send
                // is its own row (a resent OTP must not upsert over the last), and a redelivery is the
                // same row. No phone in it: the id reaches logs, provider requests and error messages.
                .transactionId("CORE:" + tenant + ":" + id)
                .data(data)
                .build();
    }

    /**
     * A copy of a core-SMS message fit for the DLQ, which keeps records for days and is replayed by
     * hand, past the expiry check that only {@code CoreSmsConsumer} makes. The text is REMOVED, not
     * replaced, so a replay is refused ({@code NB_INVALID_CORE_SMS} or {@code NB_INVALID_EVENT})
     * rather than sending a stale OTP or a placeholder; phones and the ids that can embed one are
     * masked ({@code ***678}). Takes the raw {@code SMSRequest} or the translated envelope (its
     * {@code contact} included) and never mutates it.
     *
     * @param redacted receives the name of every field removed or masked, for the DLQ record
     */
    @SuppressWarnings("unchecked")
    public static Map<String, Object> redactForDlq(Map<String, Object> message, List<String> redacted) {
        if (message == null) return null;
        Map<String, Object> copy = new LinkedHashMap<>(message);
        for (Map.Entry<String, Object> e : message.entrySet()) {
            String key = e.getKey();
            Object value = e.getValue();
            if (value == null) continue;
            if (DLQ_TEXT_KEYS.contains(key)) {
                copy.remove(key);
                redacted.add(key);
            } else if (DLQ_MASKED_KEYS.contains(key)) {
                String masked = PiiMask.maskEmbedded(value.toString());
                if (!masked.equals(value.toString())) {
                    copy.put(key, masked);
                    redacted.add(key);
                }
            } else if ("contact".equals(key) && value instanceof Map) {
                List<String> inner = new ArrayList<>();
                copy.put(key, redactForDlq((Map<String, Object>) value, inner));
                inner.forEach(k -> redacted.add(key + "." + k));
            }
        }
        return copy;
    }

    /**
     * Always {@code +<digits>}. {@code +…} and {@code 00…} (the international prefix) are already
     * international. Otherwise the configured code ({@code +254}, {@code 254} and {@code 00254}
     * all mean 254) is prepended, replacing ONE national trunk {@code 0}, unless the digits already
     * start with it and leave at least {@link #MIN_NATIONAL_DIGITS} after it: user-otp sends
     * national numbers, and India's {@code 9123456789} is national although it starts with 91.
     * With no code configured the digits go out as they are, behind a {@code +} (startup warns).
     */
    static String toE164(String mobile, String countryCode) {
        String m = mobile.trim();
        String digits = m.replaceAll("\\D", "");
        if (m.startsWith("+")) return "+" + digits;
        if (digits.startsWith("00")) return "+" + digits.substring(2);
        String cc = countryCode == null ? "" : countryCode.replaceAll("\\D", "").replaceFirst("^0+", "");
        if (cc.isEmpty()) return "+" + digits;
        if (digits.startsWith("0")) return "+" + cc + digits.substring(1);
        if (digits.startsWith(cc) && digits.length() - cc.length() >= MIN_NATIONAL_DIGITS) return "+" + digits;
        return "+" + cc + digits;
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
