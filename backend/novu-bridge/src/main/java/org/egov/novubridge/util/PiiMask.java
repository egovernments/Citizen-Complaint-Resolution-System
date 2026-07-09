package org.egov.novubridge.util;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Server-side PII masking for values that leave novu-bridge in an API response
 * or a log line. Mirrors the configurator's client-side {@code maskRecipient()}
 * rules so operators see identical shapes regardless of which layer masked.
 *
 * <ul>
 *   <li>Emails keep the first char of the local part: {@code c***@example.org}.</li>
 *   <li>Runs of 7+ digits (phone numbers) collapse to {@code ***} + their last 3
 *       digits: {@code 0712345678 -> ***678}.</li>
 *   <li>UUIDs (hex + dashes, no 7+-digit run) pass through untouched — they are
 *       not PII.</li>
 * </ul>
 */
public final class PiiMask {

    // A phone-number-shaped run: 7 or more consecutive digits.
    private static final Pattern LONG_DIGIT_RUN = Pattern.compile("\\d{7,}");
    // An email token inside an arbitrary (e.g. colon-delimited) string.
    private static final Pattern EMAIL_TOKEN = Pattern.compile("[^\\s:;,]+@[^\\s:;,]+");

    private PiiMask() {
    }

    /**
     * Mask a single recipient value. A value containing {@code @} is treated as an
     * email; otherwise any 7+-digit run is masked. UUIDs pass through unchanged.
     */
    public static String mask(String value) {
        if (value == null) {
            return null;
        }
        if (value.indexOf('@') >= 0) {
            return maskEmail(value);
        }
        return maskDigits(value);
    }

    /**
     * Mask PII embedded anywhere in an arbitrary string (e.g. a transaction id like
     * {@code complaintId:action:toState:tenant:mobile:channel} whose subscriber
     * segment can be a phone or email). Applies the digit-run rule everywhere and
     * the email rule to each embedded email token.
     */
    public static String maskEmbedded(String value) {
        if (value == null) {
            return null;
        }
        String masked = maskDigits(value);
        if (masked.indexOf('@') >= 0) {
            Matcher m = EMAIL_TOKEN.matcher(masked);
            StringBuffer sb = new StringBuffer();
            while (m.find()) {
                m.appendReplacement(sb, Matcher.quoteReplacement(maskEmail(m.group())));
            }
            m.appendTail(sb);
            masked = sb.toString();
        }
        return masked;
    }

    /**
     * Recursively mask PII in a JSON-shaped structure (maps / lists / strings) —
     * e.g. the {@code providerResponse} delivery receipt echoed on each
     * {@code /logs} row, whose Novu acknowledgment carries the raw transactionId
     * (which embeds the subscriber segment: a raw phone number whenever the
     * recipient had no uuid). Every String value goes through
     * {@link #maskEmbedded}; non-string leaves (booleans like {@code test},
     * numbers like {@code novuStatus} / HTTP status codes) pass through with
     * their exact values, so consumers keyed on them keep working. Returns a
     * new structure — the input is never mutated.
     */
    public static Map<String, Object> maskDeep(Map<String, Object> value) {
        if (value == null) {
            return null;
        }
        Map<String, Object> out = new LinkedHashMap<>(value.size());
        for (Map.Entry<String, Object> e : value.entrySet()) {
            out.put(e.getKey(), maskDeepValue(e.getValue()));
        }
        return out;
    }

    @SuppressWarnings("unchecked")
    private static Object maskDeepValue(Object value) {
        if (value instanceof String) {
            return maskEmbedded((String) value);
        }
        if (value instanceof Map) {
            return maskDeep((Map<String, Object>) value);
        }
        if (value instanceof List) {
            List<Object> in = (List<Object>) value;
            List<Object> out = new ArrayList<>(in.size());
            for (Object item : in) {
                out.add(maskDeepValue(item));
            }
            return out;
        }
        return value;   // numbers, booleans, nulls: not PII, keep exact
    }

    private static String maskEmail(String value) {
        int at = value.indexOf('@');
        if (at < 0) {
            return value;
        }
        String local = value.substring(0, at);
        String domainWithAt = value.substring(at);
        String firstChar = local.isEmpty() ? "" : local.substring(0, 1);
        return firstChar + "***" + domainWithAt;
    }

    private static String maskDigits(String value) {
        Matcher m = LONG_DIGIT_RUN.matcher(value);
        StringBuffer sb = new StringBuffer();
        while (m.find()) {
            String run = m.group();
            String last3 = run.substring(run.length() - 3);
            m.appendReplacement(sb, Matcher.quoteReplacement("***" + last3));
        }
        m.appendTail(sb);
        return sb.toString();
    }
}
