package org.egov.identity.keycloak.config;

import java.time.Duration;
import java.util.function.Function;
import java.util.regex.Pattern;
import java.util.regex.PatternSyntaxException;

/**
 * Phone-OTP policy. Values come from the {@code digit-phone-otp} SPI scope,
 * i.e. environment variables {@code KC_SPI_DIGIT_PHONE_OTP_<NAME>}:
 *
 * <pre>
 *   TENANT_CONTEXT_URL      identity BFF base, e.g. http://identity-bff:3000 (empty = no lookup)
 *   TENANT_CACHE_SECONDS    how long a tenant's mobileValidation is reused (default 300)
 *   DEFAULT_COUNTRY_CODE    used when the tenant has no MobileNumberValidation (default +91)
 *   DEFAULT_MOBILE_REGEX    national-number regex for the same case (default ^[6-9][0-9]{9}$)
 *   OTP_LENGTH              digits per code (default 6)
 *   OTP_TTL_SECONDS         code lifetime (default 300)
 *   RESEND_SECONDS          minimum gap between two codes for one phone (default 30)
 *   MAX_ATTEMPTS            wrong entries allowed per code (default 5)
 *   PHONE_SENDS_PER_HOUR    codes per phone number per hour (default 5)
 *   IP_SENDS_PER_HOUR       codes per client IP per hour (default 20)
 * </pre>
 *
 * The defaults for the country code and regex are DIGIT's stock
 * {@code common-masters.MobileNumberValidation} fallback, the same values the
 * legacy citizen login uses when MDMS has no record.
 */
public record OtpSettings(
        String tenantContextUrl,
        Duration tenantCacheTtl,
        String defaultCountryCode,
        String defaultMobileRegex,
        int otpLength,
        Duration otpTtl,
        Duration resendInterval,
        int maxAttempts,
        int phoneSendsPerHour,
        int ipSendsPerHour) {

    public static final String SCOPE = "digit-phone-otp";

    public OtpSettings {
        if (otpLength < 4 || otpLength > 10) {
            throw new IllegalArgumentException("otp-length must be between 4 and 10");
        }
        if (maxAttempts < 1 || phoneSendsPerHour < 1 || ipSendsPerHour < 1) {
            throw new IllegalArgumentException("OTP limits must be positive");
        }
        if (!defaultCountryCode.matches("^\\+[1-9][0-9]{0,3}$")) {
            throw new IllegalArgumentException("default-country-code must look like +254");
        }
        try {
            Pattern.compile(defaultMobileRegex);
        } catch (PatternSyntaxException e) {
            throw new IllegalArgumentException("default-mobile-regex does not compile", e);
        }
    }

    public static OtpSettings defaults() {
        return from(key -> null);
    }

    /** @param lookup dash-case key (e.g. {@code otp-ttl-seconds}) to configured value, or null */
    public static OtpSettings from(Function<String, String> lookup) {
        return new OtpSettings(
                trimTrailingSlash(string(lookup, "tenant-context-url", "")),
                Duration.ofSeconds(integer(lookup, "tenant-cache-seconds", 300)),
                string(lookup, "default-country-code", "+91"),
                string(lookup, "default-mobile-regex", "^[6-9][0-9]{9}$"),
                integer(lookup, "otp-length", 6),
                Duration.ofSeconds(integer(lookup, "otp-ttl-seconds", 300)),
                Duration.ofSeconds(integer(lookup, "resend-seconds", 30)),
                integer(lookup, "max-attempts", 5),
                integer(lookup, "phone-sends-per-hour", 5),
                integer(lookup, "ip-sends-per-hour", 20));
    }

    private static String string(Function<String, String> lookup, String key, String fallback) {
        String value = lookup.apply(key);
        return value == null || value.isBlank() ? fallback : value.trim();
    }

    private static int integer(Function<String, String> lookup, String key, int fallback) {
        String value = lookup.apply(key);
        if (value == null || value.isBlank()) {
            return fallback;
        }
        try {
            return Integer.parseInt(value.trim());
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException(SCOPE + " " + key + " must be an integer", e);
        }
    }

    private static String trimTrailingSlash(String url) {
        return url.endsWith("/") ? url.substring(0, url.length() - 1) : url;
    }
}
