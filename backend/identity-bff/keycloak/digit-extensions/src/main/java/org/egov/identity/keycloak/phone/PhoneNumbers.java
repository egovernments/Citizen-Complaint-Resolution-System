package org.egov.identity.keycloak.phone;

import java.util.Optional;
import java.util.regex.Pattern;

/**
 * E.164 normalisation against a tenant's {@link MobileValidation}.
 *
 * <p>Deliberately small instead of shading libphonenumber: DIGIT already
 * describes what a valid number is per tenant (country code + national regex),
 * and the legacy citizen UI validates exactly that. Accepted inputs, for a
 * tenant with {@code +254} / {@code ^[71][0-9]{8}$}:
 * {@code 712345678}, {@code 0712 345 678}, {@code 254712345678},
 * {@code +254 712-345-678}, {@code 00254712345678}. A number carrying a
 * different country code is rejected rather than reinterpreted.
 */
public final class PhoneNumbers {

    public static final Pattern E164 = Pattern.compile("^\\+[1-9][0-9]{6,14}$");
    private static final Pattern SEPARATORS = Pattern.compile("[\\s\\-().\\u00A0]");
    private static final Pattern DIGITS = Pattern.compile("^[0-9]+$");
    private static final int MAX_INPUT_LENGTH = 32;

    private PhoneNumbers() {
    }

    public static Optional<String> normalize(String raw, MobileValidation validation) {
        if (raw == null || validation == null) {
            return Optional.empty();
        }
        String input = raw.strip();
        if (input.isEmpty() || input.length() > MAX_INPUT_LENGTH) {
            return Optional.empty();
        }
        input = SEPARATORS.matcher(input).replaceAll("");
        String countryCode = validation.countryCode();
        String countryDigits = countryCode.substring(1);

        String national;
        if (input.startsWith("+")) {
            if (!input.startsWith(countryCode)) {
                return Optional.empty();
            }
            national = input.substring(countryCode.length());
        } else if (input.startsWith("00" + countryDigits) && !validation.matchesNational(input)) {
            national = input.substring(2 + countryDigits.length());
        } else if (validation.matchesNational(input)) {
            national = input;
        } else if (input.startsWith(countryDigits)
                && validation.matchesNational(input.substring(countryDigits.length()))) {
            national = input.substring(countryDigits.length());
        } else if (input.startsWith("0") && validation.matchesNational(input.substring(1))) {
            // national trunk prefix, e.g. 0712345678 in Kenya
            national = input.substring(1);
        } else {
            return Optional.empty();
        }

        if (!DIGITS.matcher(national).matches() || !validation.matchesNational(national)) {
            return Optional.empty();
        }
        String e164 = countryCode + national;
        return E164.matcher(e164).matches() ? Optional.of(e164) : Optional.empty();
    }

    /**
     * The national part of an E.164 number for the tenant's country code
     * ({@code +254712345678} -> {@code 712345678}), which is what the citizen
     * theme shows after its fixed country-code prefix. Null if it does not
     * carry that country code.
     */
    public static String national(String e164, String countryCode) {
        if (e164 == null || countryCode == null || !e164.startsWith(countryCode)) {
            return null;
        }
        return e164.substring(countryCode.length());
    }

    /** {@code +254712345678} -> {@code +254 ••••• 678}; never reveals more than the last three digits. */
    public static String mask(String e164, String countryCode) {
        if (e164 == null || e164.length() < 4) {
            return "";
        }
        String cc = countryCode != null && e164.startsWith(countryCode) ? countryCode : "";
        String national = e164.substring(cc.isEmpty() && e164.startsWith("+") ? 1 : cc.length());
        int visible = Math.min(3, national.length());
        String tail = national.substring(national.length() - visible);
        String hidden = "•".repeat(Math.max(0, national.length() - visible));
        return (cc.isEmpty() ? "" : cc + " ") + hidden + tail;
    }
}
