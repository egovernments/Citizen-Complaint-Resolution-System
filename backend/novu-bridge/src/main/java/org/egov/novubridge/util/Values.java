package org.egov.novubridge.util;

import org.springframework.util.StringUtils;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/** Small helpers for the loosely-typed JSON maps the bridge reads from Novu, MDMS and request bodies. */
public final class Values {

    private Values() {
    }

    public static String str(Object value) {
        return value == null ? null : value.toString();
    }

    @SuppressWarnings("unchecked")
    public static Map<String, Object> asMap(Object value) {
        return value instanceof Map ? (Map<String, Object>) value : null;
    }

    @SuppressWarnings("unchecked")
    public static List<Object> asList(Object value) {
        return value instanceof List ? (List<Object>) value : null;
    }

    /** Novu answers {@code {data:{...}}} or a bare object; never null. */
    public static Map<String, Object> unwrapData(Map<String, Object> body) {
        if (body == null) {
            return new LinkedHashMap<>();
        }
        Map<String, Object> data = asMap(body.get("data"));
        return data != null ? data : body;
    }

    /** JSON booleans arrive as Boolean; forms sometimes send the string. */
    public static boolean truthy(Object value) {
        return value instanceof Boolean b ? b : Boolean.parseBoolean(String.valueOf(value).trim());
    }

    public static String firstText(String... values) {
        for (String v : values) {
            if (StringUtils.hasText(v)) {
                return v;
            }
        }
        return null;
    }

    public static String lower(String value) {
        return value == null ? null : value.trim().toLowerCase(Locale.ROOT);
    }

    public static String sha256Hex(String value) {
        try {
            return HexFormat.of().formatHex(
                    MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is mandatory on every JVM", e);
        }
    }

    /** First 16 hex chars of SHA-256(seed): deterministic, no clock/random. */
    public static String stableId(String seed) {
        return sha256Hex(seed).substring(0, 16);
    }

    /**
     * A deterministic id shaped as a canonical UUID: the first 128 bits of SHA-256(seed) with the
     * RFC 9562 version-8 (custom) and variant bits set. For ids that reach the Logs API, whose
     * masking ({@link PiiMask}) leaves a canonical UUID alone but masks any 7+ digit run in other
     * hex ({@link #stableId}'s 16 hex chars hold one in about one id in six).
     */
    public static String stableUuid(String seed) {
        byte[] hash = HexFormat.of().parseHex(sha256Hex(seed));
        hash[6] = (byte) ((hash[6] & 0x0f) | 0x80);
        hash[8] = (byte) ((hash[8] & 0x3f) | 0x80);
        long msb = 0;
        long lsb = 0;
        for (int i = 0; i < 8; i++) {
            msb = (msb << 8) | (hash[i] & 0xff);
            lsb = (lsb << 8) | (hash[i + 8] & 0xff);
        }
        return new java.util.UUID(msb, lsb).toString();
    }

    /** SMS and WHATSAPP deliver on Novu's {@code sms} channel (WhatsApp rides Twilio SMS); EMAIL on {@code email}. */
    public static String novuChannel(String channel) {
        if (!StringUtils.hasText(channel)) {
            return null;
        }
        return switch (channel.trim().toUpperCase(Locale.ROOT)) {
            case "SMS", "WHATSAPP" -> "sms";
            case "EMAIL" -> "email";
            default -> null;
        };
    }
}
