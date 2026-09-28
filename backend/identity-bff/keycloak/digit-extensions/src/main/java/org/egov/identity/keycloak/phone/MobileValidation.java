package org.egov.identity.keycloak.phone;

import java.util.Objects;
import java.util.regex.Pattern;
import java.util.regex.PatternSyntaxException;

/**
 * A tenant's {@code common-masters.MobileNumberValidation}: the country code
 * the legacy citizen UI shows as the input prefix and the regex the NATIONAL
 * number (without that prefix) must match.
 */
public final class MobileValidation {

    private static final Pattern COUNTRY_CODE = Pattern.compile("^\\+?[1-9][0-9]{0,3}$");
    // MDMS is admin-controlled, but the regex still runs inside Keycloak.
    private static final int MAX_REGEX_LENGTH = 256;

    private final String countryCode;
    private final String mobileNumberRegex;
    private final Pattern pattern;
    private final String errorMessage;

    private MobileValidation(String countryCode, String mobileNumberRegex, String errorMessage) {
        this.countryCode = countryCode;
        this.mobileNumberRegex = mobileNumberRegex;
        this.pattern = Pattern.compile(mobileNumberRegex);
        this.errorMessage = errorMessage;
    }

    /**
     * @return the validation, or null when either value is unusable (the
     *         caller then falls back to the configured default)
     */
    public static MobileValidation of(String countryCode, String mobileNumberRegex, String errorMessage) {
        if (countryCode == null || mobileNumberRegex == null) {
            return null;
        }
        String cc = countryCode.trim();
        String regex = mobileNumberRegex.trim();
        if (!COUNTRY_CODE.matcher(cc).matches() || regex.isEmpty() || regex.length() > MAX_REGEX_LENGTH) {
            return null;
        }
        if (!cc.startsWith("+")) {
            cc = "+" + cc;
        }
        try {
            return new MobileValidation(cc, regex, errorMessage == null || errorMessage.isBlank() ? null : errorMessage);
        } catch (PatternSyntaxException e) {
            return null;
        }
    }

    public String countryCode() {
        return countryCode;
    }

    public String mobileNumberRegex() {
        return mobileNumberRegex;
    }

    public String errorMessage() {
        return errorMessage;
    }

    public boolean matchesNational(String nationalNumber) {
        return pattern.matcher(nationalNumber).matches();
    }

    @Override
    public boolean equals(Object o) {
        return o instanceof MobileValidation other
                && countryCode.equals(other.countryCode)
                && mobileNumberRegex.equals(other.mobileNumberRegex)
                && Objects.equals(errorMessage, other.errorMessage);
    }

    @Override
    public int hashCode() {
        return Objects.hash(countryCode, mobileNumberRegex, errorMessage);
    }

    @Override
    public String toString() {
        return "MobileValidation[" + countryCode + " " + mobileNumberRegex + "]";
    }
}
