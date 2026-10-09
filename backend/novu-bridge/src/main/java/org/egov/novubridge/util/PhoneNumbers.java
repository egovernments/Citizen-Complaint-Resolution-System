package org.egov.novubridge.util;

import org.springframework.util.StringUtils;

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

    private PhoneNumbers() {
    }

    /** Already international: {@code +…} or the {@code 00} international prefix. */
    public static boolean isInternational(String phone) {
        if (!StringUtils.hasText(phone)) {
            return false;
        }
        String p = phone.trim();
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

    /**
     * {@code +<digits>}, or null when it cannot be made E.164 — NEVER a bare {@code +} in front of
     * a national number.
     *
     * <ul>
     *   <li>{@code +…} and {@code 00…} are already international (separators dropped).</li>
     *   <li>Otherwise the country code is prepended, replacing ONE national trunk {@code 0}, unless
     *       the digits already start with it and leave at least {@value #MIN_NATIONAL_DIGITS}
     *       after it: India's {@code 9123456789} is national although it starts with 91, while
     *       Kenya's {@code 254712345678} already carries 254.</li>
     *   <li>A national number and no usable country code: null. The caller decides (the dispatch
     *       pipeline records {@code SKIPPED / NB_CONTACT_INVALID}).</li>
     * </ul>
     */
    public static String toE164(String phone, String countryCode) {
        if (!StringUtils.hasText(phone)) {
            return null;
        }
        String p = phone.trim();
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
            String national = digits.substring(1);
            return national.isEmpty() ? null : "+" + cc + national;
        }
        if (digits.startsWith(cc) && digits.length() - cc.length() >= MIN_NATIONAL_DIGITS) {
            return "+" + digits;
        }
        return "+" + cc + digits;
    }
}
