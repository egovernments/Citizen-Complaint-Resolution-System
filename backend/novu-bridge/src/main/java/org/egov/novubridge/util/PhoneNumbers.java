package org.egov.novubridge.util;

import org.springframework.util.StringUtils;

import java.util.regex.Pattern;

/**
 * E.164 for the phone numbers DIGIT hands the bridge. DIGIT stores a mobile number nationally
 * ({@code 0712345678}, {@code 712345678}, India's {@code 9123456789}) and its country code apart,
 * when at all (egov-user {@code countryCode}, a tenant's {@code common-masters.MobileNumberValidation}),
 * so every sender has to put the two together, and getting it wrong sends to someone else or to
 * nobody: {@code +762061507} is not a Kenyan number.
 */
public final class PhoneNumbers {

    /** Shortest national mobile number read as "already carries the country code" (KE/MZ 9, IN 10). */
    static final int MIN_NATIONAL_DIGITS = 9;

    /** The {@code (0)} of {@code +254 (0) 712345678}: the national trunk prefix, never dialled from abroad. */
    private static final Pattern TRUNK_MARKER = Pattern.compile("\\(\\s*0\\s*\\)");

    private PhoneNumbers() {
    }

    /** Already international: {@code +…} or the {@code 00} international prefix. */
    public static boolean isInternational(String phone) {
        if (!StringUtils.hasText(phone)) {
            return false;
        }
        String p = withoutTrunkMarker(phone);
        return p.startsWith("+") || p.replaceAll("[\\s()\\-.]", "").startsWith("00");
    }

    /**
     * The digits of a dialling code ({@code +254}, {@code 254} and {@code 00254} all mean 254), or
     * null when it is blank or not 1-4 digits (E.164 country codes are at most three; four allows
     * the {@code +1 xxx} NANP forms some masters carry).
     */
    public static String dialDigits(String countryCode) {
        if (!StringUtils.hasText(countryCode)) {
            return null;
        }
        String digits = countryCode.replaceAll("\\D", "").replaceFirst("^0+", "");
        return digits.matches("[1-9][0-9]{0,3}") ? digits : null;
    }

    /** {@link #toE164(String, String, Pattern)} without the tenant's national number pattern. */
    public static String toE164(String phone, String countryCode) {
        return toE164(phone, countryCode, null);
    }

    /**
     * {@code +<digits>}, or null when it cannot be made E.164 — NEVER a bare {@code +} in front of
     * a national number.
     *
     * <ul>
     *   <li>{@code +…} and {@code 00…} are already international (separators and a {@code (0)}
     *       trunk marker dropped: {@code +254 (0) 712345678} is {@code +254712345678}).</li>
     *   <li>Otherwise the country code is prepended, replacing ONE national trunk {@code 0}.</li>
     *   <li>Digits that start with the country code are ambiguous: national, or international
     *       without the {@code +}. With the tenant's {@code mobileNumberRegex} ({@code national}),
     *       the reading that matches it wins when exactly one does: India's {@code 9123456789}
     *       matches {@code ^[6-9][0-9]{9}$} as it is, so it is national although it starts with
     *       91; Kenya's {@code 254712345678} matches {@code ^[17][0-9]{8}$} only without its 254.
     *       Otherwise (no pattern: the deployment's fallback code, or a rule without one; or both
     *       readings or neither match) a number that leaves at least {@value #MIN_NATIONAL_DIGITS}
     *       digits after the code is read as already carrying it. That heuristic misreads a long
     *       national number that happens to start with the code, e.g. a German {@code 49112345678}
     *       (area code 491) on a box whose code is 49 — it goes to {@code +49112345678}. A tenant
     *       rule with a pattern that number matches avoids it.</li>
     *   <li>A national number and no usable country code: null. The caller decides (the dispatch
     *       pipeline records {@code SKIPPED / NB_CONTACT_INVALID}).</li>
     * </ul>
     *
     * @param national the tenant's national mobile number pattern ({@code mobileNumberRegex}), or
     *                 null when there is none
     */
    public static String toE164(String phone, String countryCode, Pattern national) {
        if (!StringUtils.hasText(phone)) {
            return null;
        }
        String p = withoutTrunkMarker(phone);
        String digits = p.replaceAll("\\D", "");
        if (digits.isEmpty()) {
            return null;
        }
        if (p.startsWith("+")) {
            return "+" + digits;
        }
        if (digits.startsWith("00")) {
            String rest = digits.substring(2);
            return rest.isEmpty() ? null : "+" + rest;
        }
        String cc = dialDigits(countryCode);
        if (cc == null) {
            return null;
        }
        if (digits.startsWith("0")) {
            String withoutTrunk = digits.substring(1);
            return withoutTrunk.isEmpty() ? null : "+" + cc + withoutTrunk;
        }
        if (national != null && digits.startsWith(cc)) {
            boolean asNational = national.matcher(digits).matches();
            boolean asInternational = national.matcher(digits.substring(cc.length())).matches();
            if (asNational != asInternational) {
                return asNational ? "+" + cc + digits : "+" + digits;
            }
        }
        if (digits.startsWith(cc) && digits.length() - cc.length() >= MIN_NATIONAL_DIGITS) {
            return "+" + digits;
        }
        return "+" + cc + digits;
    }

    private static String withoutTrunkMarker(String phone) {
        return TRUNK_MARKER.matcher(phone.trim()).replaceAll(" ").trim();
    }
}
