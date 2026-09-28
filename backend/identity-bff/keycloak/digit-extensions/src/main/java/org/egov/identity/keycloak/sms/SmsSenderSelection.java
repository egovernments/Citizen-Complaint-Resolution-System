package org.egov.identity.keycloak.sms;

import java.util.Locale;
import java.util.Set;
import java.util.function.Function;
import org.keycloak.Config;

/**
 * Which {@link DigitSmsSender} is active, read from the {@code digit-sms-sender}
 * SPI scope:
 *
 * <ul>
 *   <li>{@code KC_SPI_DIGIT_SMS_SENDER_MODE} — preferred. A runtime option, so
 *       one image can send via Mailpit in dev and via HTTP elsewhere.</li>
 *   <li>{@code KC_SPI_DIGIT_SMS_SENDER_PROVIDER} — also honoured, but Keycloak
 *       treats every {@code spi-*-provider} key as a BUILD-time option:
 *       {@code kc.sh start --optimized} refuses to boot when it is set at
 *       runtime to anything the image was not built with. Only usable with
 *       {@code start-dev} or when baked in at {@code kc.sh build}.</li>
 * </ul>
 *
 * Unset means {@code log}. {@code KC_SPI_DIGIT_SMS_SENDER_ALLOW_DEV=true}
 * unlocks the dev-only behaviour (Mailpit, plaintext codes in the log).
 */
public final class SmsSenderSelection {

    public static final String LOG = "log";
    public static final String MAILPIT = "mailpit";
    public static final String HTTP = "http";
    public static final Set<String> KNOWN = Set.of(LOG, MAILPIT, HTTP);

    private SmsSenderSelection() {
    }

    /** @param spiScope dash-case key within the digit-sms-sender scope to value, or null */
    public static String selected(Function<String, String> spiScope) {
        String mode = firstNonBlank(spiScope.apply("mode"), spiScope.apply("provider"));
        String selected = mode == null ? LOG : mode.trim().toLowerCase(Locale.ROOT);
        if (!KNOWN.contains(selected)) {
            throw new IllegalStateException("digit-sms-sender: unknown mode '" + selected
                    + "' (expected one of " + KNOWN + ")");
        }
        return selected;
    }

    public static boolean allowDev(Function<String, String> spiScope) {
        return Boolean.parseBoolean(String.valueOf(spiScope.apply("allow-dev")).trim());
    }

    /** The SPI-level scope of the running Keycloak. */
    public static Function<String, String> keycloakScope() {
        Config.Scope scope = Config.scope(DigitSmsSenderSpi.NAME);
        return scope::get;
    }

    private static String firstNonBlank(String a, String b) {
        if (a != null && !a.isBlank()) {
            return a;
        }
        return b != null && !b.isBlank() ? b : null;
    }
}
